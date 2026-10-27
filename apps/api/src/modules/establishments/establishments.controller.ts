import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../common/decorators';
import { CreateEstablishmentDto, UpdateEstablishmentDto } from './establishments.dto';
import { EstablishmentsService } from './establishments.service';

@ApiTags('Établissements')
@Controller('establishments')
export class EstablishmentsController {
  constructor(private readonly establishments: EstablishmentsService) {}

  @RequirePermission('establishment.read')
  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.establishments.list(requireTenant(auth));
  }

  @RequirePermission('establishment.read')
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.establishments.get(requireTenant(auth), id);
  }

  @RequirePermission('establishment.manage')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateEstablishmentDto) {
    return this.establishments.create(requireTenant(auth), dto);
  }

  @RequirePermission('establishment.manage')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEstablishmentDto,
  ) {
    return this.establishments.update(requireTenant(auth), id, dto);
  }
}
