import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { download } from '../../common/download';
import {
  CurrentFacture,
  FactureAccessGuard,
  type FactureContext,
  RequireFacturePermission,
} from './facture-access';
import { FactureBillingService } from './facture-billing.service';
import {
  CancelFacturePaymentDto,
  FactureExportQueryDto,
  RecordFacturePaymentDto,
  SendFactureDocumentDto,
} from './facture-commercial.dto';
import { FactureDocumentsService } from './facture-documents.service';

const uuid = new ParseUUIDPipe();
const CSV = 'text/csv; charset=utf-8';

/** Ocall Facture — facturation (F2) : avoirs, encaissements, relances, tableau de bord, exports. */
@ApiTags('Ocall Facture')
@UseGuards(FactureAccessGuard)
@Controller('facture')
export class FactureBillingController {
  constructor(
    private readonly billing: FactureBillingService,
    private readonly documents: FactureDocumentsService,
  ) {}

  @RequireFacturePermission('facture.billing.manage')
  @Post('documents/:id/credit-note')
  creditNote(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.documents.createCreditNote(ctx, id);
  }

  @RequireFacturePermission('facture.billing.manage')
  @Post('documents/:id/payments')
  recordPayment(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: RecordFacturePaymentDto,
  ) {
    return this.billing.recordPayment(ctx, id, dto);
  }

  @RequireFacturePermission('facture.billing.manage')
  @HttpCode(200)
  @Post('documents/:id/payments/:paymentId/cancel')
  cancelPayment(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Param('paymentId', uuid) paymentId: string,
    @Body() dto: CancelFacturePaymentDto,
  ) {
    return this.billing.cancelPayment(ctx, id, paymentId, dto.reason);
  }

  @RequireFacturePermission('facture.documents.manage')
  @HttpCode(200)
  @Post('documents/:id/remind')
  remind(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: SendFactureDocumentDto,
  ) {
    return this.documents.remind(ctx, id, dto);
  }

  @RequireFacturePermission('facture.documents.read')
  @Get('dashboard')
  dashboard(@CurrentFacture() ctx: FactureContext) {
    return this.billing.dashboard(ctx);
  }

  @RequireFacturePermission('facture.reports.read')
  @Get('exports/sales')
  async sales(
    @CurrentFacture() ctx: FactureContext,
    @Query() query: FactureExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, filename } = await this.billing.salesJournal(ctx, query);
    return download(res, body, CSV, filename);
  }

  @RequireFacturePermission('facture.reports.read')
  @Get('exports/payments')
  async payments(
    @CurrentFacture() ctx: FactureContext,
    @Query() query: FactureExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, filename } = await this.billing.paymentsJournal(ctx, query);
    return download(res, body, CSV, filename);
  }
}
