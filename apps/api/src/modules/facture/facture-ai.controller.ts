import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { AI_AUDIO_MAX_BYTES } from '@ocall/shared';
import {
  CurrentFacture,
  FactureAccessGuard,
  type FactureContext,
  RequireFacturePermission,
} from './facture-access';
import {
  FactureAiApplyDto,
  FactureAiQuoteDto,
  FactureAiReportDto,
  FactureAiSettingsDto,
} from './facture-ai.dto';
import { FactureAiPlanningService } from './facture-ai-planning.service';
import { FactureAiService } from './facture-ai.service';
import type { FactureUpload } from './facture.service';

const uuid = new ParseUUIDPipe();
// Marge au-delà de la limite métier : le service renvoie un refus explicite plutôt qu'une erreur 413.
const audioFile = FileInterceptor('audio', {
  limits: { fileSize: AI_AUDIO_MAX_BYTES + 1, files: 1 },
});

/** Ocall Facture — module IA (F6A) : rapport et devis intelligents, réglages, traçabilité. */
@ApiTags('Ocall Facture')
@UseGuards(FactureAccessGuard)
@Controller('facture')
export class FactureAiController {
  constructor(
    private readonly ai: FactureAiService,
    private readonly planning: FactureAiPlanningService,
  ) {}

  @RequireFacturePermission('facture.access')
  @Get('ai/settings')
  settings(@CurrentFacture() ctx: FactureContext) {
    return this.ai.settings(ctx);
  }

  @RequireFacturePermission('facture.settings.manage')
  @Put('ai/settings')
  updateSettings(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureAiSettingsDto) {
    return this.ai.updateSettings(ctx, dto);
  }

  @RequireFacturePermission('facture.settings.manage')
  @Get('ai/proposals')
  proposals(@CurrentFacture() ctx: FactureContext) {
    return this.ai.proposals(ctx);
  }

  @RequireFacturePermission('facture.ai.report')
  @HttpCode(200)
  @Post('interventions/:id/ai/report')
  @UseInterceptors(audioFile)
  report(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: FactureAiReportDto,
    @UploadedFile() audio: FactureUpload | undefined,
  ) {
    return this.ai.report(ctx, id, dto.observations ?? '', audio);
  }

  @RequireFacturePermission('facture.ai.quote')
  @HttpCode(200)
  @Post('ai/quote')
  quote(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureAiQuoteDto) {
    return this.ai.quote(ctx, dto);
  }

  @RequireFacturePermission('facture.ai.quote')
  @HttpCode(200)
  @Post('ai/proposals/:id/apply')
  apply(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.ai.apply(ctx, id);
  }

  @RequireFacturePermission(
    'facture.ai.report',
    'facture.ai.quote',
    'facture.ai.planning',
    'facture.ai.maintenance',
  )
  @HttpCode(204)
  @Post('ai/proposals/:id/reject')
  reject(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.ai.reject(ctx, id);
  }

  // ─── F6B : planification et maintenance préventive ───

  @RequireFacturePermission('facture.ai.planning')
  @HttpCode(200)
  @Post('interventions/:id/ai/planning')
  suggestPlanning(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.planning.planning(ctx, id);
  }

  @RequireFacturePermission('facture.ai.planning')
  @HttpCode(200)
  @Post('ai/proposals/:id/assign')
  assign(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: FactureAiApplyDto,
  ) {
    return this.planning.assign(ctx, id, dto.choice ?? 0);
  }

  @RequireFacturePermission('facture.ai.maintenance')
  @Get('ai/maintenance')
  maintenanceSuggestions(@CurrentFacture() ctx: FactureContext) {
    return this.planning.suggestions(ctx);
  }

  @RequireFacturePermission('facture.ai.maintenance')
  @HttpCode(200)
  @Post('ai/maintenance')
  analyzeMaintenance(@CurrentFacture() ctx: FactureContext) {
    return this.planning.maintenance(ctx);
  }
}
