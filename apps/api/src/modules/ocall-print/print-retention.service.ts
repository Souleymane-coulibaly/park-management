import { hostname } from 'node:os';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PRINT_RETENTION_DAYS } from '@ocall/shared';
import { STORAGE_PROVIDER, type StorageProvider } from '../../common/storage/storage-provider';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { PrintPrismaService } from './print-prisma.service';

const JOB = 'print-retention';
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_MS = 10 * 60 * 1000;
const LEASE_MS = 30 * 60 * 1000;
const BATCH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionRunResult {
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED_LOCKED' | 'DISABLED';
  orders?: number;
  files?: number;
}

/**
 * Politique de conservation d'Ocall Print (décision du 19/11/2026, documentée dans docs/OCALL-PRINT.md) :
 * les FICHIERS DE PRODUCTION d'une commande (photos copiées, données nominatives figées) sont conservés
 * 90 jours après sa clôture (livraison, annulation ou refus), puis purgés automatiquement. Restent, pour le
 * suivi administratif : numéro, établissement, modèle, quantités, prix, montants, règlement, états, dates,
 * numéros de carte, journal. Les fiches de l'accès autonome et les modèles (logos) ne sont pas concernés.
 *
 * Toutes les 6 heures, une seule instance à la fois (verrou à bail en base, historique des exécutions de la
 * Suite) ; une commande est purgée en une transaction puis ses fichiers supprimés : une reprise après panne
 * ne fait que terminer le travail.
 */
@Injectable()
export class PrintRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PrintRetention');
  private readonly instance = `${hostname()}:${process.pid}`;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly db: PrintPrismaService,
    private readonly core: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    // Les essais déclenchent la purge explicitement : aucun traitement de fond en test.
    if (process.env.NODE_ENV === 'test' || !this.config.print.enabled) return;
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

  /** Exécute la purge ; ne lève jamais (résultat et erreur enregistrés dans l'historique). */
  async run(
    now = new Date(),
    trigger: 'schedule' | 'manual' = 'manual',
  ): Promise<RetentionRunResult> {
    if (!this.config.print.enabled) return { status: 'DISABLED' };
    const clock = new Date();
    try {
      await this.core.suiteScheduledJob.createMany({
        data: [{ name: JOB, lockedUntil: new Date(0) }],
        skipDuplicates: true,
      });
      const claim = await this.core.suiteScheduledJob.updateMany({
        where: { name: JOB, lockedUntil: { lte: clock } },
        data: { lockedUntil: new Date(clock.getTime() + LEASE_MS), lockedBy: this.instance },
      });
      if (claim.count === 0) return { status: 'SKIPPED_LOCKED' };
    } catch (error) {
      this.logger.warn(`Purge Print non lancée : ${(error as Error).name}`);
      return { status: 'FAILED' };
    }
    let runId: string | undefined;
    try {
      runId = (
        await this.core.suiteJobRun.create({ data: { job: JOB, trigger }, select: { id: true } })
      ).id;
      const stats = await this.purge(now);
      await this.core.suiteJobRun.update({
        where: { id: runId },
        data: { status: 'SUCCEEDED', stats: { ...stats }, finishedAt: new Date() },
      });
      return { status: 'SUCCEEDED', ...stats };
    } catch (error) {
      const name = (error as Error).name;
      this.logger.warn(`Purge Print interrompue : ${name}`);
      if (runId)
        await this.core.suiteJobRun
          .update({
            where: { id: runId },
            data: { status: 'FAILED', error: name, finishedAt: new Date() },
          })
          .catch(() => undefined);
      return { status: 'FAILED' };
    } finally {
      await this.core.suiteScheduledJob
        .updateMany({
          where: { name: JOB, lockedBy: this.instance },
          data: { lockedUntil: new Date() },
        })
        .catch(() => undefined);
    }
  }

  /** Commandes closes depuis plus de 90 jours, fichiers encore présents. */
  private async purge(now: Date): Promise<{ orders: number; files: number }> {
    const limit = new Date(now.getTime() - PRINT_RETENTION_DAYS * DAY_MS);
    let orders = 0;
    let files = 0;
    for (;;) {
      const due = await this.db.printOrder.findMany({
        where: {
          filesPurgedAt: null,
          OR: [
            { status: 'DELIVERED', deliveredAt: { lte: limit } },
            { status: 'CANCELLED', cancelledAt: { lte: limit } },
            { status: 'REJECTED', rejectedAt: { lte: limit } },
          ],
        },
        select: { id: true, organizationId: true },
        take: BATCH,
      });
      if (due.length === 0) break;
      for (const order of due) {
        const keys = await this.db.$transaction(async (tx) => {
          const items = await tx.printOrderItem.findMany({
            where: { organizationId: order.organizationId, orderId: order.id },
            select: { photoKey: true },
          });
          await tx.printOrderItem.updateMany({
            where: { organizationId: order.organizationId, orderId: order.id },
            data: { data: {}, holderLabel: null, photoKey: null },
          });
          await tx.printOrder.update({ where: { id: order.id }, data: { filesPurgedAt: now } });
          await tx.printOrderEvent.create({
            data: {
              organizationId: order.organizationId,
              orderId: order.id,
              type: 'FILES_PURGED',
              actorKind: 'SYSTEM',
              details: { retentionDays: PRINT_RETENTION_DAYS, files: items.length },
            },
          });
          return items.map((i) => i.photoKey).filter((k): k is string => k !== null);
        });
        for (const key of keys) {
          await this.storage.delete(key).catch(() => undefined);
          files += 1;
        }
        orders += 1;
      }
    }
    return { orders, files };
  }
}
