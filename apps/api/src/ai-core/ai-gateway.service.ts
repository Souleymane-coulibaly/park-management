import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { estimateAiCostMicroUsd } from '@ocall/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { AiCallContext, AiUsageStore } from './ai-context';
import { modelFor } from './ai-core.config';
import { type AiPrompt, promptRef } from './ai-prompts';
import {
  AI_PROVIDER,
  type AiErrorCode,
  type AiProvider,
  AiProviderError,
  type AiResult,
  aiUsageOf,
} from './ai-provider';
import { AiRateLimiter } from './ai-rate-limiter';

/** Statut HTTP de chaque erreur du fournisseur, identique pour toutes les applications. */
export const PROVIDER_ERROR_STATUS: Record<AiErrorCode, HttpStatus> = {
  AI_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  AI_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  AI_RATE_LIMITED: HttpStatus.SERVICE_UNAVAILABLE,
  AI_INVALID_OUTPUT: HttpStatus.BAD_GATEWAY,
  AI_REFUSED: HttpStatus.UNPROCESSABLE_ENTITY,
};

/** Code d'un refus métier (corps `{ code }` des exceptions de l'API), sinon le statut HTTP. */
function businessCode(error: HttpException): string {
  const body = error.getResponse();
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : null;
  return typeof code === 'string' ? code.slice(0, 60) : `HTTP_${error.getStatus()}`;
}

/** Fréquence du nettoyage des réservations orphelines. */
const ORPHAN_SWEEP_MS = 5 * 60_000;

/**
 * Orchestrateur d'Ocall AI Core : point de passage obligé de tout appel IA, quelle que soit
 * l'application. Dans l'ordre : limitation de débit, fournisseur configuré, réservation du quota par le
 * stockage de l'application (fonctionnalité activée, plafond, sous verrou), appel, enregistrement de la
 * consommation, des jetons, du coût ESTIMÉ et de la version du prompt ; en cas d'erreur du fournisseur,
 * journal technique sans contenu et message compréhensible. Les réservations restées en cours après
 * l'interruption d'un processus sont libérées périodiquement.
 */
@Injectable()
export class AiGatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('OcallAiCore');
  private readonly limiter: AiRateLimiter;
  private readonly stores = new Map<string, AiUsageStore>();
  private sweep: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider | null,
  ) {
    this.limiter = new AiRateLimiter(config.ai.rateLimit);
  }

  /**
   * Inscrit le stockage d'une application (une fois, au démarrage de son module). Une application
   * future s'inscrit de la même façon, sans modifier le cœur.
   */
  registerApplication(application: string, store: AiUsageStore) {
    if (this.stores.has(application) && this.stores.get(application) !== store) {
      throw new Error(`Application IA déjà inscrite : ${application}.`);
    }
    this.stores.set(application, store);
  }

  onModuleInit() {
    this.sweep = setInterval(() => void this.releaseOrphans(), ORPHAN_SWEEP_MS);
    this.sweep.unref();
  }

  onModuleDestroy() {
    if (this.sweep) clearInterval(this.sweep);
  }

  get configured(): boolean {
    return this.provider !== null;
  }

  get providerName(): string | null {
    return this.provider?.name ?? null;
  }

  get usdXofRate(): number {
    return this.config.ai.usdXofRate;
  }

  /** Fournisseur actif, ou erreur claire : l'application reste utilisable sans IA. */
  requireProvider(): AiProvider {
    if (!this.provider) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message: "L'IA n'est pas activée sur cette plateforme. Vous pouvez continuer sans IA.",
      });
    }
    return this.provider;
  }

  /** Modèle d'une opération (le fournisseur simulé n'a pas de modèle). */
  model(operation: string): string {
    return this.provider?.name === 'simulated' ? 'simulated' : modelFor(this.config.ai, operation);
  }

  transcribeModel(): string {
    return this.provider?.name === 'simulated' ? 'simulated' : this.config.ai.transcribeModel;
  }

  imageModel(): string {
    return this.provider?.name === 'simulated' ? 'simulated' : this.config.ai.imageModel;
  }

  /**
   * Exécute un appel IA dans le contexte d'une application. `call` reçoit le fournisseur ; ses erreurs
   * sont traduites en messages compréhensibles ; la consommation est toujours enregistrée.
   */
  async run<T>(
    ctx: AiCallContext,
    options: { model: string; prompt: AiPrompt | null },
    call: (provider: AiProvider) => Promise<AiResult<T>>,
  ): Promise<T> {
    const store = this.stores.get(ctx.application);
    if (!store) throw new Error(`Application IA non inscrite : ${ctx.application}.`);
    this.limiter.hit(ctx);
    const provider = this.requireProvider();
    const reservationId = await store.reserve(ctx, {
      provider: provider.name,
      model: options.model,
      prompt: options.prompt ? promptRef(options.prompt) : null,
    });
    const started = Date.now();
    try {
      const result = await call(provider);
      await store.succeed(reservationId, {
        usage: result.usage,
        estimatedCostMicroUsd:
          provider.name === 'simulated' ? 0 : estimateAiCostMicroUsd(options.model, result.usage),
        latencyMs: Date.now() - started,
      });
      return result.value;
    } catch (error) {
      const latencyMs = Date.now() - started;
      const code =
        error instanceof AiProviderError
          ? error.code
          : error instanceof HttpException
            ? businessCode(error)
            : 'AI_INTERNAL_ERROR';
      // Jetons déjà facturés avant l'échec (tours réussis, réponse illisible, erreur d'un outil) :
      // enregistrés aussi.
      const usage = aiUsageOf(error) ?? null;
      await store.fail(reservationId, {
        errorCode: code,
        latencyMs,
        usage,
        estimatedCostMicroUsd: !usage
          ? null
          : provider.name === 'simulated'
            ? 0
            : estimateAiCostMicroUsd(options.model, usage),
      });
      // Journal technique : identifiants et code seulement, jamais la question, le document ou la clé.
      const where = `${ctx.application}/${ctx.operation} org=${ctx.organizationId} usage=${reservationId}`;
      if (error instanceof AiProviderError) {
        this.logger.warn(`Erreur fournisseur ${code} (${provider.name}, ${latencyMs} ms) ${where}`);
        throw new HttpException(
          { code: error.code, message: `${error.message} Vous pouvez continuer sans IA.` },
          PROVIDER_ERROR_STATUS[error.code],
        );
      }
      if (error instanceof HttpException) {
        // Refus métier d'un outil (ex. rapport trop volumineux) : statut et message conservés.
        this.logger.warn(`Refus métier ${code} pendant un appel IA ${where}`);
        throw error;
      }
      this.logger.error(
        `Erreur interne pendant un appel IA (${error instanceof Error ? error.name : 'inconnue'}) ${where}`,
      );
      throw error;
    }
  }

  /** Libère les réservations orphelines de toutes les applications ; renvoie leur nombre. */
  async releaseOrphans(): Promise<number> {
    const olderThan = new Date(Date.now() - this.config.ai.orphanAfterMs);
    let total = 0;
    for (const [application, store] of this.stores) {
      try {
        const released = await store.releaseOrphans(olderThan);
        if (released > 0) {
          this.logger.warn(
            `${released} réservation(s) IA orpheline(s) libérée(s) (${application}).`,
          );
        }
        total += released;
      } catch (error) {
        this.logger.error(
          `Nettoyage des réservations IA impossible (${application}) : ${error instanceof Error ? error.name : 'inconnue'}`,
        );
      }
    }
    return total;
  }
}
