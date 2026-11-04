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
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { SCHOOL_DOCUMENT_MAX_BYTES, SCHOOL_IMPORT_MAX_BYTES } from '@ocall/shared';
import { requestMeta } from '../../common/request-meta';
import { ExportRoute } from '../../common/throttling';
import {
  CurrentSchool,
  RequireSchoolPermission,
  SchoolAccessGuard,
  type SchoolContext,
} from './school-access';
import { type SchoolUpload, SchoolDocumentsService } from './school-documents.service';
import { SchoolEnrollmentsService } from './school-enrollments.service';
import { SchoolGuardiansService } from './school-guardians.service';
import { SchoolImportsService } from './school-imports.service';
import {
  ChangeClassDto,
  ClassTeacherDto,
  CorrectMatriculeDto,
  CreateEnrollmentDto,
  CreateGuardianDto,
  CreateStudentDto,
  EnrollmentStatusDto,
  EnrollmentsQueryDto,
  ExitDto,
  ExportQueryDto,
  GuardianLinkRightsDto,
  GuardiansQueryDto,
  ImportDto,
  LinkGuardianDto,
  OptionalSchoolQueryDto,
  SensitiveDto,
  StudentSettingsDto,
  StudentsQueryDto,
  TransferDto,
  UpdateGuardianDto,
  UpdateStudentDto,
  UploadDocumentDto,
} from './school-students.dto';
import { SchoolStudentsService } from './school-students.service';
import { SchoolQueryDto, YearQueryDto } from './school.dto';

const documentFile = FileInterceptor('file', {
  limits: { fileSize: SCHOOL_DOCUMENT_MAX_BYTES, files: 1 },
  // Nom de fichier en UTF-8 : un nom arabe reste intact.
  defParamCharset: 'utf8',
});
const importFile = FileInterceptor('file', {
  limits: { fileSize: SCHOOL_IMPORT_MAX_BYTES, files: 1 },
});

/** Export en pièce jointe, jamais mis en cache. */
function attachment(
  res: Response,
  file: { body: Buffer; mimeType: string; fileName: string },
): StreamableFile {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  return new StreamableFile(file.body);
}

/** Dossiers élèves, inscriptions, responsables, documents, imports et exports. */
@ApiTags('Ocall School — élèves')
@UseGuards(SchoolAccessGuard)
@Controller('school')
export class SchoolStudentsController {
  constructor(
    private readonly students: SchoolStudentsService,
    private readonly enrollments: SchoolEnrollmentsService,
    private readonly guardians: SchoolGuardiansService,
    private readonly documents: SchoolDocumentsService,
    private readonly imports: SchoolImportsService,
  ) {}

  // ─── Élèves ───

  @RequireSchoolPermission('school.students.read_full')
  @Get('students/dashboard')
  dashboard(@CurrentSchool() ctx: SchoolContext, @Query() q: OptionalSchoolQueryDto) {
    return this.students.dashboard(ctx, q.schoolId);
  }

  @RequireSchoolPermission('school.students.read')
  @Get('students')
  list(@CurrentSchool() ctx: SchoolContext, @Query() q: StudentsQueryDto): Promise<unknown> {
    return this.students.list(ctx, q);
  }

  @RequireSchoolPermission('school.students.manage')
  @Post('students')
  create(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateStudentDto): Promise<unknown> {
    return this.students.create(ctx, dto);
  }

  @RequireSchoolPermission('school.students.read')
  @Get('students/:id')
  get(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.students.get(ctx, id);
  }

  @RequireSchoolPermission('school.students.manage')
  @Patch('students/:id')
  update(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
  ): Promise<unknown> {
    return this.students.update(ctx, id, dto);
  }

  @RequireSchoolPermission('school.students.matricule_correct')
  @HttpCode(200)
  @Post('students/:id/matricule')
  correctMatricule(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectMatriculeDto,
  ) {
    return this.students.correctMatricule(ctx, id, dto);
  }

  @RequireSchoolPermission('school.students.sensitive')
  @Get('students/:id/sensitive')
  readSensitive(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.students.readSensitive(ctx, id);
  }

