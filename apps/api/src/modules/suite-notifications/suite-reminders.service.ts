import { hostname } from 'node:os';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  PARK_APP_PRODUCT_CODES,
  PARK_PRODUCT_CODE,
  commercialState,
  reminderDedupeKey,
  reminderStage,
  trialDaysRemaining,
} from '@ocall/shared';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { notifyOrganization } from '../../common/suite-notify';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 86_400_000;
const JOB = 'suite-reminders';
const INTERVAL_MS = 60 * 60_000;
const FIRST_RUN_MS = 60_000;
/** Bail du verrou : un traitement interrompu (arrêt brutal) est repris après ce délai. */
const LEASE_MS = 10 * 60_000;
/** Fenêtre de notification d'une échéance passée (identique à la règle partagée). */
const EXPIRED_WINDOW_DAYS = 7;
const SUB_ENDING_STATUSES = ['ACTIVE', 'PAST_DUE', 'PENDING_ACTIVATION'];
const SUB_EXPIRED_STATUSES = [...SUB_ENDING_STATUSES, 'EXPIRED'];

export interface ReminderRunResult {
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED_LOCKED';
  runId?: string;
  trials?: number;
  subscriptions?: number;
  created?: number;
  errors?: number;
}

/**
 * Rappels d'échéance d'essai et d'abonnement (Sprint S2) : J-7, J-3, J-1 (politique configurable) puis
 * le jour J. Une seule instance exécute le traitement à la fois (verrou à bail en base) ; chaque rappel
 * est idempotent (clé seuil + échéance), donc un redémarrage, une reprise ou une exécution manuelle ne
 * crée jamais de doublon. Les rappels ne décident jamais de l'accès : les droits restent calculés par le
 * socle à chaque requête.
 */
