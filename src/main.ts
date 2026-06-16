import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();

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

  // Diagnostic: check DB connection
  const { PrismaClient } = await import('@prisma/client');
  const diagPrisma = new PrismaClient();
  const adminUser = await diagPrisma.user.findFirst({ where: { email: 'admin@strongauto.com' }, select: { userType: true, status: true } });
  const vehicleCount = await diagPrisma.vehicle.count();
  console.log(`[DIAG] DB: ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown'}`);
  console.log(`[DIAG] Admin user: ${JSON.stringify(adminUser)}`);
  console.log(`[DIAG] Vehicle count: ${vehicleCount}`);
  await diagPrisma.$disconnect();

  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();