  @RequireSchoolPermission('school.students.sensitive')
  @Put('students/:id/sensitive')
  saveSensitive(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SensitiveDto,
  ) {
    return this.students.saveSensitive(ctx, id, dto.specialNeeds);
  }

  @RequireSchoolPermission('school.students.read_full')
  @Get('students/:id/history')
  history(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.students.history(ctx, id);
  }

  @RequireSchoolPermission('school.students.read_full')
  @Get('student-settings')
  settings(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolQueryDto) {
    return this.students.settings(ctx, q.schoolId);
  }

  @RequireSchoolPermission('school.students.settings')
  @Put('student-settings')
  saveSettings(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: SchoolQueryDto,
    @Body() dto: StudentSettingsDto,
  ) {
    return this.students.saveSettings(ctx, q.schoolId, dto);
  }

  // ─── Inscriptions et affectations ───

  @RequireSchoolPermission('school.students.read_full')
  @Get('enrollments')
  listEnrollments(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: EnrollmentsQueryDto,
  ): Promise<unknown> {
    return this.enrollments.list(ctx, q);
  }

  @RequireSchoolPermission('school.students.read_full')
  @Get('students/:id/enrollments')
  studentEnrollments(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.enrollments.forStudent(ctx, id);
  }

  @RequireSchoolPermission('school.enrollments.manage')
  @Post('enrollments')
  createEnrollment(
    @CurrentSchool() ctx: SchoolContext,
    @Body() dto: CreateEnrollmentDto,
  ): Promise<unknown> {
    return this.enrollments.create(ctx, dto);
  }

  @RequireSchoolPermission('school.enrollments.manage')
  @HttpCode(200)
  @Post('enrollments/:id/status')
  setEnrollmentStatus(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrollmentStatusDto,
  ): Promise<unknown> {
    return this.enrollments.setStatus(ctx, id, dto);
  }

  @RequireSchoolPermission('school.enrollments.manage')
  @HttpCode(200)
  @Post('enrollments/:id/class')
  changeClass(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeClassDto,
  ): Promise<unknown> {
    return this.enrollments.changeClass(ctx, id, dto);
  }

  @RequireSchoolPermission('school.enrollments.validate')
  @HttpCode(200)
  @Post('enrollments/:id/exit')
  exit(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExitDto,
  ): Promise<unknown> {
    return this.enrollments.exit(ctx, id, dto);
  }

  @RequireSchoolPermission('school.students.transfer')
  @HttpCode(200)
  @Post('students/:id/transfer')
  transfer(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferDto,
  ): Promise<unknown> {
    return this.enrollments.transfer(ctx, id, dto);
  }

  @RequireSchoolPermission('school.students.read')
  @Get('rosters')
  rosters(@CurrentSchool() ctx: SchoolContext, @Query() q: YearQueryDto): Promise<unknown> {
    return this.enrollments.rosters(ctx, q.schoolYearId);
  }

  @RequireSchoolPermission('school.students.read')
  @Get('classes/:id/students')
  roster(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.enrollments.roster(ctx, id);
  }

  @RequireSchoolPermission('school.structure.manage')
  @Post('classes/:id/teachers')
  addTeacher(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    // Corps toujours validé : un appel mal formé reste refusé comme tel.
    @Body() _dto: ClassTeacherDto,
  ) {
    return this.enrollments.addTeacher(ctx, id);
  }

  @RequireSchoolPermission('school.structure.manage')
  @HttpCode(204)
  @Delete('classes/:id/teachers/:memberId')
  removeTeacher(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.enrollments.removeTeacher(ctx, id, memberId);
  }

  // ─── Responsables ───

  @RequireSchoolPermission('school.guardians.read')
  @Get('guardians')
  listGuardians(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: GuardiansQueryDto,
  ): Promise<unknown> {
    return this.guardians.list(ctx, q);
  }

  @RequireSchoolPermission('school.guardians.manage')
  @Post('guardians')
  createGuardian(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateGuardianDto) {
    return this.guardians.create(ctx, dto);
  }

  @RequireSchoolPermission('school.guardians.manage')
  @Patch('guardians/:id')
  updateGuardian(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuardianDto,
  ) {
    return this.guardians.update(ctx, id, dto);
  }

