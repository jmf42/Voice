import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_PHONE_NUMBER: z.string().min(3),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  ALLOW_DEV_AUTH_TOKEN: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  ALLOW_INMEMORY_STORE: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  STORE_MODE: z.enum(['memory', 'prisma']).default('memory'),
  QUEUE_MODE: z.enum(['memory', 'redis']).default('memory'),
  VOICE_FLOW_MODE: z.enum(['guided', 'realtime']).default('guided'),
  REALTIME_AGENT_MODEL: z.string().default('gpt-realtime-1.5'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv): AppEnv {
  return envSchema.parse(input);
}
