import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SESSION_COOKIE } from '../../config/app-config';
import { ALLOW_PENDING_PASSWORD, IS_PUBLIC } from '../decorators';
import { SessionService } from '../security/session.service';

/**
 * Garde globale : toute route exige une session valide sauf mention @Public().
 * Un compte au mot de passe initial non changé n'accède qu'aux routes @AllowPendingPassword().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const auth =
      typeof token === 'string' && token.length > 0 ? await this.sessions.resolve(token) : null;
    if (!auth) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Session absente ou expirée.',
      });
    }
    req.auth = auth;

    if (
      auth.user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)
    ) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Vous devez changer votre mot de passe initial.',
      });
    }
    return true;
  }
}
