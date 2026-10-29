import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators';
import { PaymentMethodsService } from './payment-methods.service';

@ApiTags('Paiements')
@Controller('payments')
class PaymentsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  /** Moyens de paiement et disponibilité réelle (Wave : non activé). */
  @RequirePermission('pos.sell')
  @Get('methods')
  list() {
    return this.methods.list();
  }
}

@Module({
  controllers: [PaymentsController],
  providers: [PaymentMethodsService],
  exports: [PaymentMethodsService],
})
export class PaymentsModule {}
