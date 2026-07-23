import { z } from 'zod';

const expiresInPattern = /^\d+[smhd]$/i;

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z
      .string()
      .trim()
      .min(1)
      .default('replace-with-a-long-random-secret'),
    JWT_EXPIRES_IN: z
      .string()
      .trim()
      .regex(expiresInPattern, 'JWT_EXPIRES_IN must look like 15m or 7d')
      .default('15m'),
    JWT_REFRESH_SECRET: z.string().trim().optional(),
    JWT_REFRESH_EXPIRES_IN: z
      .string()
      .trim()
      .regex(
        expiresInPattern,
        'JWT_REFRESH_EXPIRES_IN must look like 15m or 7d',
      )
      .default('7d'),
    ALLOWED_ORIGINS: z
      .string()
      .trim()
      .default(
        'http://15.134.85.143,http://15.134.85.143:3000,http://localhost:3000,http://127.0.0.1:3000',
      ),
    OPENAI_API_KEY: z.string().trim().optional(),
    OPENROUTER_API_KEY: z.string().trim().optional(),
    OPENROUTER_EMBEDDING_MODEL: z
      .string()
      .trim()
      .default('nvidia/llama-nemotron-embed-vl-1b-v2:free'),
    OPENROUTER_LLM_MODEL: z
      .string()
      .trim()
      .default('nvidia/nemotron-3-super-120b-a12b:free'),
    GITHUB_CLIENT_ID: z.string().trim().optional(),
    GITHUB_CLIENT_SECRET: z.string().trim().optional(),
    GITHUB_APP_ID: z.string().trim().optional(),
    GITHUB_WEBHOOK_SECRET: z.string().trim().optional(),
    API_PUBLIC_URL: z.url().trim().default('http://localhost:5000'),
    ENCRYPTION_KEY: z
      .string()
      .trim()
      .refine((value) => {
        try {
          return Buffer.from(value, 'base64').length === 32;
        } catch {
          return false;
        }
      }, 'ENCRYPTION_KEY must be a base64-encoded 32-byte key')
      .optional(),
    GITHUB_REVIEW_DAILY_LIMIT: z.coerce.number().int().min(1).default(100),
    REDIS_URL: z.string().trim().optional(),
    REDIS_HOST: z.string().trim().default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().trim().optional(),
    APP_URL: z.string().trim().default('http://localhost:3000'),
    SMTP_HOST: z.string().trim().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: z
      .string()
      .trim()
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().trim().optional(),
    SMTP_PASS: z.string().trim().optional(),
    SMTP_FROM_EMAIL: z.string().trim().optional(),
    SMTP_FROM_NAME: z.string().trim().default('TaskFlow'),
    CONTACT_RECEIVER_EMAIL: z.string().trim().optional(),
  })
  .transform((env) => ({
    ...env,
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET ?? env.JWT_SECRET,
  }));

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  return envSchema.parse(config);
}

export function getEnv(): AppEnv {
  return validateEnv(process.env);
}
