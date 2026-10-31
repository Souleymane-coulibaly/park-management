import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators';
import { StorageService } from '../../common/storage/storage.service';

const CHECK_TIMEOUT_MS = 3_000;

/** Exécute une vérification bornée dans le temps : jamais de sonde bloquée. */
async function timed(check: () => Promise<boolean>) {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const ok = await Promise.race([
    check().catch(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  return { ok, latencyMs: Date.now() - started };
}

/**
 * Sondes de santé. `/health` (vivacité, utilisée par Railway) vérifie la base ; `/health/ready`
 * (disponibilité, Sprint 11B) vérifie base et stockage avec leur latence, pour la supervision.
 * Aucune information sensible : ni message d'erreur, ni hôte, ni version de dépendance.
 */
@ApiTags('Santé')
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Base de données injoignable.',
      });
    }
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    const [database, storage] = await Promise.all([
      timed(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return true;
      }),
      timed(() => this.storage.check()),
    ]);
    const body = {
      status: database.ok && storage.ok ? ('ok' as const) : ('degraded' as const),
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      checks: { database, storage: { ...storage, driver: this.storage.driver } },
    };
    if (body.status !== 'ok') {
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'Service dégradé.',
        ...body,
      });
    }
    return body;
  }
}
