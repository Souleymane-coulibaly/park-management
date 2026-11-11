import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@ocall/facture-database';
import {
  FACTURE_NOTIFICATION_MAX_ATTEMPTS,
  FACTURE_NOTIFICATION_KIND_LABELS,
  FACTURE_WHATSAPP_TEMPLATES,
  type FactureNotificationChannel,
  type FactureNotificationKind,
  factureNotificationRetryDelayMs,
  factureReminderTimes,
  renderFactureAppointmentMessage,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { composeMail } from '../../common/mail/mail-compose';
import { MailService } from '../../common/mail/mail.service';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import type { FactureContext } from './facture-access';
import { FacturePrismaService } from './facture-prisma.service';
import type { FactureNotificationSettingsDto } from './facture-notifications.dto';
import {
  FACTURE_WHATSAPP_PROVIDER,
  type WhatsAppProvider,
  WhatsAppProviderError,
} from './facture-whatsapp.provider';

type Tx = Prisma.TransactionClient;

/** Bail d'une notification en cours d'envoi : un autre traitement ne la reprend qu'après ce délai. */
const LEASE_MS = 5 * 60_000;
const POLL_MS = 30_000;
/** Lot par passage : 20 envois × 10 s de délai d'attente au plus restent sous le bail de 5 minutes. */
const BATCH = 20;
const LEASE_MARGIN_MS = 30_000;
/**
 * Marqueur posé à la prise en charge, effacé quand le résultat du fournisseur est enregistré. Retrouvé
 * après l'expiration du bail : la notification est peut-être partie → « résultat inconnu », jamais
 * renvoyée (le client ne reçoit jamais deux fois le même message).
 */
const SENDING = 'SENDING';

const DEFAULTS = {
  enabled: false,
  sendConfirmation: true,
  reminderDayBefore: true,
  reminderHoursBefore: 2 as number | null,
  emailFallback: true,
};

type Planned = { kind: FactureNotificationKind; sendAt: Date; key: string };

/**
 * Notifications de rendez-vous d'Ocall Facture (F4) : confirmation à la planification, report, rappels
 * (veille, quelques heures avant), annulation. WhatsApp avec le consentement du client, e-mail en
 * secours. File d'attente en base, programmée dans la transaction métier (jamais d'envoi dans la
 * transaction), envoyée par un répartiteur à bail ; une notification devenue obsolète est annulée au
 * moment de l'envoi ; un résultat inconnu n'est jamais renvoyé. Une notification ne bloque jamais un
 * rendez-vous : aucun échec d'envoi ne remonte à la planification.
 */
@Injectable()
export class FactureNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('FactureNotifications');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: FacturePrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(FACTURE_WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    // Les essais déclenchent l'envoi explicitement (processDue) : aucun traitement de fond en test.
    if (process.env.NODE_ENV === 'test' || !this.config.facture.enabled) return;
    // Un seul passage à la fois dans ce processus : un lot lent n'est jamais repris par le suivant.
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.processDue().finally(() => {
        this.running = false;
      });
    }, POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Réglages ───

  async settings(ctx: FactureContext) {
    const row = await this.db.factureNotificationSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    });
    const {
      organizationId: _o,
      updatedByUserId: _u,
      ...values
    } = row ?? {
      organizationId: ctx.organizationId,
      updatedByUserId: null,
      ...DEFAULTS,
      updatedAt: null,
    };
    return {
      ...values,
      /** Canaux réellement disponibles (fournisseur WhatsApp branché, e-mails activés). */
      whatsappAvailable: this.whatsapp.enabled,
      emailAvailable: this.mail.enabled,
    };
  }

  async updateSettings(ctx: FactureContext, dto: FactureNotificationSettingsDto) {
    await this.db.factureNotificationSettings.upsert({
      where: { organizationId: ctx.organizationId },
      create: { organizationId: ctx.organizationId, ...dto, updatedByUserId: ctx.userId },
      update: { ...dto, updatedByUserId: ctx.userId },
    });
    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'facture.notification_settings_updated',
      targetType: 'FactureNotificationSettings',
      targetId: ctx.organizationId,
    });
    return this.settings(ctx);
  }

  // ─── Programmation (dans la transaction de l'intervention) ───

  /** Intervention planifiée : confirmation et rappels. */
  async onPlanned(tx: Tx, organizationId: string, interventionId: string, now: Date) {
    const settings = await this.activeSettings(tx, organizationId);
    if (!settings) return;
    const row = await this.intervention(tx, organizationId, interventionId);
    const start = row.scheduledStart;
    const planned: Planned[] = [
      ...(settings.sendConfirmation
        ? [{ kind: 'CONFIRMATION' as const, sendAt: now, key: 'confirmation' }]
        : []),
      ...this.reminders(start, settings, now),
    ];
    await this.enqueue(tx, settings, row, planned);
  }

  /** Créneau déplacé : notifications en attente annulées (obsolètes), avis de report, nouveaux rappels. */
  async onRescheduled(tx: Tx, organizationId: string, interventionId: string, now: Date) {
    await this.cancelPending(tx, organizationId, interventionId, 'RESCHEDULED');
    const settings = await this.activeSettings(tx, organizationId);
    if (!settings) return;
    const row = await this.intervention(tx, organizationId, interventionId);
    const version = now.getTime();
    await this.enqueue(tx, settings, row, [
      { kind: 'RESCHEDULED', sendAt: now, key: `rescheduled/${version}` },
      ...this.reminders(row.scheduledStart, settings, now, version),
    ]);
  }

  /** Intervention annulée : notifications en attente annulées, avis d'annulation au client. */
  async onCancelled(tx: Tx, organizationId: string, interventionId: string, now: Date) {
    await this.cancelPending(tx, organizationId, interventionId, 'INTERVENTION_CANCELLED');
    const settings = await this.activeSettings(tx, organizationId);
    if (!settings) return;
    const row = await this.intervention(tx, organizationId, interventionId);
    await this.enqueue(tx, settings, row, [
      { kind: 'CANCELLATION', sendAt: now, key: 'cancellation' },
    ]);
  }

  /**
   * Contact, lieu ou objet modifié sans changement de créneau : les notifications en attente (destinataire
   * et texte figés) sont remplacées par des notifications à jour — jamais d'envoi à un ancien numéro.
   */
  async onDetailsChanged(tx: Tx, organizationId: string, interventionId: string, now: Date) {
    const pending = await tx.factureNotification.findMany({
      where: {
        organizationId,
        interventionId,
        status: 'PENDING',
        OR: [{ lastError: null }, { lastError: { not: SENDING } }],
      },
      select: { kind: true },
    });
    if (pending.length === 0) return;
    await this.cancelPending(tx, organizationId, interventionId, 'DETAILS_CHANGED');
    const settings = await this.activeSettings(tx, organizationId);
    if (!settings) return;
    const row = await this.intervention(tx, organizationId, interventionId);
    const version = now.getTime();
    await this.enqueue(tx, settings, row, [
      ...[...new Set(pending.map((p) => p.kind))]
        .filter((kind) => kind !== 'REMINDER')
        .map((kind) => ({ kind, sendAt: now, key: `${kind.toLowerCase()}/${version}` })),
      ...this.reminders(row.scheduledStart, settings, now, version),
    ]);
  }

  /** Intervention commencée : les rappels encore en attente n'ont plus d'objet. */
  async onStarted(tx: Tx, organizationId: string, interventionId: string) {
    await this.cancelPending(tx, organizationId, interventionId, 'INTERVENTION_STARTED');
  }

  // ─── Envoi ───

  /**
   * Envoie les notifications dues : réservation (bail, tentative comptée) puis envoi hors transaction.
   * Erreur passagère : nouvelle tentative après un délai croissant ; erreur définitive ou tentatives
   * épuisées : échec (et e-mail de secours pour un échec WhatsApp). Ne lève jamais.
   */
  async processDue(
    now = new Date(),
    limit = BATCH,
    /** Heure (réelle) au-delà de laquelle un envoi n'est plus tenté : le bail expirerait pendant l'envoi. */
    deadline = new Date(Date.now() + LEASE_MS - LEASE_MARGIN_MS),
  ) {
    const result = { sent: 0, retried: 0, failed: 0, cancelled: 0, unknown: 0 };
    try {
      const claimed = await this.db.$transaction(async (tx) => {
        const due = await tx.$queryRaw<
          { id: string; lastError: string | null; attempts: number }[]
        >`
          SELECT id, "lastError", attempts FROM "FactureNotification"
          WHERE status = 'PENDING'
            -- Colonnes sans fuseau, écrites en UTC.
            AND "sendAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')
            AND "nextAttemptAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')
          ORDER BY "nextAttemptAt", id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
        if (due.length === 0) return [];
        // Tentative précédente au résultat inconnu (bail expiré sans résultat) : peut-être partie →
        // jamais renvoyée.
        const unknown = due.filter((r) => r.lastError === SENDING).map((r) => r.id);
        if (unknown.length > 0) {
          await tx.factureNotification.updateMany({
            where: { id: { in: unknown } },
            data: { status: 'UNKNOWN', lastError: 'OUTCOME_UNKNOWN' },
          });
          result.unknown += unknown.length;
        }
        // Tentatives épuisées sans résultat inconnu : échec.
        const exhausted = due
          .filter((r) => r.lastError !== SENDING && r.attempts >= FACTURE_NOTIFICATION_MAX_ATTEMPTS)
          .map((r) => r.id);
        if (exhausted.length > 0) {
          await tx.factureNotification.updateMany({
            where: { id: { in: exhausted } },
            data: { status: 'FAILED', lastError: 'ATTEMPTS_EXHAUSTED' },
          });
          result.failed += exhausted.length;
        }
        const ids = due
          .map((r) => r.id)
          .filter((id) => !unknown.includes(id) && !exhausted.includes(id));
        if (ids.length === 0) return [];
        // Relue au moment d'envoyer : rendez-vous déplacé, commencé ou annulé, notifications
        // désactivées, consentement WhatsApp retiré → annulée, jamais envoyée.
        const rows = await tx.factureNotification.findMany({
          where: { id: { in: ids } },
          include: {
            intervention: {
              select: {
                status: true,
                scheduledStart: true,
                client: { select: { whatsappOptIn: true } },
              },
            },
          },
        });
        const enabled = new Set(
          (
            await tx.factureNotificationSettings.findMany({
              where: {
                organizationId: { in: [...new Set(rows.map((r) => r.organizationId))] },
                enabled: true,
              },
              select: { organizationId: true },
            })
          ).map((s) => s.organizationId),
        );
        const obsolete = new Map<string, string>();
        for (const r of rows) {
          const reason = staleReason(r, enabled.has(r.organizationId));
          if (reason) obsolete.set(r.id, reason);
        }
        for (const [id, reason] of obsolete) {
          await tx.factureNotification.update({
            where: { id },
            data: { status: 'CANCELLED', lastError: reason },
          });
        }
        result.cancelled += obsolete.size;
        const send = rows.filter((r) => !obsolete.has(r.id));
        if (send.length === 0) return [];
        await tx.factureNotification.updateMany({
          where: { id: { in: send.map((r) => r.id) } },
          data: {
            nextAttemptAt: new Date(now.getTime() + LEASE_MS),
            attempts: { increment: 1 },
            lastError: SENDING,
          },
        });
        return send.map((r) => ({ ...r, attempts: r.attempts + 1 }));
      });

      for (const n of claimed) {
        // Bail bientôt expiré (fournisseur lent) : la notification n'est PAS envoyée, elle est rendue à la
        // file (tentative suivante), jamais laissée « en cours » puis close « résultat inconnu ».
        if (Date.now() > deadline.getTime()) {
          await this.db.factureNotification
            .updateMany({
              where: { id: n.id, status: 'PENDING', lastError: SENDING },
              // Tentative comptée (la base interdit de décompter) ; le plafond de tentatives s'applique.
              data: { lastError: 'NOT_SENT_LEASE', nextAttemptAt: new Date() },
            })
            .catch(() => undefined);
          result.retried += 1;
          continue;
        }
        let accepted: { id: string };
        try {
          accepted = await this.deliver(n);
        } catch (error) {
          const known = error instanceof WhatsAppProviderError;
          const transient = known ? error.transient : true;
          const final = !transient || n.attempts >= FACTURE_NOTIFICATION_MAX_ATTEMPTS;
          try {
            await this.db.$transaction(async (tx) => {
              await tx.factureNotification.update({
                where: { id: n.id },
                data: {
                  lastError: known ? error.code : (error as Error).message || 'PROVIDER_ERROR',
                  ...(final
                    ? { status: 'FAILED' }
                    : {
                        nextAttemptAt: new Date(
                          now.getTime() + factureNotificationRetryDelayMs(n.attempts),
                        ),
                      }),
                },
              });
              if (final && n.channel === 'WHATSAPP') await this.emailFallback(tx, n, now);
            });
          } catch (persist) {
            // Non enregistré : le marqueur reste, la notification sera close « résultat inconnu ».
            this.logger.warn(
              `Résultat de notification non enregistré : ${(persist as Error).name}`,
            );
            continue;
          }
          if (final) result.failed += 1;
          else result.retried += 1;
          continue;
        }
        // Acceptée par le fournisseur : jamais renvoyée. Enregistrement retenté une fois.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await this.db.factureNotification.update({
              where: { id: n.id },
              data: {
                status: 'SENT',
                sentAt: new Date(),
                providerMessageId: accepted.id,
                lastError: null,
              },
            });
            result.sent += 1;
            break;
          } catch (persist) {
            if (attempt === 1) {
              this.logger.warn(
                `Notification envoyée mais non enregistrée : ${(persist as Error).name}`,
              );
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Envoi des notifications interrompu : ${(error as Error).name}`);
    }
    return result;
  }

  // ─── Outils ───

  private async deliver(n: {
    id: string;
    organizationId: string;
    kind: FactureNotificationKind;
    channel: FactureNotificationChannel;
    recipient: string;
    body: string;
  }): Promise<{ id: string }> {
    const idempotencyKey = `facture-notification/${n.id}`;
    if (n.channel === 'WHATSAPP') {
      return this.whatsapp.send({
        to: n.recipient,
        template: FACTURE_WHATSAPP_TEMPLATES[n.kind],
        body: n.body,
        idempotencyKey,
      });
    }
    const seller = await this.db.factureSettings.findUnique({
      where: { organizationId: n.organizationId },
      select: { legalName: true, tradeName: true, email: true },
    });
    const brand = seller?.tradeName || seller?.legalName || 'Ocall Facture';
    const content = composeMail(
      { brand, signature: brand },
      `${FACTURE_NOTIFICATION_KIND_LABELS[n.kind]} de votre rendez-vous — ${brand}`,
      [n.body],
    );
    const sent = await this.mail.send({
      to: [n.recipient],
      ...content,
      tag: 'facture-appointment',
      idempotencyKey,
      ...(seller?.email ? { replyTo: seller.email } : {}),
    });
    // Refus ou délai dépassé : nouvelle tentative, sans doublon (clé d'idempotence du fournisseur).
    if (!sent) throw new Error('MAIL_NOT_ACCEPTED');
    return { id: idempotencyKey };
  }

  /** Échec définitif d'un WhatsApp : même message par e-mail, si le client en a un. */
  private async emailFallback(
    tx: Tx,
    n: {
      organizationId: string;
      interventionId: string;
      kind: FactureNotificationKind;
      body: string;
      appointmentAt: Date;
      dedupeKey: string;
    },
    now: Date,
  ) {
    const settings = await this.activeSettings(tx, n.organizationId);
    if (!settings?.emailFallback || !this.mail.enabled) return;
    const row = await this.intervention(tx, n.organizationId, n.interventionId);
    if (!row.client.email) return;
    await tx.factureNotification.createMany({
      data: [
        {
          organizationId: n.organizationId,
          interventionId: n.interventionId,
          kind: n.kind,
          channel: 'EMAIL',
          recipient: row.client.email,
          body: n.body,
          appointmentAt: n.appointmentAt,
          sendAt: now,
          nextAttemptAt: now,
          dedupeKey: n.dedupeKey.replace(/\/WHATSAPP$/, '/EMAIL'),
        },
      ],
      skipDuplicates: true,
    });
  }

  private reminders(
    start: Date,
    settings: { reminderDayBefore: boolean; reminderHoursBefore: number | null },
    now: Date,
    version?: number,
  ): Planned[] {
    return factureReminderTimes(start, settings, now).map((r) => ({
      kind: 'REMINDER' as const,
      sendAt: r.at,
      key: `reminder/${r.key}/${start.toISOString()}${version ? `/${version}` : ''}`,
    }));
  }

  /**
   * Programme les notifications : WhatsApp si le fournisseur est branché, le client consentant et un
   * numéro connu ; sinon e-mail en secours si activé ; sinon rien. Un doublon (même fait, même canal)
   * est ignoré.
   */
  private async enqueue(
    tx: Tx,
    settings: { emailFallback: boolean },
    row: Awaited<ReturnType<FactureNotificationsService['intervention']>>,
    planned: Planned[],
  ) {
    if (planned.length === 0) return;
    const phone = row.contactPhone ?? row.client.phone;
    const channel: FactureNotificationChannel | null =
      this.whatsapp.enabled && row.client.whatsappOptIn && phone
        ? 'WHATSAPP'
        : settings.emailFallback && this.mail.enabled && row.client.email
          ? 'EMAIL'
          : null;
    if (!channel) return;
    const seller = await tx.factureSettings.findUnique({
      where: { organizationId: row.organizationId },
      select: { legalName: true, tradeName: true, phone: true },
    });
    const message = {
      business: seller?.tradeName || seller?.legalName || 'Votre prestataire',
      businessPhone: seller?.phone ?? null,
      recipientName: row.contactName ?? row.client.name,
      reference: row.number,
      title: row.title,
      appointmentAt: row.scheduledStart,
      place: row.siteAddress,
    };
    await tx.factureNotification.createMany({
      data: planned.map((p) => ({
        organizationId: row.organizationId,
        interventionId: row.id,
        kind: p.kind,
        channel,
        recipient: channel === 'WHATSAPP' ? phone! : row.client.email!,
        body: renderFactureAppointmentMessage(p.kind, message),
        appointmentAt: row.scheduledStart,
        sendAt: p.sendAt,
        nextAttemptAt: p.sendAt,
        dedupeKey: `intervention/${row.id}/${p.key}/${channel}`,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Annule les notifications en attente. Une notification en cours d'envoi (marqueur) n'est pas touchée :
   * elle part peut-être, son résultat sera enregistré tel quel (jamais « annulée » pour un message parti).
   */
  private cancelPending(tx: Tx, organizationId: string, interventionId: string, reason: string) {
    return tx.factureNotification.updateMany({
      where: {
        organizationId,
        interventionId,
        status: 'PENDING',
        OR: [{ lastError: null }, { lastError: { not: SENDING } }],
      },
      data: { status: 'CANCELLED', lastError: reason },
    });
  }

  private async activeSettings(tx: Tx, organizationId: string) {
    const settings = await tx.factureNotificationSettings.findUnique({ where: { organizationId } });
    return settings?.enabled ? settings : null;
  }

  private intervention(tx: Tx, organizationId: string, id: string) {
    return tx.factureIntervention.findUniqueOrThrow({
      where: { organizationId_id: { organizationId, id } },
      select: {
        id: true,
        organizationId: true,
        number: true,
        title: true,
        siteAddress: true,
        contactName: true,
        contactPhone: true,
        scheduledStart: true,
        client: {
          select: { name: true, phone: true, email: true, whatsappOptIn: true },
        },
      },
    });
  }
}

/** Raison d'annuler une notification au moment de l'envoyer, ou null si elle reste valable. */
function staleReason(
  n: {
    kind: FactureNotificationKind;
    channel: FactureNotificationChannel;
    appointmentAt: Date;
    intervention: {
      status: string;
      scheduledStart: Date;
      client: { whatsappOptIn: boolean };
    };
  },
  enabled: boolean,
): string | null {
  if (!enabled) return 'NOTIFICATIONS_DISABLED';
  if (n.channel === 'WHATSAPP' && !n.intervention.client.whatsappOptIn) return 'CONSENT_WITHDRAWN';
  if (n.kind === 'CANCELLATION') {
    return n.intervention.status === 'CANCELLED' ? null : 'OBSOLETE';
  }
  if (n.intervention.status !== 'PLANNED') return 'OBSOLETE';
  if (n.intervention.scheduledStart.getTime() !== n.appointmentAt.getTime()) return 'OBSOLETE';
  return null;
}
