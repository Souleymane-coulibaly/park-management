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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, Public, RequirePlatformPermission } from '../../common/decorators';
import { PublicLeadRoute, PublicSiteRoute } from '../../common/throttling';
import { CreateDemoRequestDto, DemoRequestsQueryDto, UpdateDemoRequestDto } from './commercial.dto';
import { CommercialService } from './commercial.service';

/** Site commercial Ocall Suite : catalogue public et demandes de démonstration (Sprint 12A). */
@ApiTags('public')
@Public()
@Controller('public/suite')
export class PublicCommercialController {
  constructor(private readonly commercial: CommercialService) {}

  @PublicSiteRoute()
  @Get('products')
  catalog() {
    return this.commercial.catalog();
  }

  @PublicSiteRoute()
  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.commercial.product(slug.slice(0, 60));
  }

  @PublicLeadRoute()
  @HttpCode(201)
  @Post('demo-requests')
  createDemoRequest(@Body() dto: CreateDemoRequestDto) {
    return this.commercial.createDemoRequest(dto);
  }
}

@ApiTags('platform')
@Controller('platform/demo-requests')
export class PlatformDemoRequestsController {
  constructor(private readonly commercial: CommercialService) {}

  @RequirePlatformPermission('platform.demo.manage')
  @Get()
  list(@Query() query: DemoRequestsQueryDto) {
    return this.commercial.listDemoRequests(query);
  }

  @RequirePlatformPermission('platform.demo.manage')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDemoRequestDto,
  ) {
    return this.commercial.updateDemoRequest(auth, id, dto);
  }

  @RequirePlatformPermission('platform.demo.manage')
  @HttpCode(200)
  @Post('purge')
  purge(@CurrentAuth() auth: AuthContext) {
    return this.commercial.purgeExpired(auth);
  }
}
