import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { FilesController } from './files.controller';
import { STORAGE_PROVIDER, createStorageProvider } from './storage-provider';
import { StorageService } from './storage.service';

/** Stockage de fichiers de la plateforme (médias des sites, fichiers privés), partagé par les modules. */
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createStorageProvider(config.sites.storage),
    },
    StorageService,
  ],
  exports: [STORAGE_PROVIDER, StorageService],
})
export class StorageModule {}
