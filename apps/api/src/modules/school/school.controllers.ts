import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePlatformPermission } from '../../common/decorators';
import {
  CurrentSchool,
  RequireSchoolPermission,
  SchoolAccessGuard,
  type SchoolContext,
} from './school-access';
import { SchoolMembersService } from './school-members.service';
import { SchoolPrismaService } from './school-prisma.service';
import {
  CreateClassDto,
  CreateCycleDto,
  CreateGradingPolicyDto,
  CreateLevelDto,
  CreateMemberDto,
  CreatePeriodDto,
  CreateSchoolDto,
  CreateSubjectDto,
  CreateTrackDto,
  CreateYearDto,
  SchoolQueryDto,
  UpdateMemberDto,
  UpdateSchoolDto,
  YearQueryDto,
  YearStatusDto,
} from './school.dto';
import { SchoolService } from './school.service';

const READ = 'school.structure.read';
const MANAGE = 'school.structure.manage';

@ApiTags('Ocall School')
@UseGuards(SchoolAccessGuard)
@Controller('school')
export class SchoolController {
  constructor(
    private readonly school: SchoolService,
    private readonly members: SchoolMembersService,
  ) {}

  @RequireSchoolPermission(READ)
  @Get('context')
  context(@CurrentSchool() ctx: SchoolContext) {
    return this.school.context(ctx);
  }

  @RequireSchoolPermission(READ)
  @Get('dashboard')
  dashboard(@CurrentSchool() ctx: SchoolContext) {
    return this.school.dashboard(ctx);
  }

  @RequireSchoolPermission(READ)
  @Get('schools')
  listSchools(@CurrentSchool() ctx: SchoolContext) {
    return this.school.listSchools(ctx);
  }

  @RequireSchoolPermission('school.schools.manage')
  @Post('schools')
  createSchool(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateSchoolDto) {
    return this.school.createSchool(ctx, dto);
  }

  @RequireSchoolPermission(MANAGE)
  @Patch('schools/:id')
  updateSchool(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSchoolDto,
  ) {
    return this.school.updateSchool(ctx, id, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('years')
  listYears(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolQueryDto) {
    return this.school.listYears(ctx, q.schoolId);
  }

  @RequireSchoolPermission(MANAGE)
  @Post('years')
  createYear(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateYearDto) {
    return this.school.createYear(ctx, dto);
  }

  @RequireSchoolPermission(MANAGE)
  @HttpCode(200)
  @Post('years/:id/status')
  setYearStatus(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: YearStatusDto,
  ) {
    return this.school.setYearStatus(ctx, id, dto);
  }

  @RequireSchoolPermission(MANAGE)
  @Post('periods')
  createPeriod(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreatePeriodDto) {
    return this.school.createPeriod(ctx, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('tracks')
  listTracks(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolQueryDto) {
    return this.school.listTracks(ctx, q.schoolId);
  }

  @RequireSchoolPermission(MANAGE)
  @Post('tracks')
  createTrack(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateTrackDto) {
    return this.school.createTrack(ctx, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('cycles')
  listCycles(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolQueryDto) {
    return this.school.listCycles(ctx, q.schoolId);
  }

  @RequireSchoolPermission(MANAGE)
  @Post('cycles')
  createCycle(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateCycleDto) {
    return this.school.createCycle(ctx, dto);
  }

  @RequireSchoolPermission(MANAGE)
  @Post('levels')
  createLevel(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateLevelDto) {
    return this.school.createLevel(ctx, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('classes')
  listClasses(@CurrentSchool() ctx: SchoolContext, @Query() q: YearQueryDto) {
    return this.school.listClasses(ctx, q.schoolYearId);
  }

  @RequireSchoolPermission(MANAGE)
  @Post('classes')
  createClass(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateClassDto) {
    return this.school.createClass(ctx, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('subjects')
  listSubjects(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolQueryDto): Promise<unknown> {
    return this.school.listSubjects(ctx, q.schoolId);
  }

  @RequireSchoolPermission(MANAGE)
  @Post('subjects')
  createSubject(
    @CurrentSchool() ctx: SchoolContext,
    @Body() dto: CreateSubjectDto,
  ): Promise<unknown> {
    return this.school.createSubject(ctx, dto);
  }

  @RequireSchoolPermission(READ)
  @Get('grading-policies')
  listPolicies(@CurrentSchool() ctx: SchoolContext, @Query() q: SchoolQueryDto): Promise<unknown> {
    return this.school.listPolicies(ctx, q.schoolId);
  }

  @RequireSchoolPermission('school.grading.manage')
  @Post('grading-policies')
  createPolicy(
    @CurrentSchool() ctx: SchoolContext,
    @Body() dto: CreateGradingPolicyDto,
  ): Promise<unknown> {
    return this.school.createPolicy(ctx, dto);
  }

  @RequireSchoolPermission('school.members.read')
  @Get('members')
  listMembers(@CurrentSchool() ctx: SchoolContext) {
    return this.members.list(ctx);
  }

  /** Le mot de passe temporaire n'est renvoyé qu'ici. */
  @RequireSchoolPermission('school.members.manage')
  @Post('members')
  createMember(@CurrentSchool() ctx: SchoolContext, @Body() dto: CreateMemberDto) {
    return this.members.create(ctx, dto);
  }

  @RequireSchoolPermission('school.members.manage')
  @Patch('members/:id')
  updateMember(
    @CurrentSchool() ctx: SchoolContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.members.update(ctx, id, dto);
  }

  @RequireSchoolPermission('school.export')
  @Get('export')
  export(@CurrentSchool() ctx: SchoolContext): Promise<unknown> {
    return this.school.export(ctx);
  }
}

/** Établissements d'un client pour la couverture d'un contrat : noms seulement, aucune donnée scolaire. */
@ApiTags('Ocall Suite — contrats')
@Controller('platform/school-organizations')
export class SchoolPlatformController {
  constructor(private readonly db: SchoolPrismaService) {}

  @RequirePlatformPermission('platform.orgs.read')
  @Get(':organizationId/schools')
  schools(@Param('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.db.school.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, nameAr: true, type: true, isActive: true },
    });
  }
}
