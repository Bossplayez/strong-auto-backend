import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, { value: any; expiresAt: number }>();
  private readonly cacheTtlMs = 60_000; // 1 minute

  constructor(private readonly prisma: PrismaService) {}

  async get<T = any>(key: string): Promise<T | null> {
    // Check cache
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    const setting = await this.prisma.siteSetting.findUnique({
      where: { key },
    });

    if (!setting) return null;

    const value = setting.valueJson as T;
    this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });

    return value;
  }

  async set(
    key: string,
    value: any,
    updatedByUserId?: string,
  ): Promise<void> {
    await this.prisma.siteSetting.upsert({
      where: { key },
      update: {
        valueJson: value as any,
        updatedByUserId: updatedByUserId ?? null,
      },
      create: {
        key,
        valueJson: value as any,
        updatedByUserId: updatedByUserId ?? null,
      },
    });

    // Invalidate cache
    this.cache.delete(key);
    this.logger.log(`Setting updated: ${key}`);
  }

  async getAll(): Promise<Record<string, any>> {
    const settings = await this.prisma.siteSetting.findMany({
      orderBy: { key: 'asc' },
    });

    const result: Record<string, any> = {};
    for (const s of settings) {
      result[s.key] = s.valueJson;
    }

    return result;
  }

  async delete(key: string): Promise<void> {
    await this.prisma.siteSetting.delete({ where: { key } });
    this.cache.delete(key);
  }
}
