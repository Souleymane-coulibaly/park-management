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
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CurrentSchool,
  RequireSchoolPermission,
  SchoolAccessGuard,
  type SchoolContext,
} from './school-access';
import {
  ActivateCatalogSubjectDto,
  AssignmentQueryDto,
  CreateAssignmentDto,
  CreateGroupDto,
  EndAssignmentDto,
  GroupStudentsDto,
  ReplaceAssignmentDto,
  SubjectLevelsDto,
  TeacherQueryDto,
  TeacherSubjectsDto,
  UpdateClassDto,
  UpdateGroupDto,
  UpdateSubjectDto,
} from './school-teaching.dto';
import { SchoolTeachingService } from './school-teaching.service';
import { SchoolQueryDto } from './school.dto';

const READ = 'school.structure.read';
const MANAGE = 'school.structure.manage';
const TEACHING_READ = 'school.teaching.read';
const TEACHING_MANAGE = 'school.teaching.manage';

/** Équipe pédagogique (Sprint 3B). Chaque route vérifie sa permission côté serveur. */
@ApiTags('Ocall School — équipe pédagogique')
@UseGuards(SchoolAccessGuard)
@Controller('school')
export class SchoolTeachingController {
  constructor(private readonly teaching: SchoolTeachingService) {}

  // ─── Matières ───

  @RequireSchoolPermission(READ)
  @Get('subjects/catalog')
  catalog(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolQueryDto) {
    return this.teaching.catalog(ctx, q.schoolId);
  }

  @RequireSchoolPermission(MANAGE)
  @Post('subjects/catalog/:key/activate')
  activate(
    @CurrentSchool() ctx: SchoolContext,
    @Param('key') key: string,
    @Body() dto: ActivateCatalogSubjectDto,
  ): Promise<unknown> {
    return this.teaching.activateCatalogSubject(ctx, key, dto.schoolId);
  }

  @RequireSchoolPermission(MANAGE)
  @Patch('subjects/:id')
  updateSubject(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubjectDto,
  ): Promise<unknown> {
    return this.teaching.updateSubject(ctx, id, dto);
  }

  @RequireSchoolPermission(MANAGE)
  @Put('subjects/:id/levels')
  setSubjectLevels(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubjectLevelsDto,
  ): Promise<unknown> {
    return this.teaching.setSubjectLevels(ctx, id, dto);
  }

  // ─── Classes et groupes ───

  @RequireSchoolPermission(READ)
  @Get('classes/:id')
  classDetail(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.teaching.classDetail(ctx, id);
  }

  @RequireSchoolPermission(MANAGE)
  @Patch('classes/:id')
  updateClass(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
  ) {
    return this.teaching.updateClass(ctx, id, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('classes/:id/groups')
  listGroups(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.teaching.listGroups(ctx, id);
  }

  @RequireSchoolPermission(MANAGE)
  @Post('classes/:id/groups')
  createGroup(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGroupDto,
  ) {
    return this.teaching.createGroup(ctx, id, dto);
  }

  @RequireSchoolPermission(MANAGE)
  @Patch('groups/:id')
  updateGroup(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.teaching.updateGroup(ctx, id, dto);
  }

  @RequireSchoolPermission(MANAGE)
  @Put('groups/:id/students')
  setGroupStudents(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GroupStudentsDto,
  ) {
    return this.teaching.setGroupStudents(ctx, id, dto);
  }

  // ─── Enseignants ───

  @RequireSchoolPermission(TEACHING_READ)
  @Get('teachers')
  listTeachers(@CurrentSchool() ctx: SchoolContext, @Query() q: TeacherQueryDto) {
    return this.teaching.listTeachers(ctx, q);
  }

  @RequireSchoolPermission(TEACHING_READ)
  @Get('teachers/:id')
  teacherDetail(@CurrentSchool() ctx: SchoolContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.teaching.teacherDetail(ctx, id);
  }

  @RequireSchoolPermission(TEACHING_MANAGE)
  @Put('teachers/:id/subjects')
  setTeacherSubjects(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TeacherSubjectsDto,
  ) {
    return this.teaching.setTeacherSubjects(ctx, id, dto);
  }

  /** « Mes classes » : toute personne connectée ne lit que ses propres affectations. */
  @RequireSchoolPermission(READ)
  @Get('teaching/mine')
  mine(@CurrentSchool() ctx: SchoolContext) {
    return this.teaching.mine(ctx);
  }

  // ─── Affectations ───

  @RequireSchoolPermission(TEACHING_READ)
  @Get('teaching-assignments')
  listAssignments(@CurrentSchool() ctx: SchoolContext, @Query() q: AssignmentQueryDto) {
    return this.teaching.listAssignments(ctx, q);
  }

  @RequireSchoolPermission(TEACHING_MANAGE)
  @Post('teaching-assignments')
  createAssignment(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateAssignmentDto) {
    return this.teaching.createAssignment(ctx, dto);
  }

  @RequireSchoolPermission(TEACHING_MANAGE)
  @Post('teaching-assignments/:id/end')
  @HttpCode(200)
  endAssignment(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndAssignmentDto,
  ) {
    return this.teaching.endAssignment(ctx, id, dto);
  }

  @RequireSchoolPermission(TEACHING_MANAGE)
  @Post('teaching-assignments/:id/replace')
  replaceAssignment(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceAssignmentDto,
  ) {
    return this.teaching.replaceAssignment(ctx, id, dto);
  }
}
