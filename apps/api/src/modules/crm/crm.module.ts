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
import { CurrentAuth, RequirePermission } from '../../common/decorators';
import {
  CreateCustomerDto,
  CustomersQueryDto,
  EraseCustomerDto,
  UpdateCustomerDto,
} from './crm.dto';
import { CrmService } from './crm.service';

/** Clients (CRM) : commun au parc et au restaurant, sans restriction d'activité. */
@ApiTags('Clients (CRM)')
@Controller('customers')
class CustomersController {
  constructor(private readonly crm: CrmService) {}

  /** Recherche (caissier : 3 caractères au moins, 10 résultats) ou liste filtrée (responsables). */
  @RequirePermission('customer.read')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() q: CustomersQueryDto) {
    return this.crm.list(requireTenant(auth), q);
  }

  @RequirePermission('customer.manage')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateCustomerDto) {
    return this.crm.create(requireTenant(auth), dto);
  }

  /** Règle de conservation : anonymise les fiches sans visite depuis 36 mois. */
  @RequirePermission('customer.erase')
  @HttpCode(200)
  @Post('retention/apply')
  retention(@CurrentAuth() auth: AuthContext) {
    return this.crm.applyRetention(requireTenant(auth));
  }

  @RequirePermission('customer.read')
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.crm.get(requireTenant(auth), id);
  }

  @RequirePermission('customer.manage')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.crm.update(requireTenant(auth), id, dto);
  }

  /** Demande de suppression : anonymisation (irréversible). */
  @RequirePermission('customer.erase')
  @HttpCode(200)
  @Post(':id/anonymize')
  erase(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EraseCustomerDto,
  ) {
    return this.crm.erase(requireTenant(auth), id, dto.reason);
  }
}

@Module({
  controllers: [CustomersController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
