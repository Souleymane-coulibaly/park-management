import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@ocall/database';

/** Format d'erreur unique de l'API. */
export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toApiError(exception);
    res.status(body.statusCode).json(body);
  }

  private toApiError(exception: unknown): ApiError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const fallbackCode = DEFAULT_CODES[statusCode] ?? 'ERROR';
      if (typeof response === 'string')
        return { statusCode, code: fallbackCode, message: response };
      const r = response as { code?: string; message?: string | string[]; details?: unknown };
      // Erreurs de validation class-validator : message = liste des champs invalides.
      if (Array.isArray(r.message)) {
        return {
          statusCode,
          code: 'VALIDATION_ERROR',
          message: 'Données invalides.',
          details: r.message,
        };
      }
      return {
        statusCode,
        code: r.code ?? fallbackCode,
        message: r.message ?? exception.message,
        ...(r.details !== undefined ? { details: r.details } : {}),
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'ALREADY_EXISTS',
        message: 'Cette valeur est déjà utilisée.',
      };
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' };
  }
}
