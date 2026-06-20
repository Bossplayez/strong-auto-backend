import { NestFactory } from '@nestjs/core';
import { ValidationPipe, HttpException, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // Sentry initialization (no-op if SENTRY_DSN is not set)
  const SENTRY_DSN = process.env.SENTRY_DSN;
  if (SENTRY_DSN && SENTRY_DSN !== 'disabled') {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
      beforeSend(event, hint) {
        const exception = hint?.originalException;
        if (exception instanceof HttpException) {
          // Skip 4xx errors — they are expected application errors, not bugs
          const status = exception.getStatus();
          if (status >= 400 && status < 500) {
            return null;
          }
        }
        return event;
      },
    });
    Logger.log('Sentry initialized', 'Sentry');
  } else {
    Logger.log('SENTRY_DSN not set — Sentry disabled', 'Sentry');
  }

  const app = await NestFactory.create(AppModule);

  // Security headers via Helmet
  app.use(helmet());

  // Parse cookies for httpOnly JWT auth
  app.use(cookieParser());

  // Unique deployment ID (silent — available via X-Deploy-Id header)
  const deployId = process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_SNAPSHOT_ID || `unknown-${Date.now()}`;

  const allowedOrigins = [
    'https://strong-auto-frontend-zeta.vercel.app',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN,
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Add deployment ID to all responses
  app.use((req, res, next) => {
    res.setHeader('X-Deploy-Id', deployId);

    // Smart caching: cache GET for public catalog/news, no-store for the rest
    if (req.method === 'GET') {
      const isPublicPath = req.path.startsWith('/api/v1/catalog') ||
                           req.path.startsWith('/api/v1/news') ||
                           req.path.startsWith('/api/v1/calculator');
      if (isPublicPath) {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
      } else {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    next();
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Strong Auto API')
    .setVersion('1.0')
    .setDescription('Strong Auto backend API documentation')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();
// cache-bust-1781651196
