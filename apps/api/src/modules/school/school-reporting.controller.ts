import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SchoolPermission } from '@ocall/shared';
import { ExportRoute } from '../../common/throttling';
import {
  CurrentSchool,
  RequireSchoolPermission,
  SchoolAccessGuard,
  type SchoolContext,
} from './school-access';
import { download } from './school-download';
import {
  AuditQueryDto,
  CreateReportViewDto,
  ReportExportQueryDto,
  ReportFiltersDto,
  ReportViewsQueryDto,
} from './school-reporting.dto';
import { SchoolReportingService } from './school-reporting.service';

const SP = SchoolPermission;

/**
 * Reporting du Sprint 8 : tableau de bord de direction, rapports pédagogique, d'assiduité et financier,
 * exports, vues enregistrées et historique des opérations sensibles. Toutes les autorisations sont
 * vérifiées ici (permission) et dans le service (organisation, périmètre, rapports financiers).
 */
@ApiTags('Ocall School — reporting')
@UseGuards(SchoolAccessGuard)
@Controller('school/reports')
export class SchoolReportingController {
  constructor(private readonly reporting: SchoolReportingService) {}

  @RequireSchoolPermission(SP.REPORTS_READ)
  @Get('overview')
  overview(@CurrentSchool() ctx: SchoolContext, @Query() q: ReportFiltersDto): Promise<unknown> {
    return this.reporting.overview(ctx, q);
  }

  @RequireSchoolPermission(SP.REPORTS_READ)
  @Get('pedagogy')
  pedagogy(@CurrentSchool() ctx: SchoolContext, @Query() q: ReportFiltersDto): Promise<unknown> {
    return this.reporting.pedagogy(ctx, q);
  }

  @RequireSchoolPermission(SP.REPORTS_READ)
  @Get('attendance')
  attendance(@CurrentSchool() ctx: SchoolContext, @Query() q: ReportFiltersDto): Promise<unknown> {
    return this.reporting.attendance(ctx, q);
  }

  @RequireSchoolPermission(SP.FINANCE_REPORTS)
  @Get('finance')
  finance(@CurrentSchool() ctx: SchoolContext, @Query() q: ReportFiltersDto): Promise<unknown> {
    return this.reporting.finance(ctx, q);
  }

  @RequireSchoolPermission(SP.REPORTS_EXPORT)
  @ExportRoute()
  @Get('export')
  async export(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: ReportExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.reporting.export(ctx, q);
    return download(res, file.body, file.mimeType, file.fileName);
  }

  @RequireSchoolPermission(SP.REPORTS_READ)
  @Get('views')
  views(@CurrentSchool() ctx: SchoolContext, @Query() q: ReportViewsQueryDto): Promise<unknown> {
    return this.reporting.views(ctx, q.schoolId);
  }

  @RequireSchoolPermission(SP.REPORTS_READ)
  @Post('views')
  createView(
    @CurrentSchool() ctx: SchoolContext,
    @Body() dto: CreateReportViewDto,
  ): Promise<unknown> {
    return this.reporting.createView(ctx, dto);
  }

  @RequireSchoolPermission(SP.REPORTS_READ)
  @Delete('views/:id')
  deleteView(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<unknown> {
    return this.reporting.deleteView(ctx, id);
  }

  @RequireSchoolPermission(SP.AUDIT_READ)
  @Get('audit')
  audit(@CurrentSchool() ctx: SchoolContext, @Query() q: AuditQueryDto): Promise<unknown> {
    return this.reporting.audit(ctx, q);
  }
}
