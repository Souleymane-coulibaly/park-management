import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, SuperAdminOnly } from '../../common/decorators';
import {
  CreateOrganizationByAdminDto,
  SetOrganizationStatusDto,
  UpdatePlanDto,
} from './platform.dto';
import { PlatformService } from './platform.service';

@ApiTags('Plateforme (Super Admin)')
@SuperAdminOnly()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview')
  overview() {
    return this.platform.overview();
  }

  @Get('organizations')
  organizations() {
    return this.platform.organizations();
  }

  @Post('organizations')
  createOrganization(@CurrentAuth() auth: AuthContext, @Body() dto: CreateOrganizationByAdminDto) {
    return this.platform.createOrganization(auth, dto);
  }

  @Patch('organizations/:id/status')
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOrganizationStatusDto,
  ) {
    return this.platform.setStatus(auth, id, dto);
  }

  @Get('subscriptions')
  subscriptions() {
    return this.platform.subscriptions();
  }

  @Get('plans')
  plans() {
    return this.platform.plans();
  }

  @Patch('plans/:id')
  updatePlan(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.platform.updatePlan(auth, id, dto);
  }
}
