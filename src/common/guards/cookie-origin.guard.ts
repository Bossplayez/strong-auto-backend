import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Blocks state-changing cookie-authenticated requests that were initiated from
 * an unknown origin. Bearer-token API clients are unaffected.
 */
@Injectable()
export class CookieOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.authorization || !request.cookies?.access_token) {
      return true;
    }

    const allowedOrigins = new Set(
      [
        'https://strong-auto-frontend-zeta.vercel.app',
        'http://localhost:3000',
        process.env.FRONTEND_URL,
        process.env.RAILWAY_PUBLIC_DOMAIN,
      ].filter(Boolean),
    );

    if (!request.headers.origin || !allowedOrigins.has(request.headers.origin)) {
      throw new ForbiddenException({
        code: 'INVALID_REQUEST_ORIGIN',
        message: 'Request origin is not allowed.',
      });
    }

    return true;
  }
}
