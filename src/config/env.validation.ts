import { z } from 'zod';

// ── Auction import configuration ────────────────────────────
const importConfigSchema = z.object({
  IMPORT_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(5),
  IMPORT_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  IMPORT_MAX_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  IMPORT_INITIAL_RETRY_DELAY_MS: z.coerce.number().int().min(100).max(5000).default(500),
  IMPORT_MAX_RETRY_DELAY_MS: z.coerce.number().int().min(500).max(30000).default(10000),
  IMPORT_JOB_TIMEOUT_MS: z.coerce.number().int().min(10000).max(900000).default(300000),

  // ── Phase 2: Lease / heartbeat ──
  IMPORT_LEASE_TTL_MS: z.coerce.number().int().min(1000).max(600000).default(60000),
  IMPORT_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).max(300000).default(15000),

  // ── Phase 3: Monthly request budget ──
  IMPORT_MONTHLY_REQUEST_BUDGET: z.coerce.number().int().min(1).max(10000000).default(30000),
  IMPORT_MONTHLY_REQUEST_RESERVE: z.coerce.number().int().min(0).max(10000000).default(3000),
  IMPORT_BUDGET_WARNING_PERCENT: z.coerce.number().int().min(1).max(100).default(80),
});

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

  // ── Auction import configuration ────────────────────────────
  IMPORT_MAX_PAGES: importConfigSchema.shape.IMPORT_MAX_PAGES,
  IMPORT_REQUEST_TIMEOUT_MS: importConfigSchema.shape.IMPORT_REQUEST_TIMEOUT_MS,
  IMPORT_MAX_RETRY_ATTEMPTS: importConfigSchema.shape.IMPORT_MAX_RETRY_ATTEMPTS,
  IMPORT_INITIAL_RETRY_DELAY_MS: importConfigSchema.shape.IMPORT_INITIAL_RETRY_DELAY_MS,
  IMPORT_MAX_RETRY_DELAY_MS: importConfigSchema.shape.IMPORT_MAX_RETRY_DELAY_MS,
  IMPORT_JOB_TIMEOUT_MS: importConfigSchema.shape.IMPORT_JOB_TIMEOUT_MS,
  IMPORT_LEASE_TTL_MS: importConfigSchema.shape.IMPORT_LEASE_TTL_MS,
  IMPORT_HEARTBEAT_INTERVAL_MS: importConfigSchema.shape.IMPORT_HEARTBEAT_INTERVAL_MS,
  IMPORT_MONTHLY_REQUEST_BUDGET: importConfigSchema.shape.IMPORT_MONTHLY_REQUEST_BUDGET,
  IMPORT_MONTHLY_REQUEST_RESERVE: importConfigSchema.shape.IMPORT_MONTHLY_REQUEST_RESERVE,
  IMPORT_BUDGET_WARNING_PERCENT: importConfigSchema.shape.IMPORT_BUDGET_WARNING_PERCENT,
})
  // Cross-field validation
  .refine(
    (data) => data.IMPORT_MAX_RETRY_DELAY_MS >= data.IMPORT_INITIAL_RETRY_DELAY_MS,
    { message: 'IMPORT_MAX_RETRY_DELAY_MS must be >= IMPORT_INITIAL_RETRY_DELAY_MS', path: ['IMPORT_MAX_RETRY_DELAY_MS'] },
  )
  .refine(
    (data) => data.IMPORT_JOB_TIMEOUT_MS >= data.IMPORT_REQUEST_TIMEOUT_MS,
    { message: 'IMPORT_JOB_TIMEOUT_MS must be >= IMPORT_REQUEST_TIMEOUT_MS', path: ['IMPORT_JOB_TIMEOUT_MS'] },
  )
  .refine(
    (data) => data.IMPORT_HEARTBEAT_INTERVAL_MS < data.IMPORT_LEASE_TTL_MS,
    { message: 'IMPORT_HEARTBEAT_INTERVAL_MS must be < IMPORT_LEASE_TTL_MS (heartbeat must fire before lease expires)', path: ['IMPORT_HEARTBEAT_INTERVAL_MS'] },
  )
  .refine(
    (data) => data.IMPORT_MONTHLY_REQUEST_RESERVE <= data.IMPORT_MONTHLY_REQUEST_BUDGET,
    { message: 'IMPORT_MONTHLY_REQUEST_RESERVE must be <= IMPORT_MONTHLY_REQUEST_BUDGET', path: ['IMPORT_MONTHLY_REQUEST_RESERVE'] },
  );

export type EnvConfig = z.infer<typeof envSchema>;
export type ImportConfig = z.infer<typeof importConfigSchema>;

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

  // Runtime sanity checks (finite integers)
  const c = parsed.data;
  if (!Number.isFinite(c.IMPORT_MAX_PAGES) || !Number.isFinite(c.IMPORT_REQUEST_TIMEOUT_MS) || !Number.isFinite(c.IMPORT_MAX_RETRY_ATTEMPTS) || !Number.isFinite(c.IMPORT_INITIAL_RETRY_DELAY_MS) || !Number.isFinite(c.IMPORT_MAX_RETRY_DELAY_MS) || !Number.isFinite(c.IMPORT_JOB_TIMEOUT_MS)) {
    throw new Error('Invalid environment variables: all import config values must be finite integers');
  }

  return parsed.data;
}
