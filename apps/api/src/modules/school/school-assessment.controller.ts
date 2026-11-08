import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentSchool,
  RequireSchoolPermission,
  SchoolAccessGuard,
  type SchoolContext,
} from './school-access';
import {
  ClassPeriodQueryDto,
  CreateEvaluationDto,
  EvaluationQueryDto,
  QuranEvaluationDto,
  QuranSettingsDto,
  ReportCardQueryDto,
  SaveAppreciationsDto,
  SaveCommentsDto,
  SaveGradesDto,
  UnlockResultsDto,
  UpdateEvaluationDto,
  UpdatePeriodDto,
} from './school-assessment.dto';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolQuranService } from './school-quran.service';
import { SchoolReportCardsService } from './school-report-cards.service';
import { SchoolQueryDto, YearQueryDto } from './school.dto';

const STRUCTURE_READ = 'school.structure.read';
const STRUCTURE_MANAGE = 'school.structure.manage';
const READ = 'school.assessment.read';
const MANAGE = 'school.assessment.manage';
const VALIDATE = 'school.results.validate';
const REPORT_CARDS = 'school.report_cards';

/** Périodes, évaluations, notes, résultats et bulletins (Sprint 4). Permission vérifiée par route. */
@ApiTags('Ocall School — évaluations et bulletins')
@UseGuards(SchoolAccessGuard)
@Controller('school')
export class SchoolAssessmentController {
  constructor(
    private readonly assessment: SchoolAssessmentService,
    private readonly reportCards: SchoolReportCardsService,
  ) {}

  // ─── Périodes ───

  @RequireSchoolPermission(STRUCTURE_READ)
  @Get('periods')
  listPeriods(@CurrentSchool() ctx: SchoolContext, @Query() q: YearQueryDto) {
    return this.assessment.listPeriods(ctx, q.schoolYearId);
  }

  @RequireSchoolPermission(STRUCTURE_MANAGE)
  @Patch('periods/:id')
  updatePeriod(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeriodDto,
  ): Promise<unknown> {
    return this.assessment.updatePeriod(ctx, id, dto);
  }

  @RequireSchoolPermission(STRUCTURE_MANAGE)
  @Delete('periods/:id')
  deletePeriod(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.assessment.deletePeriod(ctx, id);
  }

  // ─── Évaluations et notes ───

  @RequireSchoolPermission(READ)
  @Get('evaluations')
  listEvaluations(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: EvaluationQueryDto,
  ): Promise<unknown> {
    return this.assessment.listEvaluations(ctx, q);
  }

  @RequireSchoolPermission(MANAGE)
  @Post('evaluations')
  createEvaluation(
    @CurrentSchool() ctx: SchoolContext,
    @Body() dto: CreateEvaluationDto,
  ): Promise<unknown> {
    return this.assessment.createEvaluation(ctx, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('evaluations/:id')
  sheet(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.assessment.sheet(ctx, id);
  }

  @RequireSchoolPermission(MANAGE)
  @Patch('evaluations/:id')
  updateEvaluation(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEvaluationDto,
  ): Promise<unknown> {
    return this.assessment.updateEvaluation(ctx, id, dto);
  }

  @RequireSchoolPermission(MANAGE)
  @Delete('evaluations/:id')
  deleteEvaluation(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.assessment.deleteEvaluation(ctx, id);
  }

  @RequireSchoolPermission(MANAGE)
  @Put('evaluations/:id/grades')
  saveGrades(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveGradesDto,
  ): Promise<unknown> {
    return this.assessment.saveGrades(ctx, id, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('evaluations/:id/grades/:studentId/history')
  gradeHistory(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ): Promise<unknown> {
    return this.assessment.gradeHistory(ctx, id, studentId);
  }

  // ─── Résultats ───

  @RequireSchoolPermission(READ)
  @Get('results')
  results(@CurrentSchool() ctx: SchoolContext, @Query() q: ClassPeriodQueryDto) {
    return this.assessment.results(ctx, q);
  }

  @RequireSchoolPermission(MANAGE)
  @Put('results/appreciations')
  saveAppreciations(@CurrentSchool() ctx: SchoolContext, @Body() dto: SaveAppreciationsDto) {
    return this.assessment.saveAppreciations(ctx, dto);
  }

  @RequireSchoolPermission(REPORT_CARDS)
  @Get('results/comments')
  listComments(@CurrentSchool() ctx: SchoolContext, @Query() q: ClassPeriodQueryDto) {
    return this.assessment.listComments(ctx, q);
  }

  @RequireSchoolPermission(VALIDATE)
  @Put('results/comments')
  saveComments(@CurrentSchool() ctx: SchoolContext, @Body() dto: SaveCommentsDto) {
    return this.assessment.saveComments(ctx, dto);
  }

  @RequireSchoolPermission(REPORT_CARDS)
  @Get('results/validations')
  validations(@CurrentSchool() ctx: SchoolContext, @Query() q: ClassPeriodQueryDto) {
    return this.assessment.validations(ctx, q);
  }

  @RequireSchoolPermission(VALIDATE)
  @Post('results/validate')
  @HttpCode(200)
  validate(@CurrentSchool() ctx: SchoolContext, @Body() dto: ClassPeriodQueryDto) {
    return this.assessment.validate(ctx, dto);
  }

  @RequireSchoolPermission(VALIDATE)
  @Post('results/unlock')
  @HttpCode(200)
  unlock(@CurrentSchool() ctx: SchoolContext, @Body() dto: UnlockResultsDto) {
    return this.assessment.unlock(ctx, dto);
  }

  // ─── Classements et bulletins ───

  @RequireSchoolPermission(REPORT_CARDS)
  @Get('report-cards')
  overview(@CurrentSchool() ctx: SchoolContext, @Query() q: ClassPeriodQueryDto) {
    return this.reportCards.overview(ctx, q);
  }

  /** PDF produit à la demande, jamais stocké ni mis en cache : aucune adresse directe n'existe. */
  @RequireSchoolPermission(REPORT_CARDS)
  @Get('report-cards/pdf')
  async pdf(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: ReportCardQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, filename } = await this.reportCards.pdf(ctx, q);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(file);
  }
}

/** Module facultatif « Mémorisation du Coran » (Sprint 4). */
@ApiTags('Ocall School — mémorisation du Coran')
@UseGuards(SchoolAccessGuard)
@Controller('school/quran')
export class SchoolQuranController {
  constructor(private readonly quran: SchoolQuranService) {}

  @RequireSchoolPermission('school.quran.read')
  @Get('settings')
  settings(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolQueryDto) {
    return this.quran.settings(ctx, q.schoolId);
  }

  @RequireSchoolPermission('school.quran.settings')
  @Put('settings')
  saveSettings(@CurrentSchool() ctx: SchoolContext, @Body() dto: QuranSettingsDto) {
    return this.quran.saveSettings(ctx, dto);
  }

  @RequireSchoolPermission('school.quran.read')
  @Get('surahs')
  surahs() {
    return this.quran.surahs();
  }

  @RequireSchoolPermission('school.quran.read')
  @Get('classes/:id')
  classProgress(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.quran.classProgress(ctx, id);
  }

  @RequireSchoolPermission('school.quran.read')
  @Get('students/:id')
  studentProgress(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.quran.studentProgress(ctx, id);
  }

  @RequireSchoolPermission('school.quran.manage')
  @Post('students/:id/evaluations')
  evaluate(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuranEvaluationDto,
  ) {
    return this.quran.evaluate(ctx, id, dto);
  }
}
