import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  SCHOOL_PRODUCT_CODE,
  SCHOOL_SMS_MAX_ATTEMPTS,
  type SchoolSmsKind,
  type SchoolSmsStatus,
  maskPhone,
  smsRetryDelayMs,
} from '@ocall/shared';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { SCHOOL_SMS_PROVIDER, type SmsProvider, SmsProviderError } from './school-sms.provider';
import { SchoolService } from './school.service';
import { SuiteContractsService } from '../suite-contracts/suite-contracts.service';

type Db = SchoolPrismaService | Prisma.TransactionClient;

/** Bail d'un message en cours d'envoi : un autre traitement ne le reprend qu'après ce délai. */
const LEASE_MS = 5 * 60_000;
const POLL_MS = 30_000;
const HISTORY_PAGE = 100;

export interface SmsToSend {
  organizationId: string;
  schoolId: string;
  /** Responsable destinataire et élève concerné : éligibilité revérifiée avant l'envoi. */
  guardianId: string;
  studentId?: string;
  phone: string;
  body: string;
  kind: SchoolSmsKind;
  /** Un même fait n'envoie jamais deux SMS au même destinataire. */
  dedupeKey: string;
}

/**
 * SMS de l'établissement (Sprint 6) : activés par la direction, désactivés par défaut. File d'attente en
 * base (jamais d'envoi dans la transaction métier), tentatives bornées avec délai croissant, historique
 * aux numéros masqués. Le fournisseur est injecté (simulé dans ce sprint) : aucun SMS réel en test.
 */
