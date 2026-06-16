import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Unique deployment ID
  const deployId = process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_SNAPSHOT_ID || `unknown-${Date.now()}`;
  console.log(`[BOOT] Deployment ID: ${deployId}`);

  const allowedOrigins = [
    'https://strong-auto-frontend.vercel.app',
    process.env.FRONTEND_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN,
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Add deployment ID to all responses + prevent caching
  app.use((req, res, next) => {
    res.setHeader('X-Deploy-Id', deployId);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
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
