import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = setupApp(app);
  await app.listen(config.port);
  Logger.log(`API Ocall Park prête sur http://localhost:${config.port}/api/v1`, 'Bootstrap');
  if (config.swaggerEnabled)
    Logger.log(`Documentation : http://localhost:${config.port}/api/docs`, 'Bootstrap');
}

void bootstrap();
