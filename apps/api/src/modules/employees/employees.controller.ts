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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../common/decorators';
import {
  ChangeRoleDto,
  CreateEmployeeDto,
  SetAssignmentsDto,
  UpdateEmployeeDto,
} from './employees.dto';
import { EmployeesService } from './employees.service';

/** L'identifiant d'un employé est celui de son adhésion à l'organisation. */
@ApiTags('Employés')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @RequirePermission('employee.read')
  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.employees.list(requireTenant(auth));
  }

  @RequirePermission('employee.read')
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.get(requireTenant(auth), id);
  }

  @RequirePermission('employee.manage')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(requireTenant(auth), dto);
  }

  @RequirePermission('employee.manage')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(requireTenant(auth), id, dto);
  }

  @RequirePermission('role.assign')
  @Put(':id/role')
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.employees.changeRole(requireTenant(auth), id, dto);
  }

  @RequirePermission('employee.manage')
  @Put(':id/establishments')
  setAssignments(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAssignmentsDto,
  ) {
    return this.employees.setAssignments(requireTenant(auth), id, dto);
  }

  @RequirePermission('employee.manage')
  @HttpCode(200)
  @Post(':id/deactivate')
  deactivate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.deactivate(requireTenant(auth), id);
  }

  @RequirePermission('employee.manage')
  @HttpCode(200)
  @Post(':id/reactivate')
  reactivate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.reactivate(requireTenant(auth), id);
  }

  @RequirePermission('employee.manage')
  @HttpCode(200)
  @Post(':id/reset-password')
  resetPassword(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.resetPassword(requireTenant(auth), id);
  }
}
