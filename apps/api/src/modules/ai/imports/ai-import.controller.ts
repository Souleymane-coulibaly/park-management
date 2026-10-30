import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AI_IMPORT_MAX_BYTES } from '@ocall/shared';
import { type AuthContext, requireTenant } from '../../../common/auth-context';
import type { UploadedFileInMemory } from '../uploaded-file';
import { CurrentAuth, RequireActivity, RequirePermission } from '../../../common/decorators';
import { AnalyzeImportDto, PublishCatalogDto, PublishTicketsDto } from './ai-import.dto';
import { AiImportService } from './ai-import.service';

/** Fichier gardé en mémoire le temps de l'analyse, jamais écrit sur disque ni conservé. */
const upload = FileInterceptor('file', { limits: { fileSize: AI_IMPORT_MAX_BYTES, files: 1 } });

@ApiTags('IA — import de carte et de tarifs')
@Controller('ai/imports')
export class AiImportController {
  constructor(private readonly imports: AiImportService) {}

  /** Analyse d'une carte de restaurant (photo ou PDF) : rien n'est publié sans validation humaine. */
  @RequireActivity('RESTAURANT')
  @RequirePermission('catalog.manage')
  @Post('catalog')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  analyzeCatalog(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: UploadedFileInMemory | undefined,
    @Body() dto: AnalyzeImportDto,
  ) {
    return this.imports.analyze(requireTenant(auth), 'CATALOG', dto.establishmentId, file);
  }

  /** Analyse d'une grille tarifaire de parc : les billets seront créés désactivés. */
  @RequireActivity('PARK')
  @RequirePermission('ticketing.manage')
  @Post('tickets')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  analyzeTickets(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: UploadedFileInMemory | undefined,
    @Body() dto: AnalyzeImportDto,
  ) {
    return this.imports.analyze(requireTenant(auth), 'TICKETS', dto.establishmentId, file);
  }

  @RequirePermission('catalog.manage')
  @Get('catalog')
  listCatalog(@CurrentAuth() auth: AuthContext) {
    return this.imports.list(requireTenant(auth), 'CATALOG');
  }

  @RequirePermission('ticketing.manage')
  @Get('tickets')
  listTickets(@CurrentAuth() auth: AuthContext) {
    return this.imports.list(requireTenant(auth), 'TICKETS');
  }

  /** Détail d'un import ; la permission dépend de son type (catalogue ou billetterie). */
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.get(requireTenant(auth), id);
  }

  @RequireActivity('RESTAURANT')
  @RequirePermission('catalog.manage')
  @HttpCode(200)
  @Post(':id/publish/catalog')
  publishCatalog(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishCatalogDto,
  ) {
    return this.imports.publishCatalog(requireTenant(auth), id, dto);
  }

  @RequireActivity('PARK')
  @RequirePermission('ticketing.manage')
  @HttpCode(200)
  @Post(':id/publish/tickets')
  publishTickets(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishTicketsDto,
  ) {
    return this.imports.publishTickets(requireTenant(auth), id, dto);
  }

  @HttpCode(200)
  @Post(':id/discard')
  discard(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.discard(requireTenant(auth), id);
  }
}
