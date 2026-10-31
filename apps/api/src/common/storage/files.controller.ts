import { Controller, Get, Param, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../decorators';
import { requestMeta } from '../request-meta';
import { StorageService } from './storage.service';

/**
 * Téléchargement des fichiers privés par lien temporaire signé (Sprint 11B). Le lien est délivré
 * par une route authentifiée après contrôle d'accès ; il expire en quelques minutes. Réponse jamais
 * mise en cache, toujours en pièce jointe (aucune exécution dans le navigateur).
 */
@ApiTags('Fichiers')
@Public()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Throttle({ global: { ttl: 60_000, limit: 120 } })
  @Get(':token')
  async download(
    @Param('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.storage.download(token, requestMeta(req));
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.displayName)}`,
    );
    return new StreamableFile(file.body);
  }
}
