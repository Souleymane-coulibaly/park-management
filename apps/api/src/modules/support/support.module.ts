import { Module } from '@nestjs/common';
import { PlatformSupportController, SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Support Ocall (Sprint 11B) : demandes des clients, traitement par l'équipe Ocall. */
@Module({
  controllers: [SupportController, PlatformSupportController],
  providers: [SupportService],
})
export class SupportModule {}
