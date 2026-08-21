import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function importEnvModule() {
  vi.resetModules();
  return import("./env");
}

describe("runtime environment validation", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.APP_SECRETS_ENCRYPTION_KEY;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("fails production startup when JWT_SECRET is missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "mysql://user:password@example.com:3306/app";
    delete process.env.JWT_SECRET;
    const { validateRuntimeEnv } = await importEnvModule();

    expect(() => validateRuntimeEnv({ logOptionalFeatures: false })).toThrow(
      "Missing or invalid required production environment variable(s): JWT_SECRET"
    );
  });

  it("fails production startup when JWT_SECRET is empty or whitespace only", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "   ";
    process.env.DATABASE_URL = "mysql://user:password@example.com:3306/app";
    const { validateRuntimeEnv } = await importEnvModule();

    expect(() => validateRuntimeEnv({ logOptionalFeatures: false })).toThrow("JWT_SECRET");
  });

  it("fails production startup when DATABASE_URL is missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "session-secret-for-production";
    delete process.env.DATABASE_URL;
    const { validateRuntimeEnv } = await importEnvModule();

    expect(() => validateRuntimeEnv({ logOptionalFeatures: false })).toThrow(
      "Missing or invalid required production environment variable(s): DATABASE_URL"
    );
  });

  it("fails production startup when DATABASE_URL is empty or whitespace only", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "session-secret-for-production";
    process.env.DATABASE_URL = "   ";
    const { validateRuntimeEnv } = await importEnvModule();

    expect(() => validateRuntimeEnv({ logOptionalFeatures: false })).toThrow("DATABASE_URL");
  });

  it("allows production startup when required secrets and database are configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "session-secret-for-production";
    process.env.DATABASE_URL = "mysql://user:password@example.com:3306/app";
    const { validateRuntimeEnv } = await importEnvModule();

    expect(() => validateRuntimeEnv({ logOptionalFeatures: false })).not.toThrow();
  });

  it("allows non-production startup without JWT_SECRET", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.JWT_SECRET;
    const { validateRuntimeEnv } = await importEnvModule();

    expect(() => validateRuntimeEnv({ logOptionalFeatures: false })).not.toThrow();
  });

  it("blocks secure cookie/encryption secret usage when JWT_SECRET is not configured", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.JWT_SECRET;
    const { ENV, requireCookieSecret } = await importEnvModule();

    expect(() => requireCookieSecret("app secret encryption")).toThrow(
      "JWT_SECRET is required for app secret encryption"
    );
    expect(() => ENV.cookieSecret).toThrow("JWT_SECRET is required");
  });

  it("reports optional feature configuration without aborting startup", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "session-secret-for-production";
    process.env.DATABASE_URL = "mysql://user:password@example.com:3306/app";
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;
    delete process.env.STRAVA_REDIRECT_URI;
    const { validateRuntimeEnv } = await importEnvModule();

    const result = validateRuntimeEnv();

    expect(result.disabledOptionalFeatures.some((feature) => feature.name === "Strava OAuth")).toBe(true);
    expect(result.disabledOptionalFeatures.some((feature) => feature.name === "Database persistence")).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Strava OAuth disabled"));
  });

  it("reports the dedicated app secrets encryption key as disabled when absent, without exposing values", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "session-secret-for-production";
    process.env.DATABASE_URL = "mysql://user:password@example.com:3306/app";
    delete process.env.APP_SECRETS_ENCRYPTION_KEY;
    const { validateRuntimeEnv } = await importEnvModule();

    const result = validateRuntimeEnv();

    const feature = result.disabledOptionalFeatures.find((entry) => entry.name === "Dedicated app secrets encryption key");
    expect(feature).toBeDefined();
    expect(feature?.missingVariables).toEqual(["APP_SECRETS_ENCRYPTION_KEY"]);
  });

  it("exposes the dedicated app secrets encryption key when configured, and empty string when absent or blank", async () => {
    delete process.env.APP_SECRETS_ENCRYPTION_KEY;
    const { ENV: envWithoutKey } = await importEnvModule();
    expect(envWithoutKey.appSecretsEncryptionKey).toBe("");

    process.env.APP_SECRETS_ENCRYPTION_KEY = "   ";
    const { ENV: envWithBlankKey } = await importEnvModule();
    expect(envWithBlankKey.appSecretsEncryptionKey).toBe("");

    process.env.APP_SECRETS_ENCRYPTION_KEY = "dedicated-key-value";
    const { ENV: envWithKey } = await importEnvModule();
    expect(envWithKey.appSecretsEncryptionKey).toBe("dedicated-key-value");
  });
});
