import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT Auth Guard — uses Passport 'jwt' strategy.
 * Attach to routes/controllers that require authentication.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