@Injectable()
export class SuiteRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SuiteReminders');
  private readonly instance = `${hostname()}:${process.pid}`;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    // Les essais déclenchent le traitement explicitement : aucun traitement de fond en test.
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.run(new Date(), 'schedule');
    const first = setTimeout(run, FIRST_RUN_MS);
    const every = setInterval(run, INTERVAL_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
  }

  /** Exécute le traitement ; ne lève jamais (résultat et erreur enregistrés dans l'historique). */
  async run(
    now: Date = new Date(),
    trigger: 'schedule' | 'manual' = 'manual',
  ): Promise<ReminderRunResult> {
    // Le verrou suit l'horloge réelle, indépendamment de la date de traitement (essais, rattrapage).
    const clock = new Date();
    try {
      await this.prisma.suiteScheduledJob.createMany({
        data: [{ name: JOB, lockedUntil: new Date(0) }],
        skipDuplicates: true,
      });
      const claim = await this.prisma.suiteScheduledJob.updateMany({
        where: { name: JOB, lockedUntil: { lte: clock } },
        data: { lockedUntil: new Date(clock.getTime() + LEASE_MS), lockedBy: this.instance },
      });
      if (claim.count === 0) return { status: 'SKIPPED_LOCKED' };
    } catch (error) {
      this.logger.warn(`Rappels d'échéance non lancés : ${(error as Error).name}`);
      return { status: 'FAILED' };
    }
    let runId: string | undefined;
    try {
      runId = (
        await this.prisma.suiteJobRun.create({ data: { job: JOB, trigger }, select: { id: true } })
      ).id;
      const stats = await this.scan(now);
      const status = stats.errors > 0 ? 'FAILED' : 'SUCCEEDED';
      await this.prisma.suiteJobRun.update({
        where: { id: runId },
        data: {
          status,
          stats: { ...stats },
          error:
            stats.errors > 0
              ? `${stats.errors} rappel(s) non créé(s), repris au prochain passage`
              : null,
          finishedAt: new Date(),
        },
      });
      return { status, runId, ...stats };
    } catch (error) {
      // Message technique seulement (nom de l'erreur) : aucune donnée client dans l'historique.
      const name = (error as Error).name;
      this.logger.warn(`Rappels d'échéance interrompus : ${name}`);
      if (runId) {
        await this.prisma.suiteJobRun
          .update({
            where: { id: runId },
            data: { status: 'FAILED', error: name, finishedAt: new Date() },
          })
          .catch(() => undefined);
      }
      return { status: 'FAILED', runId };
    } finally {
      await this.prisma.suiteScheduledJob
        .updateMany({
          where: { name: JOB, lockedBy: this.instance },
          data: { lockedUntil: new Date() },
        })
        .catch(() => undefined);
    }
  }

  private async scan(now: Date) {
    const offsets = this.config.suiteReminderOffsets;
    const from = new Date(now.getTime() - EXPIRED_WINDOW_DAYS * DAY_MS);
    const to = new Date(now.getTime() + Math.max(...offsets) * DAY_MS);
    const stats = { trials: 0, subscriptions: 0, created: 0, errors: 0 };

    // Essais : seuls ceux encore en cours d'essai (abonnement TRIALING) — un essai converti, suspendu
    // ou résilié ne reçoit plus de rappel.
    const trials = await this.prisma.productTrial.findMany({
      where: { endsAt: { gt: from, lte: to } },
      select: {
        id: true,
        organizationId: true,
        productId: true,
        endsAt: true,
        product: { select: { code: true, name: true } },
      },
    });
    const trialSubs = await this.prisma.subscription.findMany({
      where: {
        status: 'TRIALING',
        OR: trials.map((t) => ({ organizationId: t.organizationId, productId: t.productId })),
      },
      select: { organizationId: true, productId: true },
    });
    for (const t of trials) {
      if (
        !trialSubs.some((s) => s.organizationId === t.organizationId && s.productId === t.productId)
      ) {
        continue;
      }
      const stage = reminderStage(t.endsAt, now, offsets);
      if (!stage) continue;
      stats.trials += 1;
      await this.notify(stats, {
        // Revérifié sous verrou : toujours en essai, même échéance d'essai.
        lock: { organizationId: t.organizationId, productId: t.productId },
        still: (sub) => sub.status === 'TRIALING',
        organizationId: t.organizationId,
        kind: stage.kind === 'EXPIRED' ? 'TRIAL_EXPIRED' : 'TRIAL_ENDING',
        product: t.product,
        endsAt: t.endsAt,
        daysLeft: stage.kind === 'ENDING' ? stage.daysLeft : undefined,
        dedupeKey: reminderDedupeKey('trial', t.id, t.endsAt, stage),
      });
    }

    // Abonnements payants : actifs ou en attente de renouvellement ; l'expiration (jour J) est notifiée
    // aussi après le passage automatique en EXPIRED. Suspendus et résiliés : aucun rappel.
    const subs = await this.prisma.subscription.findMany({
      where: {
        expiresAt: { gt: from, lte: to },
        status: { in: ['ACTIVE', 'PAST_DUE', 'PENDING_ACTIVATION', 'EXPIRED'] },
      },
      select: {
        id: true,
        organizationId: true,
        status: true,
        expiresAt: true,
        product: { select: { code: true, name: true } },
      },
    });
    for (const s of subs) {
      const stage = reminderStage(s.expiresAt!, now, offsets);
      if (!stage || (stage.kind === 'ENDING' && s.status === 'EXPIRED')) continue;
      stats.subscriptions += 1;
      const scannedEnd = s.expiresAt!.getTime();
      const statuses = stage.kind === 'EXPIRED' ? SUB_EXPIRED_STATUSES : SUB_ENDING_STATUSES;
      await this.notify(stats, {
        // Revérifié sous verrou : ni renouvelé (échéance changée), ni suspendu, ni résilié entre-temps.
        lock: { subscriptionId: s.id },
        still: (sub) => statuses.includes(sub.status) && sub.expiresAt?.getTime() === scannedEnd,
        organizationId: s.organizationId,
        kind: stage.kind === 'EXPIRED' ? 'SUBSCRIPTION_EXPIRED' : 'SUBSCRIPTION_ENDING',
        product: s.product,
        endsAt: s.expiresAt!,
        daysLeft: stage.kind === 'ENDING' ? stage.daysLeft : undefined,
        dedupeKey: reminderDedupeKey('sub', s.id, s.expiresAt!, stage),
      });
    }
    return stats;
  }

  private async notify(
    stats: { created: number; errors: number },
    input: {
      lock: { subscriptionId: string } | { organizationId: string; productId: string };
      still: (sub: { status: string; expiresAt: Date | null }) => boolean;
      organizationId: string;
      kind: 'TRIAL_ENDING' | 'TRIAL_EXPIRED' | 'SUBSCRIPTION_ENDING' | 'SUBSCRIPTION_EXPIRED';
      product: { code: string; name: string };
      endsAt: Date;
      daysLeft?: number;
      dedupeKey: string;
    },
  ) {
    const park = PARK_APP_PRODUCT_CODES.includes(input.product.code);
    try {
      // Courte transaction : l'abonnement est verrouillé et relu, puis le rappel est créé. Une activation,
      // un renouvellement ou une suspension concurrents passent avant ou après, jamais entre les deux.
      stats.created += await this.prisma.$transaction(async (tx) => {
        const rows =
          'subscriptionId' in input.lock
            ? await tx.$queryRaw<{ status: string; expiresAt: Date | null }[]>`
                SELECT status::text AS status, "expiresAt" FROM "Subscription"
                WHERE id = ${input.lock.subscriptionId}::uuid FOR UPDATE`
            : await tx.$queryRaw<{ status: string; expiresAt: Date | null }[]>`
                SELECT status::text AS status, "expiresAt" FROM "Subscription"
                WHERE "organizationId" = ${input.lock.organizationId}::uuid
                  AND "productId" = ${input.lock.productId}::uuid FOR UPDATE`;
        const current = rows[0];
        if (!current || !input.still(current)) return 0;
        return notifyOrganization(tx, {
          organizationId: input.organizationId,
          kind: input.kind,
          productCode: park ? PARK_PRODUCT_CODE : input.product.code,
          params: {
            productName: park ? 'Ocall Park' : input.product.name,
            endsAt: input.endsAt.toISOString(),
            ...(input.daysLeft !== undefined ? { daysLeft: input.daysLeft } : {}),
          },
          dedupeKey: input.dedupeKey,
        });
      });
    } catch {
      // Un rappel en échec n'arrête pas les autres ; il est recréé au prochain passage (même clé).
      stats.errors += 1;
    }
  }

  // ─── Super Admin : échéances ───

  /**
   * Contrats arrivant à échéance (abonnements payants et essais en cours), du plus proche au plus
   * lointain, et essais expirés non convertis.
   */
  async dueSoon(
    filter: { productCode?: string; organizationId?: string; days?: number },
    now: Date = new Date(),
  ) {
    const horizon = new Date(now.getTime() + (filter.days ?? 30) * DAY_MS);
    const codes = filter.productCode
      ? filter.productCode === PARK_PRODUCT_CODE
        ? [...PARK_APP_PRODUCT_CODES]
        : [filter.productCode]
      : undefined;
    const orgFilter = filter.organizationId ? { organizationId: filter.organizationId } : {};
    const productFilter = codes ? { product: { code: { in: codes } } } : {};
    const [subs, trials] = await Promise.all([
      this.prisma.subscription.findMany({
        where: {
          ...orgFilter,
          ...productFilter,
          status: { in: ['ACTIVE', 'PAST_DUE', 'PENDING_ACTIVATION', 'EXPIRED'] },
          expiresAt: { lte: horizon, gt: new Date(now.getTime() - 30 * DAY_MS) },
        },
        orderBy: { expiresAt: 'asc' },
        take: 300,
        select: {
          id: true,
          status: true,
          expiresAt: true,
          agreedMonthlyPrice: true,
          plan: { select: { name: true, monthlyPrice: true, includesShowcase: true } },
          product: { select: { code: true, name: true } },
          organization: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.productTrial.findMany({
        where: {
          ...orgFilter,
          ...productFilter,
          endsAt: { lte: horizon, gt: new Date(now.getTime() - 60 * DAY_MS) },
        },
        orderBy: { endsAt: 'asc' },
        take: 300,
        select: {
          id: true,
          organizationId: true,
          productId: true,
          endsAt: true,
          product: { select: { code: true, name: true } },
          organization: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);
    const trialSubs = trials.length
      ? await this.prisma.subscription.findMany({
          where: {
            OR: trials.map((t) => ({ organizationId: t.organizationId, productId: t.productId })),
          },
          select: { organizationId: true, productId: true, status: true },
        })
      : [];
    return {
      subscriptions: subs.map((s) => ({
        id: s.id,
        organization: s.organization,
        product: s.product,
        planName: s.plan.name,
        includesShowcase: s.plan.includesShowcase,
        monthlyPrice: s.agreedMonthlyPrice ?? s.plan.monthlyPrice,
        status: s.status,
        state: commercialState(
          { status: s.status, expiresAt: s.expiresAt, trialEndsAt: null },
          now,
        ),
        expiresAt: s.expiresAt,
        daysRemaining: Math.ceil((s.expiresAt!.getTime() - now.getTime()) / DAY_MS),
      })),
      trials: trials
        .map((t) => {
          const status =
            trialSubs.find(
              (s) => s.organizationId === t.organizationId && s.productId === t.productId,
            )?.status ?? null;
          return {
            id: t.id,
            organization: t.organization,
            product: t.product,
            endsAt: t.endsAt,
            daysRemaining: trialDaysRemaining(t.endsAt, now),
            expired: t.endsAt.getTime() <= now.getTime(),
            subscriptionStatus: status,
          };
        })
        // Essais convertis (abonnement actif) : plus concernés par l'échéance d'essai.
        .filter((t) => t.subscriptionStatus === 'TRIALING' || t.subscriptionStatus === null),
    };
  }
}
