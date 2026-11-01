import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePlatformPermission } from '../../common/decorators';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import {
  ContractTransitionDto,
  CreateContractClientDto,
  CreateContractDto,
  RenewContractDto,
  UpdateContractScopeDto,
} from './suite-contracts.dto';
import { SuiteContractsService } from './suite-contracts.service';

/** Contrats B2B : administration Ocall Suite. */
@ApiTags('Ocall Suite — contrats')
@Controller('platform/contracts')
export class SuiteContractsController {
  constructor(private readonly contracts: SuiteContractsService) {}

  @RequirePlatformPermission('platform.orgs.read')
  @Get()
  list(): Promise<unknown> {
    return this.contracts.list();
  }

  @RequirePlatformPermission('platform.orgs.read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.contracts.get(id);
  }

  @RequirePlatformPermission('platform.contracts.manage')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateContractDto): Promise<unknown> {
    return this.contracts.create(auth, dto);
  }

  /** Nouveau client et son contrat ; le mot de passe temporaire n'est renvoyé qu'ici. */
  @RequirePlatformPermission('platform.contracts.manage')
  @Post('clients')
  createClient(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateContractClientDto,
  ): Promise<unknown> {
    return this.contracts.createClient(auth, dto);
  }

  @RequirePlatformPermission('platform.contracts.manage')
  @HttpCode(200)
  @Post(':id/status')
  transition(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContractTransitionDto,
  ): Promise<unknown> {
    return this.contracts.transition(auth, id, dto);
  }

  @RequirePlatformPermission('platform.contracts.manage')
  @HttpCode(200)
  @Post(':id/renew')
  renew(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewContractDto,
  ): Promise<unknown> {
    return this.contracts.renew(auth, id, dto);
  }

  @RequirePlatformPermission('platform.contracts.manage')
  @Patch(':id')
  updateScope(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractScopeDto,
  ): Promise<unknown> {
    return this.contracts.updateScope(auth, id, dto);
  }
}

/** Portail Ocall Suite : applications accessibles au membre connecté. */
@ApiTags('Ocall Suite — portail')
@SkipThrottle()
@Controller('suite')
export class SuitePortalController {
  constructor(
    private readonly contracts: SuiteContractsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('apps')
  apps(@CurrentAuth() auth: AuthContext) {
    return this.contracts.apps(requireTenant(auth), this.config.school.enabled);
  }
}
