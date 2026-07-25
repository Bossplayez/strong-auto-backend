import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { CONTRACT_VERSION } from './inventory-projection';

@Catch()
export class ContractErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ContractErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      method?: string;
      originalUrl?: string;
      url?: string;
    }>();
    const headerRequestId = request.headers?.['x-request-id'];
    const requestId = typeof headerRequestId === 'string' ? headerRequestId : randomUUID();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    const detail = typeof body === 'object' && body !== null ? body as { code?: string; message?: string; fieldErrors?: Record<string, string[]> | null } : {};
    const fallbackCode: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
      [HttpStatus.UNAUTHORIZED]: 'AUTHENTICATION_REQUIRED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
    };

    if (!(exception instanceof HttpException)) {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `[${requestId}] ${request.method ?? 'UNKNOWN'} ${request.originalUrl ?? request.url ?? 'UNKNOWN'} failed: ${error.message}`,
        error.stack,
      );
    }

    response.status(status).json({
      contractVersion: CONTRACT_VERSION,
      error: {
        code: detail.code ?? fallbackCode[status] ?? 'INTERNAL_ERROR',
        message: detail.message ?? (typeof body === 'string' ? body : 'Internal server error.'),
        fieldErrors: detail.fieldErrors ?? null,
        requestId,
      },
    });
  }
}
