import { z } from 'zod';

const envSchema = z.object({
  // ── Runtime ──────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  // ── Database ─────────────────────────────────────────────
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid database connection string'),

  // ── JWT ──────────────────────────────────────────────────
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // ── CORS / Frontend ──────────────────────────────────────
  FRONTEND_URL: z
    .string()
    .url('FRONTEND_URL must be a valid URL')
    .default('http://localhost:3000'),

  // ── External APIs ────────────────────────────────────────
  RAPIDAPI_KEY: z.string().optional(),

  // ── Sentry ───────────────────────────────────────────────
  SENTRY_DSN: z
    .string()
    .url('SENTRY_DSN must be a valid URL')
    .optional()
    .or(z.literal('')),

  // ── Email (Resend) ──────────────────────────────────────
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),

  // ── Cloudflare R2 (file storage) ─────────────────────────
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  LOCAL_STORAGE_DIR: z.string().optional(),

  // ── Telegram (notifications) ─────────────────────────────
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_MANAGER_CHAT_ID: z.string().optional(),

  // ── Railway metadata (auto-provided by platform) ─────────
  RAILWAY_DEPLOYMENT_ID: z.string().optional(),
  RAILWAY_SNAPSHOT_ID: z.string().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/** Validate and transform `process.env` into a typed config object. */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `❌ Invalid environment variables:\n${errors}\n\n` +
        'Please check your environment configuration.',
    );
  }

  return parsed.data;
}
