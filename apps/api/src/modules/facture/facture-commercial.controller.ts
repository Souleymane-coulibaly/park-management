import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import { FactureClientsService } from './facture-clients.service';
import {
  CancelFactureDocumentDto,
  ConvertFactureDocumentDto,
  CreateFactureDocumentDto,
  FactureClientDto,
  FactureDocumentQueryDto,
  FactureDraftDto,
  FactureItemDto,
  FactureListQueryDto,
  SendFactureDocumentDto,
  UpdateFactureClientDto,
  UpdateFactureItemDto,
} from './facture-commercial.dto';
import { FactureDocumentsService } from './facture-documents.service';

const uuid = new ParseUUIDPipe();

/** Ocall Facture — commercial (F1) : clients, catalogue, devis, pro forma, bons de commande, PDF, envoi. */
@ApiTags('Ocall Facture')
@UseGuards(FactureAccessGuard)
@Controller('facture')
export class FactureCommercialController {
  constructor(
    private readonly clients: FactureClientsService,
    private readonly documents: FactureDocumentsService,
  ) {}

  // ─── Clients ───

  @RequireFacturePermission('facture.clients.read')
  @Get('clients')
  listClients(@CurrentFacture() ctx: FactureContext, @Query() query: FactureListQueryDto) {
    return this.clients.listClients(ctx, query);
  }

  @RequireFacturePermission('facture.clients.read')
  @Get('clients/:id')
  client(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.clients.client(ctx, id);
  }

  @RequireFacturePermission('facture.clients.manage')
  @Post('clients')
  createClient(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureClientDto) {
    return this.clients.createClient(ctx, dto);
  }

  @RequireFacturePermission('facture.clients.manage')
  @Patch('clients/:id')
  updateClient(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateFactureClientDto,
  ) {
    return this.clients.updateClient(ctx, id, dto);
  }

  // ─── Catalogue ───

  @RequireFacturePermission('facture.catalog.read')
  @Get('items')
  listItems(@CurrentFacture() ctx: FactureContext, @Query() query: FactureListQueryDto) {
    return this.clients.listItems(ctx, query);
  }

  @RequireFacturePermission('facture.catalog.manage')
  @Post('items')
  createItem(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureItemDto) {
    return this.clients.createItem(ctx, dto);
  }

  @RequireFacturePermission('facture.catalog.manage')
  @Patch('items/:id')
  updateItem(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateFactureItemDto,
  ) {
    return this.clients.updateItem(ctx, id, dto);
  }

  // ─── Documents ───

  @RequireFacturePermission('facture.documents.read')
  @Get('documents')
  listDocuments(@CurrentFacture() ctx: FactureContext, @Query() query: FactureDocumentQueryDto) {
    return this.documents.list(ctx, query);
  }

  @RequireFacturePermission('facture.documents.manage')
  @Post('documents')
  createDocument(@CurrentFacture() ctx: FactureContext, @Body() dto: CreateFactureDocumentDto) {
    return this.documents.create(ctx, dto);
  }

  @RequireFacturePermission('facture.documents.read')
  @Get('documents/:id')
  document(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.documents.get(ctx, id);
  }

  @RequireFacturePermission('facture.documents.manage')
  @Put('documents/:id')
  updateDocument(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: FactureDraftDto,
  ) {
    return this.documents.update(ctx, id, dto);
  }

  @RequireFacturePermission('facture.documents.manage')
  @HttpCode(204)
  @Delete('documents/:id')
  async removeDocument(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    await this.documents.remove(ctx, id);
  }

  @RequireFacturePermission('facture.documents.manage')
  @HttpCode(200)
  @Post('documents/:id/issue')
  issue(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.documents.issue(ctx, id);
  }

  @RequireFacturePermission('facture.documents.manage')
  @HttpCode(200)
  @Post('documents/:id/accept')
  accept(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.documents.decide(ctx, id, 'ACCEPTED');
  }

  @RequireFacturePermission('facture.documents.manage')
  @HttpCode(200)
  @Post('documents/:id/refuse')
  refuse(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.documents.decide(ctx, id, 'REFUSED');
  }

  @RequireFacturePermission('facture.documents.manage')
  @HttpCode(200)
  @Post('documents/:id/cancel')
  cancel(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: CancelFactureDocumentDto,
  ) {
    return this.documents.cancel(ctx, id, dto.reason);
  }

  @RequireFacturePermission('facture.documents.manage')
  @HttpCode(200)
  @Post('documents/:id/convert')
  convert(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: ConvertFactureDocumentDto,
  ) {
    return this.documents.convert(ctx, id, dto.type);
  }

  @RequireFacturePermission('facture.documents.manage')
  @Post('documents/:id/duplicate')
  duplicate(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.documents.duplicate(ctx, id);
  }

  @RequireFacturePermission('facture.documents.manage')
  @HttpCode(200)
  @Post('documents/:id/send')
  send(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: SendFactureDocumentDto,
  ) {
    return this.documents.send(ctx, id, dto);
  }

  @RequireFacturePermission('facture.documents.read')
  @Get('documents/:id/pdf')
  async pdf(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, filename } = await this.documents.pdf(ctx, id);
    return download(res, body, 'application/pdf', filename);
  }
}
