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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, Public, RequireActivity, RequirePermission } from '../../common/decorators';
import { PHOTO_MAX_BYTES, type UploadedImage } from '../../common/storage/photo';
import { PassOffersService } from './pass-offers.service';
import { PassesService } from './passes.service';
import {
  CreatePassOfferDto,
  CreatePassOrderDto,
  PassesQueryDto,
  PassPhotoDto,
  PassReasonDto,
  RenewPassDto,
  UpdatePassOfferDto,
} from './pass.dto';
import { EstablishmentQueryDto } from './ticketing.dto';

const photoFile = FileInterceptor('file', { limits: { fileSize: PHOTO_MAX_BYTES + 1, files: 1 } });

class PassLinkParam {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32}$/)
  token: string;
}

/** Ocall Parc sprint 8 : catalogue des offres de pass (configuration). */
@ApiTags('Pass et abonnements')
@RequireActivity('PARK')
@Controller('pass-offers')
export class PassOffersController {
  constructor(private readonly offers: PassOffersService) {}

  @RequirePermission('ticketing.manage')
  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.offers.list(requireTenant(auth));
  }

  @RequirePermission('ticketing.manage')
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.get(requireTenant(auth), id);
  }

  @RequirePermission('ticketing.manage')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreatePassOfferDto) {
    return this.offers.create(requireTenant(auth), dto);
  }

  @RequirePermission('ticketing.manage')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePassOfferDto,
  ) {
    return this.offers.update(requireTenant(auth), id, dto);
  }
}

/**
 * Pass des visiteurs : vente et renouvellement au guichet (`pos.sell`, encaissement par POST
 * /sales/:id/pay), suspension, annulation et cartes (`pass.manage`).
 */
@ApiTags('Pass et abonnements')
@RequireActivity('PARK')
@Controller('passes')
export class PassesController {
  constructor(private readonly passes: PassesService) {}

  /** Offres en vente aujourd'hui dans ce parc. */
  @RequirePermission('pos.sell')
  @Get('offers')
  offers(@CurrentAuth() auth: AuthContext, @Query() query: EstablishmentQueryDto) {
    return this.passes.sellableOffers(requireTenant(auth), query.establishmentId);
  }

  /** Vente d'un pass (vente non payée) ; le pass est activé au paiement. */
  @RequirePermission('pos.sell')
  @Post('orders')
  order(@CurrentAuth() auth: AuthContext, @Body() dto: CreatePassOrderDto) {
    return this.passes.order(requireTenant(auth), dto);
  }

  /** Photo du titulaire (déposée avant la vente ou le changement de photo). */
  @RequirePermission('pos.sell')
  @Post('photos')
  @UseInterceptors(photoFile)
  uploadPhoto(@CurrentAuth() auth: AuthContext, @UploadedFile() file: UploadedImage | undefined) {
    return this.passes.uploadPhoto(requireTenant(auth), file);
  }

  @RequirePermission('pos.sell')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: PassesQueryDto) {
    return this.passes.list(requireTenant(auth), query);
  }

  @RequirePermission('pos.sell')
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.passes.get(requireTenant(auth), id);
  }

  @RequirePermission('pos.sell')
  @Put(':id/photo')
  setPhoto(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PassPhotoDto,
  ) {
    return this.passes.setPhoto(requireTenant(auth), id, dto.photoFileId);
  }

  @RequirePermission('pos.sell')
  @Post(':id/renew')
  renew(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewPassDto,
  ) {
    return this.passes.renew(requireTenant(auth), id, dto);
  }

  /** Lien personnel du titulaire : le jeton n'est renvoyé qu'une fois. */
  @RequirePermission('pos.sell')
  @Post(':id/link')
  issueLink(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.passes.issueLink(requireTenant(auth), id);
  }

  @RequirePermission('pass.manage')
  @Delete(':id/link')
  revokeLink(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.passes.revokeLink(requireTenant(auth), id);
  }

  @RequirePermission('pass.manage')
  @HttpCode(200)
  @Post(':id/suspend')
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PassReasonDto,
  ) {
    return this.passes.suspend(requireTenant(auth), id, dto.reason);
  }

  @RequirePermission('pass.manage')
  @HttpCode(200)
  @Post(':id/reactivate')
  reactivate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.passes.reactivate(requireTenant(auth), id);
  }

  @RequirePermission('pass.manage')
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PassReasonDto,
  ) {
    return this.passes.cancel(requireTenant(auth), id, dto.reason);
  }

  @RequirePermission('pass.manage')
  @Post(':id/cards')
  issueCard(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.passes.issueCard(requireTenant(auth), id);
  }

  @RequirePermission('pass.manage')
  @HttpCode(200)
  @Post(':id/cards/:cardId/replace')
  replaceCard(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() dto: PassReasonDto,
  ) {
    return this.passes.replaceCard(requireTenant(auth), id, cardId, dto.reason);
  }

  @RequirePermission('pass.manage')
  @HttpCode(200)
  @Post(':id/cards/:cardId/revoke')
  revokeCard(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() dto: PassReasonDto,
  ) {
    return this.passes.revokeCard(requireTenant(auth), id, cardId, dto.reason);
  }

  /** Données d'impression pour Ocall Print (contrat préparé, aucune impression ici). */
  @RequirePermission('pass.manage')
  @HttpCode(200)
  @Post(':id/cards/:cardId/print-data')
  printData(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
  ) {
    return this.passes.cardPrintData(requireTenant(auth), id, cardId);
  }
}

/**
 * Page du titulaire, sans compte, par son lien personnel (révocable). Le QR est calculé par le
 * serveur ; aucune clé de signature n'est envoyée au navigateur.
 */
@ApiTags('Pass et abonnements (public)')
@Public()
@Controller('public')
export class PublicPassController {
  constructor(private readonly passes: PassesService) {}

  @Get('passes/:token')
  get(@Param() p: PassLinkParam) {
    return this.passes.publicPass(p.token);
  }
}
