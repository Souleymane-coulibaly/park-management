import {
  Body,
  Controller,
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
import { ExportRoute } from '../../common/throttling';
import {
  CurrentSchool,
  RequireSchoolPermission,
  SchoolAccessGuard,
  type SchoolContext,
} from './school-access';
import {
  AdjustChargeDto,
  BenefitQueryDto,
  CreateBenefitDto,
  CreateFeeDto,
  CreatePaymentDto,
  FeeQueryDto,
  FinanceExportQueryDto,
  FinanceSettingsDto,
  GenerateChargesDto,
  LeaversQueryDto,
  PaymentQueryDto,
  ReasonDto,
  ReportQueryDto,
  StudentFinanceQueryDto,
  UpdateFeeDto,
} from './school-finance.dto';
import { download } from './school-download';
import { SchoolFinanceService } from './school-finance.service';
import { SchoolPaymentsService } from './school-payments.service';
import { SchoolQueryDto } from './school.dto';

const READ = 'school.finance.read';
const SETTINGS = 'school.finance.settings';
const BENEFITS = 'school.finance.benefits';
const CANCEL = 'school.finance.cancel';
const REPORTS = 'school.finance.reports';

/**
 * Gestion financière (Sprint 5). Permission vérifiée par route ; l'encaissement contrôle en plus, côté
 * service, le droit de caisse (comptabilité, direction, secrétariat autorisé).
 */
@ApiTags('Ocall School — finances')
@UseGuards(SchoolAccessGuard)
@Controller('school/finance')
export class SchoolFinanceController {
  constructor(
    private readonly finance: SchoolFinanceService,
    private readonly payments: SchoolPaymentsService,
  ) {}

  // ─── Réglages et frais ───

  @RequireSchoolPermission(READ)
  @Get('settings')
  settings(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolQueryDto) {
    return this.finance.settings(ctx, q.schoolId);
  }

  @RequireSchoolPermission(SETTINGS)
  @Put('settings')
  saveSettings(@CurrentSchool() ctx: SchoolContext, @Body() dto: FinanceSettingsDto) {
    return this.finance.saveSettings(ctx, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('fees')
  listFees(@CurrentSchool() ctx: SchoolContext, @Query() q: FeeQueryDto): Promise<unknown> {
    return this.finance.listFees(ctx, q.schoolYearId);
  }

  @RequireSchoolPermission(SETTINGS)
  @Post('fees')
  createFee(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateFeeDto): Promise<unknown> {
    return this.finance.createFee(ctx, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('fees/:id')
  feeDetail(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.finance.feeDetail(ctx, id);
  }

  @RequireSchoolPermission(SETTINGS)
  @Patch('fees/:id')
  updateFee(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeeDto,
  ): Promise<unknown> {
    return this.finance.updateFee(ctx, id, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('fees/:id/history')
  feeHistory(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.finance.feeHistory(ctx, id);
  }

  @RequireSchoolPermission(SETTINGS)
  @Post('fees/:id/generate')
  @HttpCode(200)
  generate(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateChargesDto,
  ) {
    return this.finance.generateCharges(ctx, id, dto);
  }

  // ─── Élèves, échéances, avantages ───

  @RequireSchoolPermission(READ)
  @Get('leavers')
  leavers(@CurrentSchool() ctx: SchoolContext, @Query() q: LeaversQueryDto): Promise<unknown> {
    return this.finance.leavers(ctx, q.schoolYearId, q.q);
  }

  @RequireSchoolPermission(READ)
  @Get('students/:id')
  student(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: StudentFinanceQueryDto,
  ): Promise<unknown> {
    return this.finance.studentSituation(ctx, id, q.schoolYearId);
  }

  @RequireSchoolPermission(BENEFITS)
  @Post('charges/:id/adjust')
  @HttpCode(200)
  adjust(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustChargeDto,
  ) {
    return this.finance.adjustCharge(ctx, id, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('benefits')
  benefits(@CurrentSchool() ctx: SchoolContext, @Query() q: BenefitQueryDto): Promise<unknown> {
    return this.finance.listBenefits(ctx, q);
  }

  @RequireSchoolPermission(BENEFITS)
  @Post('benefits')
  grant(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateBenefitDto): Promise<unknown> {
    return this.finance.grantBenefit(ctx, dto);
  }

  @RequireSchoolPermission(BENEFITS)
  @Post('benefits/:id/revoke')
  @HttpCode(200)
  revoke(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.finance.revokeBenefit(ctx, id, dto.reason);
  }

  // ─── Encaissements et reçus ───

  @RequireSchoolPermission(READ)
  @Post('payments')
  collect(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreatePaymentDto): Promise<unknown> {
    return this.payments.collect(ctx, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('payments')
  listPayments(@CurrentSchool() ctx: SchoolContext, @Query() q: PaymentQueryDto): Promise<unknown> {
    return this.payments.list(ctx, q);
  }

  @RequireSchoolPermission(READ)
  @Get('payments/:id')
  payment(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.payments.paymentView(ctx, id);
  }

  @RequireSchoolPermission(CANCEL)
  @Post('payments/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ): Promise<unknown> {
    return this.payments.cancel(ctx, id, dto.reason);
  }

  @RequireSchoolPermission(READ)
  @Get('payments/:id/receipt')
  async receipt(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, filename } = await this.payments.receipt(ctx, id);
    return download(res, file, 'application/pdf', filename);
  }

  // ─── Tableau de bord, impayés, exports ───

  @RequireSchoolPermission(REPORTS)
  @Get('dashboard')
  dashboard(@CurrentSchool() ctx: SchoolContext, @Query() q: ReportQueryDto): Promise<unknown> {
    return this.payments.dashboard(ctx, q);
  }

  @RequireSchoolPermission(REPORTS)
  @Get('unpaid')
  unpaid(@CurrentSchool() ctx: SchoolContext, @Query() q: ReportQueryDto): Promise<unknown> {
    return this.payments.unpaid(ctx, q);
  }

  @RequireSchoolPermission(REPORTS)
  @ExportRoute()
  @Get('export')
  async export(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: FinanceExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.payments.export(ctx, q);
    return download(res, file.body, file.mimeType, file.fileName);
  }
}
