import crypto from "node:crypto";
import { ENV } from "../../../_core/env";
import type { EncryptedSecretPayload } from "./types";

function getSecretCipherKey() {
  return crypto
    .createHash("sha256")
    .update(`controle-calorias::health-integrations::${ENV.cookieSecret}`)
    .digest();
}

export function encryptSecretValue(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSecretCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64"),
  } satisfies EncryptedSecretPayload);
}

export function decryptSecretValue(payload: string) {
  const parsed = JSON.parse(payload) as EncryptedSecretPayload;
  const decipher = crypto.createDecipheriv("aes-256-gcm", getSecretCipherKey(), Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.value, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
