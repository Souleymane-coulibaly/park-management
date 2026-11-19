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
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PRINT_CARD_UNIT_PRICE,
  PRINT_CURRENCY,
  PRINT_RETENTION_DAYS,
  type PrintCardKind,
} from '@ocall/shared';
import { download } from '../../common/download';
import type { PrintActor } from '../../common/integration/print-gateway';
import { CurrentPrint, PrintAccessGuard } from './print-access';
import { PrintCardsService } from './print-cards.service';
import { printInvalid, printNotFound } from './print-errors';
import { PRINT_IMAGE_MAX_BYTES } from './print-images';
import { PrintOrdersService } from './print-orders.service';
import { PrintPersonsService, STANDALONE } from './print-persons.service';
import { PrintTemplatesService } from './print-templates.service';
import {
  PrintIssueCardsDto,
  PrintOrderCreateDto,
  PrintOrdersQueryDto,
  PrintPersonDto,
  PrintPersonsQueryDto,
  PrintQrDto,
  PrintReasonDto,
  PrintTemplateCreateDto,
  PrintTemplateUpdateDto,
} from './print.dto';

interface Upload {
  buffer: Buffer;
  size: number;
}

const imageFile = FileInterceptor('file', {
  // Marge au-delà de la limite métier : le service renvoie un refus explicite plutôt qu'une erreur 413.
  limits: { fileSize: PRINT_IMAGE_MAX_BYTES + 1, files: 1 },
});

const upload = (file: Upload | undefined): Buffer => {
  if (!file?.buffer?.length) throw printInvalid('PRINT_FILE_REQUIRED', 'Aucun fichier reçu.');
  return file.buffer;
};

