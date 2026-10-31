import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AI_MAX_RETENTION_DAYS } from '@ocall/shared';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../common/decorators';
import { AiUsageService } from './ai-usage.service';

export class UpdateAiSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  catalogImportEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ticketImportEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  copilotEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  voiceOrderEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Appels IA par mois civil (0 = aucun).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  monthlyCallLimit?: number;

  @ApiPropertyOptional({ description: 'Seuil d’alerte, en % du plafond.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  alertPercent?: number;

  @ApiPropertyOptional({
    description: 'Conservation des transcriptions et résultats d’import (jours).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(AI_MAX_RETENTION_DAYS)
  retentionDays?: number;
}

@ApiTags('IA — réglages et consommation')
@Controller('ai')
export class AiSettingsController {
  constructor(private readonly ai: AiUsageService) {}

  /** État de l'IA pour l'interface : fonctionnalités utilisables, consommation, alerte. */
  @RequirePermission('dashboard.read')
  @Get('status')
  status(@CurrentAuth() auth: AuthContext) {
    return this.ai.status(requireTenant(auth));
  }

  @RequirePermission('ai.manage')
  @Get('settings')
  settings(@CurrentAuth() auth: AuthContext) {
    return this.ai.settingsView(requireTenant(auth).membership.organizationId);
  }

  @RequirePermission('ai.manage')
  @Put('settings')
  update(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateAiSettingsDto) {
    return this.ai.updateSettings(requireTenant(auth), dto);
  }

  /** Consommation du mois : appels, jetons, coûts ESTIMÉS par fonctionnalité et établissement. */
  @RequirePermission('ai.manage')
  @Get('usage')
  usage(@CurrentAuth() auth: AuthContext) {
    return this.ai.usageReport(requireTenant(auth));
  }

  /** Efface tout de suite les contenus arrivés à échéance de conservation. */
  @RequirePermission('ai.manage')
  @HttpCode(200)
  @Post('purge')
  purge(@CurrentAuth() auth: AuthContext) {
    return this.ai.purgeExpired(requireTenant(auth).membership.organizationId);
  }
}
