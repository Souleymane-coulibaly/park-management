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
import { AI_AUDIO_MAX_BYTES } from '@ocall/shared';
import { type AuthContext, requireTenant } from '../../../common/auth-context';
import type { UploadedFileInMemory } from '../uploaded-file';
import { CurrentAuth, RequireActivity, RequirePermission } from '../../../common/decorators';
import { ConfirmVoiceOrderDto, CreateVoiceOrderDto } from './voice-order.dto';
import { VoiceOrderService } from './voice-order.service';

@ApiTags('IA — commande vocale')
@RequireActivity('RESTAURANT')
@Controller('ai/voice-orders')
export class VoiceOrderController {
  constructor(private readonly voice: VoiceOrderService) {}

  /** Enregistrement → transcription → panier proposé. Aucune commande n'est créée ici. */
  @RequirePermission('pos.sell')
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: AI_AUDIO_MAX_BYTES, files: 1 } }))
  create(
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: UploadedFileInMemory | undefined,
    @Body() dto: CreateVoiceOrderDto,
  ) {
    return this.voice.create(requireTenant(auth), dto.establishmentId, file);
  }

  @RequirePermission('pos.sell')
  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.voice.get(requireTenant(auth), id);
  }

  /** Validation humaine : crée la commande, non payée et non envoyée en cuisine. */
  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post(':id/confirm')
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmVoiceOrderDto,
  ) {
    return this.voice.confirm(requireTenant(auth), id, dto);
  }

  @RequirePermission('pos.sell')
  @HttpCode(200)
  @Post(':id/discard')
  discard(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.voice.discard(requireTenant(auth), id);
  }
}
