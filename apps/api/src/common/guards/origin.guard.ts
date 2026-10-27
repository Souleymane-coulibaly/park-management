import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protection CSRF en complément du cookie SameSite=Lax : une requête d'écriture
 * émise par un navigateur depuis une origine non autorisée est refusée.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    const origin = req.headers.origin;
    if (origin && !this.config.webOrigins.includes(origin)) {
      throw new ForbiddenException({
        code: 'INVALID_ORIGIN',
        message: 'Origine de la requête non autorisée.',
      });
    }
    return true;
  }
}
