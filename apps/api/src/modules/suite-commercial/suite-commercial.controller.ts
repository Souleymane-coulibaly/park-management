import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission, RequirePlatformPermission } from '../../common/decorators';
import { SuiteCommercialService } from './suite-commercial.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const PRODUCT_CODE = /^[A-Z][A-Z0-9_]{2,39}$/;

export class ActivationRequestDto {
  @ApiProperty({ description: 'Offre choisie (avec ou sans vitrine).' })
  @IsUUID('4')
  planId: string;
}

export class PlatformTrialDto {
  @ApiProperty()
  @IsUUID('4')
  organizationId: string;

  @ApiProperty({ example: 'OCALL_SCHOOL' })
  @Matches(PRODUCT_CODE)
  productCode: string;
}

export class CloseActivationRequestDto {
  @ApiProperty({ enum: ['HANDLED', 'CANCELLED'] })
  @IsIn(['HANDLED', 'CANCELLED'])
  outcome: 'HANDLED' | 'CANCELLED';

  @ApiProperty({ description: 'Motif ou référence du règlement vérifié.' })
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  note: string;
}

export class ActivationRequestQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'HANDLED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['PENDING', 'HANDLED', 'CANCELLED'])
  status?: 'PENDING' | 'HANDLED' | 'CANCELLED';
}

/**
 * Portail client Ocall Suite (socle S1). L'organisation est toujours celle de la session : un client
 * ne peut ni lire ni modifier l'abonnement d'une autre organisation (pas d'identifiant d'organisation
 * accepté). Les dates d'essai ne sont jamais fournies par le client.
 */
@ApiTags('suite')
@Controller('suite')
export class SuiteCommercialController {
  constructor(private readonly commercial: SuiteCommercialService) {}

  /** Vue du portail ; les tarifs et contrats ne sont visibles qu'avec le droit « abonnement ». */
  @Get('overview')
  overview(@CurrentAuth() auth: AuthContext) {
    return this.commercial.overview(requireTenant(auth));
  }

  @RequirePermission('subscription.read')
  @Get('apps/:code/contract')
  contract(@CurrentAuth() auth: AuthContext, @Param('code') code: string) {
    return this.commercial.contract(requireTenant(auth), this.code(code));
  }

  @RequirePermission('subscription.pay')
  @HttpCode(201)
  @Post('apps/:code/trial')
  startTrial(@CurrentAuth() auth: AuthContext, @Param('code') code: string) {
    return this.commercial.customerStartTrial(requireTenant(auth), this.code(code));
  }

  @RequirePermission('subscription.pay')
  @HttpCode(201)
  @Post('apps/:code/activation-request')
  requestActivation(
    @CurrentAuth() auth: AuthContext,
    @Param('code') code: string,
    @Body() dto: ActivationRequestDto,
  ) {
    return this.commercial.requestActivation(requireTenant(auth), this.code(code), dto.planId);
  }

  private code(code: string): string {
    return PRODUCT_CODE.test(code) ? code : '_';
  }
}

/** Suivi central par le Super Admin : essais, frais de mise en service, demandes d'activation. */
@ApiTags('platform')
@Controller('platform/suite-commercial')
export class SuiteCommercialAdminController {
  constructor(private readonly commercial: SuiteCommercialService) {}

  @RequirePlatformPermission('platform.billing.read')
  @Get('trials')
  trials() {
    return this.commercial.trials();
  }

  /** Essai démarré par Ocall (application en préproduction ou en pilote, décision D1). */
  @RequirePlatformPermission('platform.subscriptions.manage')
  @HttpCode(201)
  @Post('trials')
  startTrial(@CurrentAuth() auth: AuthContext, @Body() dto: PlatformTrialDto) {
    return this.commercial.platformStartTrial(auth, dto.organizationId, dto.productCode);
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('setup-fees')
  setupFees() {
    return this.commercial.setupFees();
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('activation-requests')
  activationRequests(@Query() q: ActivationRequestQueryDto) {
    return this.commercial.activationRequests(q.status);
  }

  @RequirePlatformPermission('platform.subscriptions.manage')
  @HttpCode(200)
  @Post('activation-requests/:id/close')
  close(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseActivationRequestDto,
  ) {
    return this.commercial.closeActivationRequest(auth, id, dto.outcome, dto.note);
  }
}
