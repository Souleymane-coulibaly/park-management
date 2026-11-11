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
import { download } from '../../common/download';
import {
  CurrentFacture,
  FactureAccessGuard,
  type FactureContext,
  RequireFacturePermission,
} from './facture-access';
import {
  CancelFactureInterventionDto,
  CompleteFactureInterventionDto,
  CreateFactureInterventionDto,
  FactureEquipmentDto,
  FactureEquipmentQueryDto,
  FactureInterventionQueryDto,
  FacturePartUsageDto,
  FacturePhotoDto,
  FactureTimeEntryDto,
  InvoiceFactureInterventionDto,
  SignFactureInterventionDto,
  UpdateFactureEquipmentDto,
  UpdateFactureInterventionDto,
} from './facture-interventions.dto';
import {
  FACTURE_PHOTO_MAX_BYTES,
  FACTURE_SIGNATURE_MAX_BYTES,
  FactureInterventionsService,
} from './facture-interventions.service';
import type { FactureUpload } from './facture.service';

const uuid = new ParseUUIDPipe();
const PRIVATE_IMAGE = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};
// Marge au-delà des limites métier : le service renvoie un refus explicite plutôt qu'une erreur 413.
const photoFile = FileInterceptor('file', {
  limits: { fileSize: FACTURE_PHOTO_MAX_BYTES + 1, files: 1 },
});
const signatureFile = FileInterceptor('file', {
  limits: { fileSize: FACTURE_SIGNATURE_MAX_BYTES + 1, files: 1 },
});

/** Voir les interventions : toutes (planning) ou les siennes (technicien). */
const SEE = ['facture.interventions.read', 'facture.interventions.work'] as const;
/** Saisir des travaux : technicien affecté ou gérant (contrôle fin dans le service). */
const WORK = 'facture.interventions.work' as const;
const MANAGE = 'facture.interventions.manage' as const;

/**
 * Ocall Facture — interventions (F3) : équipements, planning, travaux, photos, rapport PDF, signature du
 * client, facturation.
 */
@ApiTags('Ocall Facture')
@UseGuards(FactureAccessGuard)
@Controller('facture')
export class FactureInterventionsController {
  constructor(private readonly interventions: FactureInterventionsService) {}

  // ─── Équipements ───

  @RequireFacturePermission(...SEE)
  @Get('equipment')
  equipment(@CurrentFacture() ctx: FactureContext, @Query() query: FactureEquipmentQueryDto) {
    return this.interventions.listEquipment(ctx, query);
  }

  @RequireFacturePermission(MANAGE)
  @Post('equipment')
  createEquipment(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureEquipmentDto) {
    return this.interventions.createEquipment(ctx, dto);
  }

  @RequireFacturePermission(MANAGE)
  @Patch('equipment/:id')
  updateEquipment(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateFactureEquipmentDto,
  ) {
    return this.interventions.updateEquipment(ctx, id, dto);
  }

  @RequireFacturePermission(MANAGE)
  @Get('technicians')
  technicians(@CurrentFacture() ctx: FactureContext) {
    return this.interventions.technicians(ctx);
  }

  // ─── Planning ───

  @RequireFacturePermission(...SEE)
  @Get('interventions')
  list(@CurrentFacture() ctx: FactureContext, @Query() query: FactureInterventionQueryDto) {
    return this.interventions.list(ctx, query);
  }

  @RequireFacturePermission(MANAGE)
  @Post('interventions')
  create(@CurrentFacture() ctx: FactureContext, @Body() dto: CreateFactureInterventionDto) {
    return this.interventions.create(ctx, dto);
  }

  @RequireFacturePermission(...SEE)
  @Get('interventions/:id')
  get(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.interventions.get(ctx, id);
  }

  @RequireFacturePermission(MANAGE)
  @Patch('interventions/:id')
  update(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateFactureInterventionDto,
  ) {
    return this.interventions.update(ctx, id, dto);
  }

