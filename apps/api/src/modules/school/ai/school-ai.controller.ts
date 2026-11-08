import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SchoolPermission } from '@ocall/shared';
import { ExportRoute } from '../../../common/throttling';
import {
  CurrentSchool,
  RequireSchoolPermission,
  SchoolAccessGuard,
  type SchoolContext,
} from '../school-access';
import { download } from '../school-download';
import { SchoolAiAnalysisService } from './school-ai-analysis.service';
import { SchoolAiCopilotService } from './school-ai-copilot.service';
import { SchoolAiTeachingService } from './school-ai-teaching.service';
import {
  AnalysisQueryDto,
  ContentListDto,
  CopilotQuestionDto,
  GenerateContentDto,
  RegenerateSectionDto,
  SchoolAiScopeDto,
  SchoolAiSettingsDto,
  UpdateContentDto,
  ValidateContentDto,
} from './school-ai.dto';
import { SchoolAiService } from './school-ai.service';

const SP = SchoolPermission;
const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * Ocall School AI (Sprint 8) sur Ocall AI Core : copilote de direction, assistant pédagogique, analyse
 * scolaire, réglages et consommation. Permission vérifiée ici ; organisation, établissement, périmètre,
 * activation et quota par le serveur à chaque appel. Aucune écriture dans les données scolaires.
 */
@ApiTags('Ocall School — IA')
@UseGuards(SchoolAccessGuard)
@Controller('school/ai')
export class SchoolAiController {
  constructor(
    private readonly ai: SchoolAiService,
    private readonly copilot: SchoolAiCopilotService,
    private readonly teaching: SchoolAiTeachingService,
    private readonly analysis: SchoolAiAnalysisService,
  ) {}

  // ─── État, réglages, consommation ───

  /** Accessible à tout le personnel : indique seulement ce que le rôle peut utiliser. */
  @RequireSchoolPermission(SP.STRUCTURE_READ)
  @Get('status')
  status(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolAiScopeDto): Promise<unknown> {
    return this.ai.status(ctx, q.schoolId);
  }

  @RequireSchoolPermission(SP.AI_MANAGE)
  @Get('settings')
  settings(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolAiScopeDto): Promise<unknown> {
    return this.ai.settings(ctx, q.schoolId);
  }

  @RequireSchoolPermission(SP.AI_MANAGE)
  @Put('settings')
  updateSettings(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: SchoolAiScopeDto,
    @Body() dto: SchoolAiSettingsDto,
  ): Promise<unknown> {
    return this.ai.updateSettings(ctx, q.schoolId, dto);
  }

  @RequireSchoolPermission(SP.AI_MANAGE)
  @Get('usage')
  usage(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolAiScopeDto): Promise<unknown> {
    return this.ai.usage(ctx, q.schoolId);
  }

  @RequireSchoolPermission(SP.AI_MANAGE)
  @HttpCode(200)
  @Post('purge')
  purge(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolAiScopeDto): Promise<unknown> {
    return this.ai.purgeExpired(ctx, q.schoolId);
  }

  // ─── Copilote de direction ───

  @RequireSchoolPermission(SP.AI_COPILOT)
  @HttpCode(200)
  @Post('copilot/ask')
  ask(@CurrentSchool() ctx: SchoolContext, @Body() dto: CopilotQuestionDto): Promise<unknown> {
    return this.copilot.ask(ctx, dto.schoolId, dto.question, dto.conversationId);
  }

  @RequireSchoolPermission(SP.AI_COPILOT)
  @Get('copilot/conversations')
  conversations(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: SchoolAiScopeDto,
  ): Promise<unknown> {
    return this.copilot.conversations(ctx, q.schoolId);
  }

  @RequireSchoolPermission(SP.AI_COPILOT)
  @Get('copilot/conversations/:id')
  conversation(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: SchoolAiScopeDto,
    @Param('id', uuid) id: string,
  ): Promise<unknown> {
    return this.copilot.conversation(ctx, q.schoolId, id);
  }

  @RequireSchoolPermission(SP.AI_COPILOT)
  @Delete('copilot/conversations/:id')
  deleteConversation(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: SchoolAiScopeDto,
    @Param('id', uuid) id: string,
  ): Promise<unknown> {
    return this.copilot.deleteConversation(ctx, q.schoolId, id);
  }

  // ─── Assistant pédagogique ───

  @RequireSchoolPermission(SP.AI_TEACHING)
  @Post('teaching/contents')
  generate(@CurrentSchool() ctx: SchoolContext, @Body() dto: GenerateContentDto): Promise<unknown> {
    return this.teaching.generate(ctx, dto);
  }

  @RequireSchoolPermission(SP.AI_TEACHING)
  @Get('teaching/contents')
  contents(@CurrentSchool() ctx: SchoolContext, @Query() q: ContentListDto): Promise<unknown> {
    return this.teaching.list(ctx, q);
  }

  @RequireSchoolPermission(SP.AI_TEACHING)
  @Get('teaching/contents/:id')
  content(@CurrentSchool() ctx: SchoolContext, @Param('id', uuid) id: string): Promise<unknown> {
    return this.teaching.get(ctx, id);
  }

  @RequireSchoolPermission(SP.AI_TEACHING)
  @Put('teaching/contents/:id')
  update(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateContentDto,
  ): Promise<unknown> {
    return this.teaching.update(ctx, id, dto);
  }

  @RequireSchoolPermission(SP.AI_TEACHING)
  @HttpCode(200)
  @Post('teaching/contents/:id/sections/:key/regenerate')
  regenerate(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', uuid) id: string,
    @Param('key') key: string,
    @Body() dto: RegenerateSectionDto,
  ): Promise<unknown> {
    return this.teaching.regenerateSection(ctx, id, key.slice(0, 40), dto);
  }

  @RequireSchoolPermission(SP.AI_TEACHING)
  @HttpCode(200)
  @Post('teaching/contents/:id/validate')
  validate(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', uuid) id: string,
    @Body() dto: ValidateContentDto,
  ): Promise<unknown> {
    return this.teaching.validate(ctx, id, dto.version);
  }

  @RequireSchoolPermission(SP.AI_TEACHING)
  @HttpCode(200)
  @Post('teaching/contents/:id/archive')
  archive(@CurrentSchool() ctx: SchoolContext, @Param('id', uuid) id: string): Promise<unknown> {
    return this.teaching.archive(ctx, id);
  }

  @RequireSchoolPermission(SP.AI_TEACHING)
  @ExportRoute()
  @Get('teaching/contents/:id/pdf')
  async pdf(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, filename } = await this.teaching.pdf(ctx, id);
    return download(res, file, 'application/pdf', filename);
  }

  // ─── Analyse scolaire ───

  @RequireSchoolPermission(SP.AI_ANALYSIS)
  @Get('analysis')
  indicators(@CurrentSchool() ctx: SchoolContext, @Query() q: AnalysisQueryDto): Promise<unknown> {
    return this.analysis.indicators(ctx, q);
  }

  @RequireSchoolPermission(SP.AI_ANALYSIS)
  @HttpCode(200)
  @Post('analysis/summary')
  summary(@CurrentSchool() ctx: SchoolContext, @Body() dto: AnalysisQueryDto): Promise<unknown> {
    return this.analysis.summary(ctx, dto);
  }
}
