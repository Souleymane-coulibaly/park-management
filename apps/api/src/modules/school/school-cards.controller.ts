import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PRINT_CARD_UNIT_PRICE, PRINT_CURRENCY, PRINT_RETENTION_DAYS } from '@ocall/shared';
import { download } from '../../common/download';
import { IMAGE_MAX_BYTES } from '../../common/images/image-reencode';
import {
  CurrentSchool,
  RequireSchoolPermission,
  SchoolAccessGuard,
  type SchoolContext,
} from './school-access';
import {
  CardOrderDto,
  CardOrdersQueryDto,
  CardPhotoDto,
  CardPreviewQueryDto,
  CardQrDto,
  CardReasonDto,
  CardTemplateCreateDto,
  CardTemplateUpdateDto,
  CardsQueryDto,
  IssueClassCardsDto,
  IssueStaffCardsDto,
  IssueStudentCardsDto,
  PrintImportDto,
  StaffActiveDto,
  StaffDto,
  StaffImportMembersDto,
  StaffQueryDto,
} from './school-cards.dto';
import { SchoolCardsService } from './school-cards.service';
import { SchoolPrintImportService } from './school-print-import.service';
import { SchoolStaffService } from './school-staff.service';

interface Upload {
  buffer: Buffer;
}

const imageFile = FileInterceptor('file', { limits: { fileSize: IMAGE_MAX_BYTES + 1, files: 1 } });