  @RequireFacturePermission(MANAGE)
  @HttpCode(200)
  @Post('interventions/:id/cancel')
  cancel(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: CancelFactureInterventionDto,
  ) {
    return this.interventions.cancel(ctx, id, dto.reason);
  }

  // ─── Travaux ───

  @RequireFacturePermission(WORK)
  @HttpCode(200)
  @Post('interventions/:id/start')
  start(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.interventions.start(ctx, id);
  }

  @RequireFacturePermission(WORK)
  @Post('interventions/:id/time')
  addTime(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: FactureTimeEntryDto,
  ) {
    return this.interventions.addTime(ctx, id, dto);
  }

  @RequireFacturePermission(WORK)
  @HttpCode(204)
  @Delete('interventions/:id/time/:entryId')
  removeTime(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Param('entryId', uuid) entryId: string,
  ) {
    return this.interventions.removeTime(ctx, id, entryId);
  }

  @RequireFacturePermission(WORK)
  @Post('interventions/:id/parts')
  addPart(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: FacturePartUsageDto,
  ) {
    return this.interventions.addPart(ctx, id, dto);
  }

  @RequireFacturePermission(WORK)
  @HttpCode(204)
  @Delete('interventions/:id/parts/:partId')
  removePart(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Param('partId', uuid) partId: string,
  ) {
    return this.interventions.removePart(ctx, id, partId);
  }

  @RequireFacturePermission(WORK)
  @Post('interventions/:id/photos')
  @UseInterceptors(photoFile)
  addPhoto(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @UploadedFile() file: FactureUpload | undefined,
    @Body() dto: FacturePhotoDto,
  ) {
    return this.interventions.addPhoto(ctx, id, file, dto.caption ?? null);
  }

  @RequireFacturePermission(...SEE)
  @Get('interventions/:id/photos/:photoId')
  async photo(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Param('photoId', uuid) photoId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = await this.interventions.photo(ctx, id, photoId);
    res.set({ ...PRIVATE_IMAGE, 'Content-Type': 'image/jpeg' });
    return new StreamableFile(body);
  }

  @RequireFacturePermission(WORK)
  @HttpCode(204)
  @Delete('interventions/:id/photos/:photoId')
  removePhoto(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Param('photoId', uuid) photoId: string,
  ) {
    return this.interventions.removePhoto(ctx, id, photoId);
  }

  @RequireFacturePermission(WORK)
  @HttpCode(200)
  @Post('interventions/:id/complete')
  complete(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: CompleteFactureInterventionDto,
  ) {
    return this.interventions.complete(ctx, id, dto);
  }

  @RequireFacturePermission(MANAGE)
  @HttpCode(200)
  @Post('interventions/:id/reopen')
  reopen(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.interventions.reopen(ctx, id);
  }

  @RequireFacturePermission(WORK)
  @HttpCode(200)
  @Post('interventions/:id/sign')
  @UseInterceptors(signatureFile)
  sign(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @UploadedFile() file: FactureUpload | undefined,
    @Body() dto: SignFactureInterventionDto,
  ) {
    return this.interventions.sign(ctx, id, dto.signerName, file);
  }

  @RequireFacturePermission(...SEE)
  @Get('interventions/:id/signature')
  async signature(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = await this.interventions.signature(ctx, id);
    res.set({ ...PRIVATE_IMAGE, 'Content-Type': 'image/png' });
    return new StreamableFile(body);
  }

  @RequireFacturePermission(...SEE)
  @Get('interventions/:id/report')
  async report(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, filename } = await this.interventions.report(ctx, id);
    return download(res, body, 'application/pdf', filename);
  }

  // ─── Facturation ───

  @RequireFacturePermission('facture.documents.manage')
  @Post('interventions/:id/invoice')
  invoice(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: InvoiceFactureInterventionDto,
  ) {
    return this.interventions.invoice(ctx, id, dto);
  }
}
