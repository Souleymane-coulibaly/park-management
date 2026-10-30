import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequireActivity, RequirePermission } from '../../common/decorators';
import { PosModule } from '../pos/pos.module';
import {
  ActivityParam,
  LoyaltyAdjustmentDto,
  LoyaltyRuleDto,
  RedemptionDto,
  SaleCustomerDto,
} from './loyalty.dto';
import { LoyaltyService } from './loyalty.service';

@ApiTags('Fidélité')
@Controller('loyalty')
class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @RequirePermission('customer.read')
  @Get('rules')
  rules(@CurrentAuth() auth: AuthContext) {
    return this.loyalty.rules(requireTenant(auth));
  }

  @RequirePermission('loyalty.configure')
  @Put('rules/:activity')
  putRule(
    @CurrentAuth() auth: AuthContext,
    @Param() p: ActivityParam,
    @Body() dto: LoyaltyRuleDto,
  ) {
    return this.loyalty.putRule(requireTenant(auth), p.activity, dto);
  }

  /** Correction manuelle motivée (audit), sans solde négatif. */
  @RequirePermission('loyalty.adjust')
  @Post('adjustments')
  adjust(@CurrentAuth() auth: AuthContext, @Body() dto: LoyaltyAdjustmentDto) {
    return this.loyalty.adjust(requireTenant(auth), dto);
  }
}

/** Client et fidélité d'une vente (caisse et billetterie, moteur de vente commun). */
@ApiTags('Fidélité')
@RequireActivity('RESTAURANT', 'PARK')
@Controller('sales')
class SaleLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @RequirePermission('pos.sell')
  @Put(':id/customer')
  setCustomer(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaleCustomerDto,
  ) {
    return this.loyalty.setSaleCustomer(requireTenant(auth), id, dto.customerId ?? null);
  }

  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post(':id/loyalty-redemption')
  redeem(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RedemptionDto,
  ) {
    return this.loyalty.redeem(requireTenant(auth), id, dto.points);
  }

  @RequirePermission('pos.sell')
  @Delete(':id/loyalty-redemption')
  cancelRedemption(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.loyalty.cancelRedemption(requireTenant(auth), id);
  }
}

@Module({
  imports: [PosModule],
  controllers: [LoyaltyController, SaleLoyaltyController],
  providers: [LoyaltyService],
})
export class LoyaltyModule {}
