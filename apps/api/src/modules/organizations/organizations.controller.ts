import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../common/decorators';
import { OrganizationInvitationsService } from './organization-invitations.service';
import {
  ChangeBusinessTypeDto,
  CreateInvitationDto,
  UpdateOrganizationDto,
} from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organisation')
@Controller('organization')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly invitations: OrganizationInvitationsService,
  ) {}

  /** Ocall Suite Sprint 2C : invitations de personnes ayant déjà un compte Ocall. */
  @RequirePermission('employee.manage')
  @Get('invitations')
  listInvitations(@CurrentAuth() auth: AuthContext) {
    return this.invitations.list(requireTenant(auth));
  }

  @RequirePermission('employee.manage')
  @Post('invitations')
  invite(@CurrentAuth() auth: AuthContext, @Body() dto: CreateInvitationDto) {
    return this.invitations.create(requireTenant(auth), dto);
  }

  @RequirePermission('employee.manage')
  @Post('invitations/:id/revoke')
  revokeInvitation(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.revoke(requireTenant(auth), id);
  }

  @RequirePermission('organization.read')
  @Get()
  current(@CurrentAuth() auth: AuthContext) {
    return this.organizations.current(requireTenant(auth));
  }

  @RequirePermission('organization.update')
  @Patch()
  update(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateOrganizationDto) {
    return this.organizations.update(requireTenant(auth), dto);
  }

  @RequirePermission('organization.change_business_type')
  @Post('business-type')
  changeBusinessType(@CurrentAuth() auth: AuthContext, @Body() dto: ChangeBusinessTypeDto) {
    return this.organizations.changeBusinessType(requireTenant(auth), dto);
  }
}