  @RequireSchoolPermission('school.guardians.read')
  @Get('students/:id/guardians')
  studentGuardians(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.guardians.forStudent(ctx, id);
  }

  @RequireSchoolPermission('school.guardians.manage')
  @Post('students/:id/guardians')
  linkGuardian(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkGuardianDto,
  ): Promise<unknown> {
    return this.guardians.link(ctx, id, dto);
  }

  @RequireSchoolPermission('school.guardians.manage')
  @Patch('students/:id/guardians/:guardianId')
  updateGuardianLink(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() dto: GuardianLinkRightsDto,
  ): Promise<unknown> {
    return this.guardians.updateLink(ctx, id, guardianId, dto);
  }

  @RequireSchoolPermission('school.guardians.manage')
  @HttpCode(204)
  @Delete('students/:id/guardians/:guardianId')
  unlinkGuardian(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
  ) {
    return this.guardians.unlink(ctx, id, guardianId);
  }

  // ─── Documents ───

  @RequireSchoolPermission('school.documents.read')
  @Get('students/:id/documents')
  listDocuments(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.documents.list(ctx, id);
  }

  @RequireSchoolPermission('school.documents.manage')
  @UseInterceptors(documentFile)
  @Post('students/:id/documents')
  uploadDocument(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: SchoolUpload | undefined,
  ): Promise<unknown> {
    return this.documents.upload(ctx, id, dto.category, file);
  }

  @RequireSchoolPermission('school.documents.read')
  @Get('students/:id/documents/:documentId/link')
  documentLink(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.link(ctx, id, documentId);
  }

  @RequireSchoolPermission('school.documents.delete')
  @HttpCode(204)
  @Delete('students/:id/documents/:documentId')
  removeDocument(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.remove(ctx, id, documentId);
  }

  // ─── Imports et exports ───

  @RequireSchoolPermission('school.students.import')
  @UseInterceptors(importFile)
  @HttpCode(200)
  @Post('imports/preview')
  previewImport(
    @CurrentSchool() ctx: SchoolContext,
    @Body() dto: ImportDto,
    @UploadedFile() file: SchoolUpload | undefined,
  ): Promise<unknown> {
    return this.imports.preview(ctx, dto, file?.buffer);
  }

  @RequireSchoolPermission('school.students.import')
  @UseInterceptors(importFile)
  @Post('imports')
  commitImport(
    @CurrentSchool() ctx: SchoolContext,
    @Body() dto: ImportDto,
    @UploadedFile() file: SchoolUpload | undefined,
  ): Promise<unknown> {
    return this.imports.commit(ctx, dto, file?.buffer);
  }

  @RequireSchoolPermission('school.students.import')
  @Get('imports')
  importHistory(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolQueryDto): Promise<unknown> {
    return this.imports.history(ctx, q.schoolId);
  }

  @RequireSchoolPermission('school.students.export')
  @ExportRoute()
  @Get('exports/students')
  async exportStudents(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: ExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return attachment(res, await this.imports.exportStudents(ctx, q));
  }

  @RequireSchoolPermission('school.students.export')
  @ExportRoute()
  @Get('exports/guardians')
  async exportGuardians(
    @CurrentSchool() ctx: SchoolContext,
    @Query() q: ExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return attachment(res, await this.imports.exportGuardians(ctx, q));
  }
}

/**
 * Téléchargement : le lien signé ne suffit jamais. Chaque accès exige la session de son bénéficiaire et
 * repasse le contrôle complet (compte, contrat, rôle, établissement actuel de l'élève).
 */
@ApiTags('Ocall School — élèves')
@UseGuards(SchoolAccessGuard)
@Controller('school/files')
export class SchoolFilesController {
  constructor(private readonly documents: SchoolDocumentsService) {}

  @Throttle({ global: { ttl: 60_000, limit: 60 } })
  @RequireSchoolPermission('school.documents.read')
  @Get(':token')
  async download(
    @CurrentSchool() ctx: SchoolContext,
    @Param('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.documents.download(ctx, token, requestMeta(req));
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.displayName)}`,
    );
    return new StreamableFile(file.body);
  }
}
