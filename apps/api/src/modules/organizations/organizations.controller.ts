import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../common/decorators';
import { ChangeBusinessTypeDto, UpdateOrganizationDto } from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organisation')
@Controller('organization')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

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
