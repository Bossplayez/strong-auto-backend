import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    // Global modules
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
