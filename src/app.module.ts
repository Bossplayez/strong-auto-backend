import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CatalogModule } from './catalog/catalog.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { CopartModule } from './copart/copart.module';
import { CalculatorModule } from './calculator/calculator.module';
import { LeadsModule } from './leads/leads.module';
import { FavoritesModule } from './favorites/favorites.module';
import { SavedCalculationsModule } from './saved-calculations/saved-calculations.module';
import { NewsModule } from './news/news.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { AdminModule } from './admin/admin.module';
import { FilesModule } from './files/files.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { HealthModule } from './health/health.module';
import { AuctionLotsModule } from './auction-lot/auction-lots.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    // Global modules
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      envFilePath: [], // explicitly empty - never load .env files
      validate: validateEnv,
    }),

    // Global rate limiting — production-safe defaults, env-overridable for testing
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: Number(process.env.THROTTLE_DEFAULT_LIMIT) || 60,
      },
      {
        name: 'auth',
        ttl: 60_000,
        limit: Number(process.env.THROTTLE_AUTH_LIMIT) || 10,
      },
      {
        name: 'auction',
        ttl: 60_000,
        limit: Number(process.env.THROTTLE_AUCTION_LIMIT) || 30,
      },
    ]),

    PrismaModule,
    SettingsModule,

    // Feature modules
    AuthModule,
    UsersModule,
    CatalogModule,
    VehiclesModule,
    CopartModule,
    CalculatorModule,
    LeadsModule,
    FavoritesModule,
    SavedCalculationsModule,
    NewsModule,
    NotificationsModule,
    BroadcastsModule,
    AdminModule,
    FilesModule,
    AuditModule,
    HealthModule,
    AuctionLotsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
