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

  app.enableCors();

  // Add deployment ID to all responses
  app.use((req, res, next) => {
    res.setHeader('X-Deploy-Id', deployId);
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
