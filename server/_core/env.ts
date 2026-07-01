type OptionalFeatureConfig = {
  name: string;
  variables: string[];
  disabledMessage: string;
};

const REQUIRED_PRODUCTION_ENV = ["JWT_SECRET", "DATABASE_URL"] as const;

const OPTIONAL_FEATURES: OptionalFeatureConfig[] = [
  {
    name: "OpenAI provider",
    variables: ["OPENAI_API_KEY"],
    disabledMessage: "OpenAI provider disabled until OPENAI_API_KEY is configured",
  },
  {
    name: "WhatsApp channel",
    variables: ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_VERIFY_TOKEN"],
    disabledMessage: "WhatsApp webhook/send flows unavailable until channel credentials are configured",
  },
  {
    name: "Strava OAuth",
    variables: ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REDIRECT_URI"],
    disabledMessage: "Strava OAuth disabled until client credentials and redirect URI are configured",
  },
  {
    name: "Strava Webhook",
    variables: ["STRAVA_WEBHOOK_VERIFY_TOKEN"],
    disabledMessage: "Strava real-time webhook disabled until STRAVA_WEBHOOK_VERIFY_TOKEN is configured",
  },
  {
    name: "Dedicated app secrets encryption key",
    variables: ["APP_SECRETS_ENCRYPTION_KEY"],
    disabledMessage: "Persisted secrets are encrypted with a key derived from JWT_SECRET (legacy fallback) until APP_SECRETS_ENCRYPTION_KEY is configured; rotating JWT_SECRET without migrating first can make legacy secrets unreadable",
  },
];

function readTrimmedEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function getMissingVariables(variables: readonly string[]) {
  return variables.filter((name) => readTrimmedEnv(name).length === 0);
}

export function requireCookieSecret(context = "secure secret operations") {
  const secret = readTrimmedEnv("JWT_SECRET");
  if (!secret) {
    throw new Error(`JWT_SECRET is required for ${context}`);
  }

  return secret;
}

/**
 * Dedicated key for encrypting persisted secrets (e.g. WhatsApp access token), decoupled
 * from JWT_SECRET so rotating the session/cookie secret does not affect stored secrets.
 * Empty when not configured; callers fall back to a JWT_SECRET-derived key for legacy
 * compatibility (see ARCHITECTURE.md / README.md for the migration path).
 */
export function readAppSecretsEncryptionKey(): string {
  return readTrimmedEnv("APP_SECRETS_ENCRYPTION_KEY");
}

export type RuntimeEnvValidationResult = {
  disabledOptionalFeatures: Array<{
    name: string;
    missingVariables: string[];
    message: string;
  }>;
};

export function validateRuntimeEnv(options: { logOptionalFeatures?: boolean } = {}): RuntimeEnvValidationResult {
  const isProduction = process.env.NODE_ENV === "production";
  const missingRequired = isProduction ? getMissingVariables(REQUIRED_PRODUCTION_ENV) : [];

  if (missingRequired.length) {
    throw new Error(
      `Missing or invalid required production environment variable(s): ${missingRequired.join(", ")}`
    );
  }

  const disabledOptionalFeatures = OPTIONAL_FEATURES
    .map((feature) => ({
      name: feature.name,
      missingVariables: getMissingVariables(feature.variables),
      message: feature.disabledMessage,
    }))
    .filter((feature) => feature.missingVariables.length > 0);

  if (options.logOptionalFeatures ?? true) {
    for (const feature of disabledOptionalFeatures) {
      console.warn(
        `[Env] ${feature.name} disabled: ${feature.message}. Missing variable(s): ${feature.missingVariables.join(", ")}.`
      );
    }
  }

  return { disabledOptionalFeatures };
}

export const ENV = {
  get cookieSecret() {
    return requireCookieSecret("authentication sessions and, as a legacy fallback, encrypted app secrets");
  },
  get appSecretsEncryptionKey() {
    return readAppSecretsEncryptionKey();
  },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
  get aiProvider() { return process.env.AI_PROVIDER ?? "forge"; },
  get forgeApiUrl() { return process.env.BUILT_IN_FORGE_API_URL ?? ""; },
  get forgeApiKey() { return process.env.BUILT_IN_FORGE_API_KEY ?? ""; },
  get r2AccountId() { return process.env.R2_ACCOUNT_ID ?? ""; },
  get r2Bucket() { return process.env.R2_BUCKET ?? ""; },
  get r2AccessKeyId() { return process.env.R2_ACCESS_KEY_ID ?? ""; },
  get r2SecretAccessKey() { return process.env.R2_SECRET_ACCESS_KEY ?? ""; },
  get r2PublicBaseUrl() { return process.env.R2_PUBLIC_BASE_URL ?? ""; },
  get openaiApiKey() { return process.env.OPENAI_API_KEY ?? ""; },
  get openaiBaseUrl() { return process.env.OPENAI_BASE_URL ?? ""; },
  get openaiModel() { return process.env.OPENAI_MODEL ?? "gpt-4.1-mini"; },
  get openaiTranscriptionModel() { return process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1"; },
  get openaiImageModel() { return process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1"; },
  /** Selects the AI provider for vision/text tasks: "openai" (default) or "gemini" */
  get aiVisionProvider() { return (process.env.AI_VISION_PROVIDER ?? "openai").toLowerCase() as "openai" | "gemini"; },
  get geminiApiKey() { return process.env.GEMINI_API_KEY ?? ""; },
  get geminiModel() { return process.env.GEMINI_MODEL ?? "gemini-2.5-flash"; },
  /**
   * Returns the correct vision/text model name for the active provider.
   * Use this wherever getAiProvider().createTextResponse() is called.
   */
  get visionModel() {
    return (process.env.AI_VISION_PROVIDER ?? "openai").toLowerCase() === "gemini"
      ? (process.env.GEMINI_MODEL ?? "gemini-2.5-flash")
      : (process.env.OPENAI_MODEL ?? "gpt-4.1-mini");
  },
};