import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { JsonLogger, requestLogger } from './common/logging/json-logger';
import { APP_CONFIG, type AppConfig, SESSION_COOKIE } from './config/app-config';

/** Configuration HTTP commune au serveur et aux tests d'intégration. */
export function setupApp(app: INestApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app as NestExpressApplication;
  // Production : journaux JSON structurés, secrets masqués, journal d'accès HTTP.
  if (config.logFormat === 'json') {
    app.useLogger(new JsonLogger());
    app.use(requestLogger());
  } else {
    app.flushLogs();
  }

  // Derrière le proxy Next.js et Railway : req.ip doit refléter le client réel (limites par IP).
  express.set('trust proxy', config.trustProxyHops);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.webOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Tout champ non prévu (ex. organizationId) est refusé, et non silencieusement ignoré.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Ocall Park API')
        .setDescription(
          'API REST du logiciel de gestion Ocall Park. Authentification par cookie de session httpOnly.',
        )
        .setVersion('1')
        .addCookieAuth(SESSION_COOKIE)
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }
  return config;
}