function jpeg(res: Response, body: Buffer | null) {
  if (!body) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Aucune photo.' });
  res.set({
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  return new StreamableFile(body);
}

/**
 * Cartes scolaires, badges du personnel et fiches du personnel (Ocall School × Ocall Print). Le moteur
 * des cartes est celui d'Ocall Print ; School contrôle les droits et le périmètre des établissements.
 */
@ApiTags('Ocall School — cartes et personnel')
@UseGuards(SchoolAccessGuard)
@Controller('school')
export class SchoolCardsController {
  constructor(
    private readonly cards: SchoolCardsService,
    private readonly staff: SchoolStaffService,
    private readonly imports: SchoolPrintImportService,
  ) {}

  @RequireSchoolPermission('school.cards.read')
  @Get('cards/settings')
  settings() {
    return {
      ...this.cards.available(),
      unitPrice: PRINT_CARD_UNIT_PRICE,
      currency: PRINT_CURRENCY,
      retentionDays: PRINT_RETENTION_DAYS,
      payment: 'CASH_ON_DELIVERY',
    };
  }

  // ─── Modèles ───

  @RequireSchoolPermission('school.cards.read')
  @Get('card-templates')
  templates(@CurrentSchool() ctx: SchoolContext, @Query('schoolId') schoolId?: string) {
    if (schoolId !== undefined && !/^[0-9a-f-]{36}$/i.test(schoolId))
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Établissement invalide.',
      });
    return this.cards.templates(ctx, schoolId);
  }

  @RequireSchoolPermission('school.cards.manage')
  @Post('card-templates')
  createTemplate(@CurrentSchool() ctx: SchoolContext, @Body() dto: CardTemplateCreateDto) {
    return this.cards.createTemplate(ctx, dto);
  }

  @RequireSchoolPermission('school.cards.manage')
  @Patch('card-templates/:id')
  updateTemplate(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CardTemplateUpdateDto,
  ) {
    return this.cards.updateTemplate(ctx, id, dto);
  }

  @RequireSchoolPermission('school.cards.manage')
  @UseInterceptors(imageFile)
  @Put('card-templates/:id/logo')
  setLogo(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
  ) {
    if (!file?.buffer?.length)
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choisissez un fichier.' });
    return this.cards.setTemplateLogo(ctx, id, file.buffer);
  }

  @RequireSchoolPermission('school.cards.manage')
  @Delete('card-templates/:id/logo')
  removeLogo(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.setTemplateLogo(ctx, id, null);
  }

  @RequireSchoolPermission('school.cards.manage')
  @HttpCode(204)
  @Delete('card-templates/:id')
  async archiveTemplate(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.cards.archiveTemplate(ctx, id);
  }

  @RequireSchoolPermission('school.cards.read')
  @Get('card-templates/:id/preview')
  previewTemplate(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.previewTemplate(ctx, id);
  }

  // ─── Cartes ───

  @RequireSchoolPermission('school.cards.read')
  @Get('cards')
  list(@CurrentSchool() ctx: SchoolContext, @Query() q: CardsQueryDto) {
    return this.cards.list(ctx, q);
  }

  @RequireSchoolPermission('school.cards.manage')
  @Post('cards/students')
  issueStudents(@CurrentSchool() ctx: SchoolContext, @Body() dto: IssueStudentCardsDto) {
    return this.cards.issueStudents(ctx, dto.studentIds);
  }

  @RequireSchoolPermission('school.cards.manage')
  @Post('cards/class')
  issueClass(@CurrentSchool() ctx: SchoolContext, @Body() dto: IssueClassCardsDto) {
    return this.cards.issueClass(ctx, dto);
  }

  @RequireSchoolPermission('school.cards.manage')
  @Post('cards/staff')
  issueStaff(@CurrentSchool() ctx: SchoolContext, @Body() dto: IssueStaffCardsDto) {
    return this.cards.issueStaff(ctx, dto.staffIds);
  }

  @RequireSchoolPermission('school.cards.manage')
  @Post('cards/:id/revoke')
  revoke(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CardReasonDto,
  ) {
    return this.cards.revoke(ctx, id, dto.reason);
  }

  @RequireSchoolPermission('school.cards.manage')
  @Post('cards/:id/replace')
  replace(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CardReasonDto,
  ) {
    return this.cards.replace(ctx, id, dto.reason);
  }

  @RequireSchoolPermission('school.cards.read')
  @Get('cards/:id/preview')
  preview(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: CardPreviewQueryDto,
  ) {
    return this.cards.preview(ctx, id, q.templateId);
  }

  /** Lecture d'un QR à l'entrée : aucune donnée n'est exposée hors des établissements de l'utilisateur. */
  @RequireSchoolPermission('school.cards.verify')
  @HttpCode(200)
  @Post('cards/verify')
  verify(@CurrentSchool() ctx: SchoolContext, @Body() dto: CardQrDto) {
    return this.cards.verify(ctx, dto.qr);
  }

  @RequireSchoolPermission('school.cards.read')
  @Get('students/:id/card-photo')
  async studentPhoto(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return jpeg(res, await this.cards.studentCardPhoto(ctx, id));
  }

  @RequireSchoolPermission('school.cards.manage')
  @Put('students/:id/card-photo')
  selectStudentPhoto(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CardPhotoDto,
  ) {
    return this.cards.setStudentCardPhoto(ctx, id, dto.documentId ?? null);
  }

  // ─── Commandes ───

  @RequireSchoolPermission('school.cards.order')
  @Post('card-orders')
  submit(@CurrentSchool() ctx: SchoolContext, @Body() dto: CardOrderDto) {
    return this.cards.submitOrder(ctx, {
      ...dto,
      delivery: { ...dto.delivery, note: dto.delivery.note ?? null },
    });
  }

  @RequireSchoolPermission('school.cards.read')
  @Get('card-orders')
  orders(@CurrentSchool() ctx: SchoolContext, @Query() q: CardOrdersQueryDto) {
    return this.cards.orders(ctx, q);
  }

  @RequireSchoolPermission('school.cards.read')
  @Get('card-orders/:id')
  order(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.order(ctx, id);
  }

  @RequireSchoolPermission('school.cards.order')
  @Post('card-orders/:id/cancel')
  cancel(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CardReasonDto,
  ) {
    return this.cards.cancelOrder(ctx, id, dto.reason);
  }

  @RequireSchoolPermission('school.cards.read')
  @Get('card-orders/:id/proof.pdf')
  async proof(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { pdf, number } = await this.cards.orderProof(ctx, id);
    return download(res, pdf, 'application/pdf', `bon-a-tirer-${number}.pdf`);
  }

  // ─── Personnel ───

  @RequireSchoolPermission('school.staff.read')
  @Get('staff')
  listStaff(@CurrentSchool() ctx: SchoolContext, @Query() q: StaffQueryDto) {
    return this.staff.list(ctx, q);
  }

  @RequireSchoolPermission('school.staff.manage')
  @Post('staff')
  createStaff(@CurrentSchool() ctx: SchoolContext, @Body() dto: StaffDto) {
    return this.staff.create(ctx, dto);
  }

  @RequireSchoolPermission('school.staff.manage')
  @Post('staff/import-members')
  importMembers(@CurrentSchool() ctx: SchoolContext, @Body() dto: StaffImportMembersDto) {
    return this.staff.importMembers(ctx, dto.schoolId);
  }

  @RequireSchoolPermission('school.staff.read')
  @Get('staff/:id')
  getStaff(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.staff.get(ctx, id);
  }

  @RequireSchoolPermission('school.staff.manage')
  @Patch('staff/:id')
  updateStaff(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffDto,
  ) {
    const { schoolId: _schoolId, ...rest } = dto;
    return this.staff.update(ctx, id, rest);
  }

  @RequireSchoolPermission('school.staff.manage')
  @HttpCode(200)
  @Post('staff/:id/active')
  setActive(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffActiveDto,
  ) {
    return this.staff.setActive(ctx, id, dto.active);
  }

  @RequireSchoolPermission('school.staff.manage')
  @UseInterceptors(imageFile)
  @Put('staff/:id/photo')
  setStaffPhoto(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
  ) {
    return this.staff.setPhoto(ctx, id, file?.buffer);
  }

  @RequireSchoolPermission('school.staff.read')
  @Get('staff/:id/photo')
  async staffPhoto(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return jpeg(res, await this.staff.photo(ctx, id));
  }

  // ─── Reprise des fiches Ocall Print (activation de School) ───

  @RequireSchoolPermission('school.cards.manage')
  @Get('print-import')
  importCandidates(@CurrentSchool() ctx: SchoolContext) {
    return this.imports.candidates(ctx);
  }

  @RequireSchoolPermission('school.cards.manage')
  @HttpCode(200)
  @Post('print-import')
  runImport(@CurrentSchool() ctx: SchoolContext, @Body() dto: PrintImportDto) {
    return this.imports.import(ctx, dto);
  }
}
