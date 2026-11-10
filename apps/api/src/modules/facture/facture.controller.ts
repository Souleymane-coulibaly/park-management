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
import { FactureMembersService } from './facture-members.service';
import { FACTURE_LOGO_MAX_BYTES, FactureService, type FactureUpload } from './facture.service';
import {
  CreateFactureMemberDto,
  FactureExtraLogoDto,
  FactureSettingsDto,
  UpdateFactureMemberDto,
} from './facture.dto';

const IMAGE_HEADERS = {
  'Content-Type': 'image/png',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

const logoFile = FileInterceptor('file', {
  // Marge au-delà de la limite métier : le service renvoie un refus explicite plutôt qu'une erreur 413.
  limits: { fileSize: FACTURE_LOGO_MAX_BYTES + 1, files: 1 },
});

/** Ocall Facture — socle (F0) : contexte, identité légale, logo, aperçu de l'en-tête, équipe. */
@ApiTags('Ocall Facture')
@UseGuards(FactureAccessGuard)
@Controller('facture')
export class FactureController {
  constructor(
    private readonly facture: FactureService,
    private readonly members: FactureMembersService,
  ) {}

  @RequireFacturePermission('facture.access')
  @Get('context')
  context(@CurrentFacture() ctx: FactureContext) {
    return this.facture.context(ctx);
  }

  @RequireFacturePermission('facture.access')
  @Get('settings')
  settings(@CurrentFacture() ctx: FactureContext) {
    return this.facture.settings(ctx);
  }

  @RequireFacturePermission('facture.settings.manage')
  @Put('settings')
  updateSettings(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureSettingsDto) {
    return this.facture.updateSettings(ctx, dto);
  }

  @RequireFacturePermission('facture.settings.manage')
  @UseInterceptors(logoFile)
  @Post('settings/logo')
  uploadLogo(
    @CurrentFacture() ctx: FactureContext,
    @UploadedFile() file: FactureUpload | undefined,
  ) {
    return this.facture.uploadLogo(ctx, file);
  }

  @RequireFacturePermission('facture.access')
  @Get('settings/logo')
  async logo(@CurrentFacture() ctx: FactureContext, @Res({ passthrough: true }) res: Response) {
    const body = await this.facture.logo(ctx);
    res.set(IMAGE_HEADERS);
    return new StreamableFile(body);
  }

  @RequireFacturePermission('facture.access')
  @Get('settings/logos')
  listLogos(@CurrentFacture() ctx: FactureContext) {
    return this.facture.listLogos(ctx);
  }

  @RequireFacturePermission('facture.settings.manage')
  @UseInterceptors(logoFile)
  @Post('settings/logos')
  addLogo(
    @CurrentFacture() ctx: FactureContext,
    @UploadedFile() file: FactureUpload | undefined,
    @Body() dto: FactureExtraLogoDto,
  ) {
    return this.facture.addLogo(ctx, file, dto.placement, dto.label ?? null);
  }

  @RequireFacturePermission('facture.settings.manage')
  @HttpCode(204)
  @Delete('settings/logos/:id')
  async removeLogo(@CurrentFacture() ctx: FactureContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.facture.removeLogo(ctx, id);
  }

  @RequireFacturePermission('facture.access')
  @Get('settings/logos/:id')
  async extraLogo(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = await this.facture.extraLogo(ctx, id);
    res.set(IMAGE_HEADERS);
    return new StreamableFile(body);
  }

  @RequireFacturePermission('facture.access')
  @Get('settings/letterhead.pdf')
  async letterhead(
    @CurrentFacture() ctx: FactureContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(
      res,
      await this.facture.letterheadPreview(ctx),
      'application/pdf',
      'apercu-en-tete.pdf',
    );
  }

  @RequireFacturePermission('facture.members.read')
  @Get('members')
  listMembers(@CurrentFacture() ctx: FactureContext) {
    return this.members.list(ctx);
  }

  @RequireFacturePermission('facture.members.manage')
  @Post('members')
  createMember(@CurrentFacture() ctx: FactureContext, @Body() dto: CreateFactureMemberDto) {
    return this.members.create(ctx, dto);
  }

  @RequireFacturePermission('facture.members.manage')
  @Patch('members/:id')
  updateMember(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFactureMemberDto,
  ) {
    return this.members.update(ctx, id, dto);
  }
}
