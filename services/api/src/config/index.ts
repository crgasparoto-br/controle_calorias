import { z } from 'zod';

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  apiBaseUrl: z.string().default('http://localhost:3000'),
  jwtSecret: z.string().min(32),
  jwtExpiresIn: z.string().default('7d'),
  corsOrigins: z.string().transform((v) => v.split(',')).default('*'),
  rateLimitMax: z.coerce.number().default(100),
  rateLimitWindowMs: z.coerce.number().default(60000),
  databaseUrl: z.string(),
  redisUrl: z.string().default('redis://localhost:6379'),
  whatsappPhoneNumberId: z.string(),
  whatsappBusinessAccountId: z.string(),
  whatsappAccessToken: z.string(),
  whatsappWebhookVerifyToken: z.string(),
  whatsappApiVersion: z.string().default('v19.0'),
  openaiApiKey: z.string(),
  openaiModelChat: z.string().default('gpt-4o'),
  openaiModelVision: z.string().default('gpt-4o'),
  openaiModelEmbedding: z.string().default('text-embedding-3-small'),
  openaiModelAudio: z.string().default('whisper-1'),
  usdaApiKey: z.string().optional(),
  usdaApiBaseUrl: z.string().default('https://api.nal.usda.gov/fdc/v1'),
  sentryDsn: z.string().optional(),
  awsAccessKeyId: z.string().optional(),
  awsSecretAccessKey: z.string().optional(),
  awsRegion: z.string().default('us-east-1'),
  awsS3Bucket: z.string().default('controle-calorias-media'),
  embeddingDimensions: z.coerce.number().default(1536),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const parsed = configSchema.safeParse({
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    apiBaseUrl: process.env.API_BASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN,
    corsOrigins: process.env.CORS_ORIGINS,
    rateLimitMax: process.env.RATE_LIMIT_MAX,
    rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS,
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    whatsappApiVersion: process.env.WHATSAPP_API_VERSION,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModelChat: process.env.OPENAI_MODEL_CHAT,
    openaiModelVision: process.env.OPENAI_MODEL_VISION,
    openaiModelEmbedding: process.env.OPENAI_MODEL_EMBEDDING,
    openaiModelAudio: process.env.OPENAI_MODEL_AUDIO,
    usdaApiKey: process.env.USDA_API_KEY,
    usdaApiBaseUrl: process.env.USDA_API_BASE_URL,
    sentryDsn: process.env.SENTRY_DSN,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    awsRegion: process.env.AWS_REGION,
    awsS3Bucket: process.env.AWS_S3_BUCKET,
    embeddingDimensions: process.env.EMBEDDING_DIMENSIONS,
    logLevel: process.env.LOG_LEVEL,
  });

  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.'));
    throw new Error(`Invalid configuration. Missing/invalid: ${missing.join(', ')}`);
  }

  return parsed.data;
}

export const config = loadConfig();
