import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { appDenied, appTenant, assertAppEnabled } from '../../common/app-guard';
import type { PrintActor } from '../../common/integration/print-gateway';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

type PrintRequest = Request & { ocallPrint?: PrintActor };

export const CurrentPrint = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<PrintRequest>().ocallPrint as PrintActor;
});

/**
 * Garde de l'accès autonome à Ocall Print (écoles et entreprises sans Ocall School) : application
 * activée, membre d'organisation, rôle propriétaire ou administrateur de l'organisation. Gratuit (décision
 * du 19/11/2026) : aucun abonnement exigé ; seules les cartes commandées sont payées, à la livraison.
 * Les utilisateurs d'Ocall School passent par School, avec les droits School.
 */
@Injectable()
export class PrintAccessGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    assertAppEnabled(this.config.print.enabled);
    const req = context.switchToHttp().getRequest<PrintRequest>();
    const auth = appTenant(req.auth);
    if (auth.membership.role !== 'OWNER' && auth.membership.role !== 'ADMIN') throw appDenied();
    req.ocallPrint = { organizationId: auth.membership.organizationId, userId: auth.user.id };
    return true;
  }
}
