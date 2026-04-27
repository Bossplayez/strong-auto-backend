import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body } = request;
    const user = request.user;
    const handler = context.getHandler().name;
    const controller = context.getClass().name;
    const timestamp = new Date();

    return next.handle().pipe(
      tap({
        next: () => {
          if (user && this.isAdminAction(method)) {
            this.auditService
              .logAction({
                userId: user.id,
                userType: user.type,
                action: `${controller}.${handler}`,
                method,
                url,
                body: this.sanitizeBody(body),
                timestamp,
              })
              .catch((error: Error) => {
                this.logger.error(
                  `Failed to log audit action: ${error.message}`,
                  error.stack,
                );
              });
          }
        },
        error: () => {
          if (user && this.isAdminAction(method)) {
            this.auditService
              .logAction({
                userId: user.id,
                userType: user.type,
                action: `${controller}.${handler}`,
                method,
                url,
                body: this.sanitizeBody(body),
                timestamp,
                success: false,
              })
              .catch((error: Error) => {
                this.logger.error(
                  `Failed to log audit action: ${error.message}`,
                  error.stack,
                );
              });
          }
        },
      }),
    );
  }

  private isAdminAction(method: string): boolean {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
  }

  private sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
    if (!body) return {};
    const sanitized = { ...body };
    const sensitiveFields = ['password', 'token', 'secret', 'authorization'];
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    return sanitized;
  }
}