@Injectable()
export class SchoolSmsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchoolSmsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    @Inject(SCHOOL_SMS_PROVIDER) private readonly provider: SmsProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly contracts: SuiteContractsService,
  ) {}

  onModuleInit() {
    // Les essais déclenchent l'envoi explicitement (processDue) : aucun traitement de fond en test.
    if (process.env.NODE_ENV === 'test' || !this.config.school.enabled) return;
    this.timer = setInterval(() => void this.processDue(), POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async settings(ctx: SchoolContext, schoolId: string) {
    await this.school.assertSchool(ctx, schoolId);
    const row = await this.db.schoolSmsSettings.findUnique({ where: { schoolId } });
    return { enabled: row?.enabled ?? false, provider: this.config.school.sms.provider };
  }

  async updateSettings(ctx: SchoolContext, schoolId: string, enabled: boolean) {
    await this.school.assertSchool(ctx, schoolId);
    // Offre Ocall School Free (socle S1) : aucun SMS inclus (crédits SMS prévus au Sprint S2).
    if (enabled && ctx.limits.sms === false) {
      throw new ForbiddenException({
        code: 'SCHOOL_FREE_SMS_NOT_INCLUDED',
        message:
          'Les SMS ne sont pas inclus dans l’offre gratuite Ocall School. Passez à l’offre payante pour les activer.',
      });
    }
    await this.db.$transaction(async (tx) => {
      await tx.schoolSmsSettings.upsert({
        where: { schoolId },
        create: {
          schoolId,
          organizationId: ctx.organizationId,
          enabled,
          updatedByUserId: ctx.userId,
        },
        update: { enabled, updatedByUserId: ctx.userId },
      });
      await this.school.recordDecision(tx, ctx, 'school.sms_settings_changed', 'School', schoolId, {
        enabled,
      });
    });
    await this.school.publishDecisions(ctx.organizationId);
    return this.settings(ctx, schoolId);
  }

  /** Historique des envois d'un établissement, numéros masqués, du plus récent au plus ancien. */
  async history(ctx: SchoolContext, schoolId: string, status?: SchoolSmsStatus, cursor?: string) {
    await this.school.assertSchool(ctx, schoolId);
    const rows = await this.db.schoolSmsMessage.findMany({
      where: { organizationId: ctx.organizationId, schoolId, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: HISTORY_PAGE + 1,
      select: {
        id: true,
        phone: true,
        kind: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        sentAt: true,
      },
    });
    const items = rows
      .slice(0, HISTORY_PAGE)
      .map(({ phone, ...m }) => ({ ...m, phone: maskPhone(phone) }));
    return {
      items,
      nextCursor: rows.length > HISTORY_PAGE ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * Met des SMS en file pour les établissements qui les ont activés ; un doublon (même fait, même
   * destinataire) est ignoré. À appeler dans la transaction métier : le message part avec le fait.
   */
  async enqueue(db: Db, messages: SmsToSend[]): Promise<number> {
    if (messages.length === 0) return 0;
    const schoolIds = [...new Set(messages.map((m) => m.schoolId))];
    const enabled = new Set(
      (
        await db.schoolSmsSettings.findMany({
          where: { schoolId: { in: schoolIds }, enabled: true },
          select: { schoolId: true },
        })
      ).map((s) => s.schoolId),
    );
    // Offre gratuite (socle S1) : aucun SMS, comme un établissement dont les SMS sont désactivés —
    // les autres canaux (portail, notifications) ne sont pas affectés.
    const orgIds = [...new Set(messages.map((m) => m.organizationId))];
    const noSms = new Set<string>();
    for (const orgId of orgIds) {
      const entitlement = await this.contracts.entitlement(orgId, SCHOOL_PRODUCT_CODE);
      if (entitlement.limits.sms === false) noSms.add(orgId);
    }
    const data = messages.filter(
      (m) => enabled.has(m.schoolId) && !noSms.has(m.organizationId) && m.phone.trim(),
    );
    if (data.length === 0) return 0;
    // Première tentative datée par l'application (UTC), comme toutes les suivantes.
    const now = new Date();
    const { count } = await db.schoolSmsMessage.createMany({
      data: data.map((m) => ({ ...m, nextAttemptAt: now })),
      skipDuplicates: true,
    });
    return count;
  }

  /**
   * Envoie les SMS dus : chaque message est d'abord réservé (bail, tentative comptée), puis envoyé hors
   * transaction. Erreur passagère : nouvelle tentative après un délai croissant ; erreur définitive ou
   * tentatives épuisées : échec, conservé dans l'historique. Ne lève jamais.
   */
  async processDue(now = new Date(), limit = 50) {
    const result = { sent: 0, retried: 0, failed: 0, cancelled: 0 };
    try {
      const claimed = await this.db.$transaction(async (tx) => {
        // Bail expiré après la dernière tentative autorisée (processus interrompu avant d'enregistrer le
        // résultat) : échec définitif, jamais une tentative de plus.
        const exhausted = await tx.schoolSmsMessage.updateMany({
          where: {
            status: 'PENDING',
            attempts: { gte: SCHOOL_SMS_MAX_ATTEMPTS },
            nextAttemptAt: { lte: now },
          },
          data: { status: 'FAILED', lastError: 'ATTEMPTS_EXHAUSTED' },
        });
        result.failed += exhausted.count;
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "SchoolSmsMessage"
          WHERE status = 'PENDING' AND attempts < ${SCHOOL_SMS_MAX_ATTEMPTS}
            -- Colonne sans fuseau, écrite en UTC : la comparaison ne dépend pas du fuseau de la session.
            AND "nextAttemptAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')
          ORDER BY "nextAttemptAt", id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return [];
        // Destinataire relu au moment d'envoyer : lien retiré, SMS refusés ou désactivés, numéro changé ou
        // élève sorti de l'établissement → message annulé, jamais envoyé.
        const cancelled = await this.ineligible(
          tx,
          rows.map((r) => r.id),
        );
        if (cancelled.length > 0) {
          await tx.schoolSmsMessage.updateMany({
            where: { id: { in: cancelled } },
            data: { status: 'CANCELLED', lastError: 'RECIPIENT_INELIGIBLE' },
          });
          result.cancelled += cancelled.length;
        }
        const ids = rows.map((r) => r.id).filter((id) => !cancelled.includes(id));
        if (ids.length === 0) return [];
        await tx.schoolSmsMessage.updateMany({
          where: { id: { in: ids } },
          data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
        });
        return tx.schoolSmsMessage.findMany({
          where: { id: { in: ids } },
          select: { id: true, phone: true, body: true, attempts: true },
        });
      });
      for (const m of claimed) {
        try {
          const sent = await this.provider.send(m.phone, m.body);
          await this.db.schoolSmsMessage.update({
            where: { id: m.id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              providerMessageId: sent.id,
              lastError: null,
            },
          });
          result.sent += 1;
        } catch (error) {
          const known = error instanceof SmsProviderError;
          const transient = known ? error.transient : true;
          const final = !transient || m.attempts >= SCHOOL_SMS_MAX_ATTEMPTS;
          await this.db.schoolSmsMessage.update({
            where: { id: m.id },
            data: {
              lastError: known ? error.code : 'PROVIDER_ERROR',
              ...(final
                ? { status: 'FAILED' }
                : { nextAttemptAt: new Date(now.getTime() + smsRetryDelayMs(m.attempts)) }),
            },
          });
          if (final) result.failed += 1;
          else result.retried += 1;
        }
      }
    } catch (error) {
      this.logger.warn(`Envoi des SMS interrompu : ${(error as Error).name}`);
    }
    return result;
  }

  /**
   * Messages dont le destinataire n'est plus éligible : SMS désactivés pour l'établissement, responsable
   * absent, d'un autre établissement ou au numéro changé ; pour un fait d'élève, lien retiré, SMS refusés
   * sur ce lien ou élève sorti de l'établissement. Un message sans responsable n'est pas concerné.
   */
  private async ineligible(tx: Prisma.TransactionClient, ids: string[]): Promise<string[]> {
    const messages = await tx.schoolSmsMessage.findMany({
      where: { id: { in: ids }, guardianId: { not: null } },
      select: { id: true, schoolId: true, guardianId: true, studentId: true, phone: true },
    });
    if (messages.length === 0) return [];
    const [settings, guardians, links] = await Promise.all([
      tx.schoolSmsSettings.findMany({
        where: { schoolId: { in: [...new Set(messages.map((m) => m.schoolId))] }, enabled: true },
        select: { schoolId: true },
      }),
      tx.schoolGuardian.findMany({
        where: { id: { in: messages.map((m) => m.guardianId!) } },
        select: { id: true, schoolId: true, phone: true },
      }),
      tx.schoolStudentGuardian.findMany({
        where: {
          guardianId: { in: messages.map((m) => m.guardianId!) },
          studentId: { in: messages.flatMap((m) => (m.studentId ? [m.studentId] : [])) },
          canReceiveSms: true,
        },
        select: { guardianId: true, studentId: true, student: { select: { schoolId: true } } },
      }),
    ]);
    const enabled = new Set(settings.map((s) => s.schoolId));
    const byGuardian = new Map(guardians.map((g) => [g.id, g]));
    return messages
      .filter((m) => {
        const guardian = byGuardian.get(m.guardianId!);
        if (!enabled.has(m.schoolId) || !guardian) return true;
        if (guardian.schoolId !== m.schoolId || guardian.phone.trim() !== m.phone.trim())
          return true;
        if (!m.studentId) return false;
        return !links.some(
          (l) =>
            l.guardianId === m.guardianId &&
            l.studentId === m.studentId &&
            l.student.schoolId === m.schoolId,
        );
      })
      .map((m) => m.id);
  }
}
