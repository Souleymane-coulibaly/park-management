import {
  Body,
  type CanActivate,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { assertAppEnabled } from '../../common/app-guard';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, RequirePlatformPermission } from '../../common/decorators';
import { download } from '../../common/download';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrintProductionService } from './print-production.service';
import { PrintRetentionService } from './print-retention.service';
import { PrintAdvanceDto, PrintPaymentDto, PrintQueueQueryDto, PrintReasonDto } from './print.dto';

/** Routes de l'atelier introuvables quand Ocall Print est désactivé. */
@Injectable()
export class PrintEnabledGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  canActivate(): boolean {
    assertAppEnabled(this.config.print.enabled);
    return true;
  }
}

/**
 * Atelier Ocall Print (Bamako) et supervision centrale depuis le Super Admin. L'imprimeur
 * (`PRINT_OPERATOR`) n'a accès qu'à ces routes de production ; propriétaire et administrateurs de la
 * plateforme supervisent (tableau de suivi, annulation d'un règlement, purge manuelle).
 */
@ApiTags('Plateforme — Ocall Print')
@UseGuards(PrintEnabledGuard)
@Controller('platform/print')
export class PrintPlatformController {
  constructor(
    private readonly production: PrintProductionService,
    private readonly retention: PrintRetentionService,
  ) {}

  @RequirePlatformPermission('platform.print.production')
  @Get('orders')
  queue(@Query() q: PrintQueueQueryDto) {
    return this.production.queue({ status: q.status });
  }

  @RequirePlatformPermission('platform.print.supervise')
  @Get('overview')
  overview() {
    return this.production.overview();
  }

  @RequirePlatformPermission('platform.print.production')
  @Get('orders/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.detail(id);
  }

  @RequirePlatformPermission('platform.print.production')
  @HttpCode(200)
  @Post('orders/:id/advance')
  advance(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintAdvanceDto,
  ) {
    return this.production.advance({ userId: auth.user.id }, id, dto.status);
  }

  @RequirePlatformPermission('platform.print.production')
  @HttpCode(200)
  @Post('orders/:id/reject')
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintReasonDto,
  ) {
    return this.production.rejectOrder({ userId: auth.user.id }, id, dto.reason);
  }

  @RequirePlatformPermission('platform.print.production')
  @HttpCode(200)
  @Post('orders/:id/items/:itemId/reject')
  rejectItem(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: PrintReasonDto,
  ) {
    return this.production.rejectItem({ userId: auth.user.id }, id, itemId, dto.reason);
  }

  @RequirePlatformPermission('platform.print.production')
  @HttpCode(200)
  @Post('orders/:id/payment')
  pay(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintPaymentDto,
  ) {
    return this.production.recordPayment({ userId: auth.user.id }, id, dto);
  }

  @RequirePlatformPermission('platform.print.supervise')
  @HttpCode(200)
  @Post('orders/:id/payment/cancel')
  cancelPayment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintReasonDto,
  ) {
    return this.production.cancelPayment({ userId: auth.user.id }, id, dto.reason);
  }

  @RequirePlatformPermission('platform.print.production')
  @Get('orders/:id/production.pdf')
  async productionPdf(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { pdf, number } = await this.production.productionPdf({ userId: auth.user.id }, id);
    return download(res, pdf, 'application/pdf', `production-${number}.pdf`);
  }

  @RequirePlatformPermission('platform.print.supervise')
  @HttpCode(200)
  @Post('retention/run')
  runRetention() {
    return this.retention.run(new Date(), 'manual');
  }
}
