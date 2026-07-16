import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { CONTRACT_VERSION } from './inventory-projection';

@Catch()
export class ContractErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
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
    response.status(status).json({
      contractVersion: CONTRACT_VERSION,
      error: {
        code: detail.code ?? fallbackCode[status] ?? 'INTERNAL_ERROR',
        message: detail.message ?? (typeof body === 'string' ? body : 'Internal server error.'),
        fieldErrors: detail.fieldErrors ?? null,
        requestId: typeof request.headers?.['x-request-id'] === 'string' ? request.headers['x-request-id'] : null,
      },
    });
  }
}