function image(res: Response, body: Buffer | null) {
  if (!body) throw printNotFound('Photo');
  res.set({
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  return new StreamableFile(body);
}

/**
 * Ocall Print en accès autonome, gratuit (écoles et entreprises non abonnées à Ocall School) : fiches,
 * photos, modèles recto verso, cartes, commandes et suivi. Propriétaire et administrateurs de
 * l'organisation seulement.
 */
@ApiTags('Ocall Print')
@UseGuards(PrintAccessGuard)
@Controller('ocall-print')
export class PrintController {
  constructor(
    private readonly templates: PrintTemplatesService,
    private readonly persons: PrintPersonsService,
    private readonly cards: PrintCardsService,
    private readonly orders: PrintOrdersService,
  ) {}

  @Get('settings')
  settings() {
    return {
      unitPrice: PRINT_CARD_UNIT_PRICE,
      currency: PRINT_CURRENCY,
      retentionDays: PRINT_RETENTION_DAYS,
      payment: 'CASH_ON_DELIVERY',
    };
  }

  // ─── Modèles ───

  @Get('templates')
  listTemplates(@CurrentPrint() actor: PrintActor) {
    return this.templates.list(actor, STANDALONE);
  }

  @Post('templates')
  createTemplate(@CurrentPrint() actor: PrintActor, @Body() dto: PrintTemplateCreateDto) {
    return this.templates.create(actor, { sourceApp: 'OCALL_PRINT', scopeId: null }, dto);
  }

  @Patch('templates/:id')
  updateTemplate(
    @CurrentPrint() actor: PrintActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintTemplateUpdateDto,
  ) {
    return this.templates.update(actor, STANDALONE, id, { name: dto.name, layout: dto.layout });
  }

  @UseInterceptors(imageFile)
  @Put('templates/:id/logo')
  setLogo(
    @CurrentPrint() actor: PrintActor,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
  ) {
    return this.templates.setLogo(actor, STANDALONE, id, upload(file));
  }

  @Delete('templates/:id/logo')
  removeLogo(@CurrentPrint() actor: PrintActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.setLogo(actor, STANDALONE, id, null);
  }

  @HttpCode(204)
  @Delete('templates/:id')
  async archiveTemplate(@CurrentPrint() actor: PrintActor, @Param('id', ParseUUIDPipe) id: string) {
    await this.templates.archive(actor, STANDALONE, id);
  }

  @Get('templates/:id/preview')
  previewTemplate(@CurrentPrint() actor: PrintActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.templates.preview(actor, STANDALONE, id, null);
  }

  // ─── Fiches ───

  @Get('persons')
  listPersons(@CurrentPrint() actor: PrintActor, @Query() q: PrintPersonsQueryDto) {
    return this.persons.list(actor, { kind: q.kind, q: q.q, archived: q.archived === 'true' });
  }

  @Post('persons')
  createPerson(@CurrentPrint() actor: PrintActor, @Body() dto: PrintPersonDto) {
    return this.persons.create(actor, dto);
  }

  @Get('persons/:id')
  getPerson(@CurrentPrint() actor: PrintActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.persons.get(actor, id);
  }

  @Patch('persons/:id')
  updatePerson(
    @CurrentPrint() actor: PrintActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintPersonDto,
  ) {
    const { kind: _kind, ...rest } = dto;
    return this.persons.update(actor, id, rest);
  }

  @HttpCode(204)
  @Delete('persons/:id')
  async archivePerson(@CurrentPrint() actor: PrintActor, @Param('id', ParseUUIDPipe) id: string) {
    await this.persons.archive(actor, id);
  }

  @UseInterceptors(imageFile)
  @Put('persons/:id/photo')
  setPhoto(
    @CurrentPrint() actor: PrintActor,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
  ) {
    return this.persons.setPhoto(actor, id, upload(file));
  }

  @Get('persons/:id/photo')
  async photo(
    @CurrentPrint() actor: PrintActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return image(res, await this.persons.photo(actor, id));
  }

  // ─── Cartes ───

  @Post('cards')
  issueCards(@CurrentPrint() actor: PrintActor, @Body() dto: PrintIssueCardsDto) {
    return this.persons.issueCards(actor, dto.personIds, dto.validUntil ?? null);
  }

  @Post('cards/:id/revoke')
  revoke(
    @CurrentPrint() actor: PrintActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintReasonDto,
  ) {
    return this.cards.revoke(actor, STANDALONE, id, dto.reason);
  }

  @Post('cards/:id/replace')
  replace(
    @CurrentPrint() actor: PrintActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintReasonDto,
  ) {
    return this.cards.replace(actor, STANDALONE, id, dto.reason);
  }

  @Get('cards/:id/preview')
  cardPreview(
    @CurrentPrint() actor: PrintActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('templateId', ParseUUIDPipe) templateId: string,
  ) {
    return this.persons.cardPreview(actor, id, templateId);
  }

  /**
   * Lecture d'un QR par un administrateur de l'organisation : carte de cette organisation seulement ;
   * rien n'est révélé d'une carte inconnue, falsifiée ou d'une autre organisation.
   */
  @HttpCode(200)
  @Post('cards/verify')
  async verify(@CurrentPrint() actor: PrintActor, @Body() dto: PrintQrDto) {
    const card = await this.cards.verify(actor, dto.qr);
    if (!card) return { result: 'UNKNOWN' as const };
    if (card.sourceApp !== 'OCALL_PRINT')
      return { result: 'OTHER_APP' as const, sourceApp: card.sourceApp };
    const holder = await this.persons.get(actor, card.holderId).catch(() => null);
    return {
      result: card.status === 'ACTIVE' ? ('VALID' as const) : ('REVOKED' as const),
      card,
      holder: holder
        ? {
            id: holder.id,
            kind: holder.kind as PrintCardKind,
            lastName: holder.lastName,
            firstName: holder.firstName,
            reference: holder.reference,
            groupLabel: holder.groupLabel,
            jobTitle: holder.jobTitle,
            hasPhoto: holder.hasPhoto,
            archived: holder.archivedAt !== null,
          }
        : null,
    };
  }

  // ─── Commandes ───

  @Get('orders')
  listOrders(@CurrentPrint() actor: PrintActor, @Query() q: PrintOrdersQueryDto) {
    return this.orders.list(actor, STANDALONE, { status: q.status });
  }

  @Post('orders')
  order(@CurrentPrint() actor: PrintActor, @Body() dto: PrintOrderCreateDto) {
    return this.persons.order(actor, {
      templateId: dto.templateId,
      cardIds: dto.cardIds,
      idempotencyKey: dto.idempotencyKey,
      delivery: {
        address: dto.delivery.address,
        contactName: dto.delivery.contactName,
        contactPhone: dto.delivery.contactPhone,
        note: dto.delivery.note ?? null,
      },
    });
  }

  @Get('orders/:id')
  getOrder(@CurrentPrint() actor: PrintActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(actor, STANDALONE, id);
  }

  @Post('orders/:id/cancel')
  cancel(
    @CurrentPrint() actor: PrintActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrintReasonDto,
  ) {
    return this.orders.cancel(actor, STANDALONE, id, dto.reason);
  }

  @Get('orders/:id/proof.pdf')
  async proof(
    @CurrentPrint() actor: PrintActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const order = await this.orders.detail(actor, STANDALONE, id);
    const pdf = await this.orders.proofPdf(actor, STANDALONE, id);
    return download(res, pdf, 'application/pdf', `bon-a-tirer-${order.number}.pdf`);
  }
}
