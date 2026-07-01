import crypto from "node:crypto";

export type EncryptedSecretKeySource = "dedicated" | "legacy";

export type EncryptedSecretPayload = {
  iv: string;
  tag: string;
  value: string;
  keySource: EncryptedSecretKeySource;
};

export type AppSecretCipherKeyDeps = {
  dedicatedKey: string;
  getLegacyKey: () => string;
};

function deriveCipherKey(namespace: string, secret: string) {
  return crypto.createHash("sha256").update(`controle-calorias::${namespace}::${secret}`).digest();
}

function getCipherKeyForEncryption(deps: AppSecretCipherKeyDeps): { cipherKey: Buffer; keySource: EncryptedSecretKeySource } {
  const trimmedDedicated = deps.dedicatedKey.trim();
  if (trimmedDedicated) {
    return { cipherKey: deriveCipherKey("app-secrets::dedicated", trimmedDedicated), keySource: "dedicated" };
  }

  return { cipherKey: deriveCipherKey("app-secrets", deps.getLegacyKey()), keySource: "legacy" };
}

function getCipherKeyForDecryption(keySource: EncryptedSecretKeySource, deps: AppSecretCipherKeyDeps): Buffer {
  if (keySource === "dedicated") {
    const trimmedDedicated = deps.dedicatedKey.trim();
    if (!trimmedDedicated) {
      throw new Error("APP_SECRETS_ENCRYPTION_KEY is required to decrypt this persisted secret");
    }
    return deriveCipherKey("app-secrets::dedicated", trimmedDedicated);
  }

  return deriveCipherKey("app-secrets", deps.getLegacyKey());
}

export function encryptAppSecretValue(value: string, deps: AppSecretCipherKeyDeps): { payload: string; keySource: EncryptedSecretKeySource } {
  const { cipherKey, keySource } = getCipherKeyForEncryption(deps);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cipherKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64"),
    keySource,
  } satisfies EncryptedSecretPayload);

  return { payload, keySource };
}

export function decryptAppSecretValue(payload: string, deps: AppSecretCipherKeyDeps): string {
  const parsed = JSON.parse(payload) as EncryptedSecretPayload;
  const keySource: EncryptedSecretKeySource = parsed.keySource ?? "legacy";
  const cipherKey = getCipherKeyForDecryption(keySource, deps);

  const decipher = crypto.createDecipheriv("aes-256-gcm", cipherKey, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.value, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
