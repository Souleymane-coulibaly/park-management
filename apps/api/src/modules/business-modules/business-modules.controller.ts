import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type ModuleDefinition, MODULES, findModule, isModuleAvailableFor } from '@ocall/shared';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../common/decorators';

const view = (m: ModuleDefinition) => ({
  key: m.key,
  label: m.label,
  description: m.description,
  status: m.status,
});

/**
 * Accès aux modules métier, vérifié côté serveur selon le métier de l'organisation.
 * Les futurs modules (billetterie, POS, KDS…) s'appuieront sur la même règle.
 */
@ApiTags('Modules')
@Controller('modules')
export class BusinessModulesController {
  @RequirePermission('dashboard.read')
  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    const { membership } = requireTenant(auth);
    return MODULES.filter((m) => isModuleAvailableFor(m, membership.businessType)).map(view);
  }

  @RequirePermission('dashboard.read')
  @Get(':key')
  get(@CurrentAuth() auth: AuthContext, @Param('key') key: string) {
    const { membership } = requireTenant(auth);
    const module = findModule(key);
    if (!module)
      throw new NotFoundException({ code: 'MODULE_NOT_FOUND', message: 'Module inconnu.' });
    if (!isModuleAvailableFor(module, membership.businessType)) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_IN_PLAN',
        message: "Ce module n'est pas inclus dans votre métier.",
      });
    }
    return view(module);
  }
}
