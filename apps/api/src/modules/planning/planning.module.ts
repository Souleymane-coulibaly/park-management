import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../common/decorators';
import {
  AssignmentsQueryDto,
  CreateAssignmentDto,
  CreatePositionDto,
  EstablishmentParamQuery,
  PlanningRangeDto,
  UpdateAssignmentDto,
  UpdatePositionDto,
} from './planning.dto';
import { PlanningService } from './planning.service';

/** Planning du personnel (commun au parc et au restaurant). */
@ApiTags('Planning du personnel')
@Controller('planning')
class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  /** Mon planning : tout employé voit ses propres créneaux. */
  @RequirePermission('dashboard.read')
  @Get('me')
  mine(@CurrentAuth() auth: AuthContext, @Query() q: PlanningRangeDto) {
    return this.planning.mine(requireTenant(auth), q);
  }

  @RequirePermission('planning.manage')
  @Get('positions')
  positions(@CurrentAuth() auth: AuthContext) {
    return this.planning.positions(requireTenant(auth));
  }

  @RequirePermission('planning.manage')
  @Post('positions')
  createPosition(@CurrentAuth() auth: AuthContext, @Body() dto: CreatePositionDto) {
    return this.planning.createPosition(requireTenant(auth), dto);
  }

  @RequirePermission('planning.manage')
  @Patch('positions/:id')
  updatePosition(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePositionDto,
  ) {
    return this.planning.updatePosition(requireTenant(auth), id, dto);
  }

  @RequirePermission('planning.manage')
  @Get('staff')
  staff(@CurrentAuth() auth: AuthContext, @Query() q: EstablishmentParamQuery) {
    return this.planning.staff(requireTenant(auth), q.establishmentId);
  }

  @RequirePermission('planning.manage')
  @Get('assignments')
  list(@CurrentAuth() auth: AuthContext, @Query() q: AssignmentsQueryDto) {
    return this.planning.list(requireTenant(auth), q.establishmentId, q);
  }

  @RequirePermission('planning.manage')
  @Post('assignments')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateAssignmentDto) {
    return this.planning.create(requireTenant(auth), dto);
  }

  @RequirePermission('planning.manage')
  @Patch('assignments/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.planning.update(requireTenant(auth), id, dto);
  }

  @RequirePermission('planning.manage')
  @HttpCode(204)
  @Delete('assignments/:id')
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.planning.remove(requireTenant(auth), id);
  }
}

@Module({
  controllers: [PlanningController],
  providers: [PlanningService],
})
export class PlanningModule {}
