import { describe, expect, it } from "vitest";
import { decryptAppSecretValue, encryptAppSecretValue } from "./encryption";

const DEDICATED_KEY = "test-dedicated-key-0123456789";
const LEGACY_KEY = "test-legacy-jwt-secret-0123456789";

function deps(overrides: { dedicatedKey?: string; legacyKey?: string } = {}) {
  return {
    dedicatedKey: overrides.dedicatedKey ?? "",
    getLegacyKey: () => overrides.legacyKey ?? LEGACY_KEY,
  };
}

describe("app secrets encryption", () => {
  it("encrypts and decrypts a round trip using the dedicated key when configured", () => {
    const { payload, keySource } = encryptAppSecretValue("super-secret-value", deps({ dedicatedKey: DEDICATED_KEY }));
    expect(keySource).toBe("dedicated");

    const decrypted = decryptAppSecretValue(payload, deps({ dedicatedKey: DEDICATED_KEY }));
    expect(decrypted).toBe("super-secret-value");
  });

  it("falls back to the legacy key when no dedicated key is configured", () => {
    const { payload, keySource } = encryptAppSecretValue("legacy-secret-value", deps());
    expect(keySource).toBe("legacy");

    const decrypted = decryptAppSecretValue(payload, deps());
    expect(decrypted).toBe("legacy-secret-value");
  });

  it("treats a whitespace-only dedicated key as absent and uses the legacy key", () => {
    const { keySource } = encryptAppSecretValue("value", deps({ dedicatedKey: "   " }));
    expect(keySource).toBe("legacy");
  });

  it("reads legacy payloads persisted before the keySource field existed", () => {
    const { payload } = encryptAppSecretValue("old-format-secret", deps());
    const withoutKeySource = JSON.stringify({ ...JSON.parse(payload), keySource: undefined });

    const decrypted = decryptAppSecretValue(withoutKeySource, deps());
    expect(decrypted).toBe("old-format-secret");
  });

  it("keeps dedicated-key secrets readable after the legacy key rotates", () => {
    const { payload } = encryptAppSecretValue("rotation-safe-secret", deps({ dedicatedKey: DEDICATED_KEY, legacyKey: LEGACY_KEY }));

    const decrypted = decryptAppSecretValue(payload, deps({ dedicatedKey: DEDICATED_KEY, legacyKey: "rotated-jwt-secret" }));
    expect(decrypted).toBe("rotation-safe-secret");
  });

  it("throws a sanitized error when a dedicated-key payload is decrypted without the dedicated key", () => {
    const { payload } = encryptAppSecretValue("value", deps({ dedicatedKey: DEDICATED_KEY }));

    expect(() => decryptAppSecretValue(payload, deps())).toThrowError(/APP_SECRETS_ENCRYPTION_KEY is required/);
  });

  it("throws a controlled error for a corrupted payload without leaking content", () => {
    expect(() => decryptAppSecretValue("not-json", deps())).toThrow();
    expect(() => decryptAppSecretValue(JSON.stringify({ iv: "aa", tag: "bb", value: "cc", keySource: "legacy" }), deps())).toThrow();
  });
});
