import {
  Body,
  Controller,
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
import { CurrentAuth, RequireActivity, RequirePermission } from '../../common/decorators';
import { DrawerService } from './drawer.service';
import {
  CreateDrawerEventDto,
  CreatePrintJobDto,
  CreateTerminalDto,
  DrawerEventsQueryDto,
  HardwareResultDto,
  PrintJobsQueryDto,
  TerminalsQueryDto,
  UpdateTerminalDto,
} from './hardware.dto';
import { PrintJobsService } from './print-jobs.service';
import { TerminalsService } from './terminals.service';

@ApiTags('Matériel de caisse')
@RequireActivity('RESTAURANT')
@Controller('pos-terminals')
class TerminalsController {
  constructor(private readonly terminals: TerminalsService) {}

  @RequirePermission('pos.sell')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: TerminalsQueryDto) {
    return this.terminals.list(requireTenant(auth), query);
  }

  @RequirePermission('hardware.manage')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTerminalDto) {
    return this.terminals.create(requireTenant(auth), dto);
  }

  @RequirePermission('hardware.manage')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTerminalDto,
  ) {
    return this.terminals.update(requireTenant(auth), id, dto);
  }
}

@ApiTags('Matériel de caisse')
@RequireActivity('RESTAURANT')
@Controller('print-jobs')
class PrintJobsController {
  constructor(private readonly printJobs: PrintJobsService) {}

  /** Demande d'impression : renvoie le flux ESC/POS à transmettre à l'imprimante. */
  @RequirePermission('pos.sell')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreatePrintJobDto) {
    return this.printJobs.create(requireTenant(auth), dto);
  }

  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post(':id/result')
  result(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HardwareResultDto,
  ) {
    return this.printJobs.reportResult(requireTenant(auth), id, dto);
  }

  @RequirePermission('pos.sell')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: PrintJobsQueryDto) {
    return this.printJobs.list(requireTenant(auth), query);
  }
}

@ApiTags('Matériel de caisse')
@RequireActivity('RESTAURANT')
@Controller('drawer-events')
class DrawerEventsController {
  constructor(private readonly drawer: DrawerService) {}

  @RequirePermission('pos.sell')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateDrawerEventDto) {
    return this.drawer.create(requireTenant(auth), dto);
  }

  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post(':id/result')
  result(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HardwareResultDto,
  ) {
    return this.drawer.reportResult(requireTenant(auth), id, dto);
  }

  @RequirePermission('pos.sell')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: DrawerEventsQueryDto) {
    return this.drawer.list(requireTenant(auth), query);
  }
}

@Module({
  controllers: [TerminalsController, PrintJobsController, DrawerEventsController],
  providers: [TerminalsService, PrintJobsService, DrawerService],
})
export class HardwareModule {}
