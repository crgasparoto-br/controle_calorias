import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_HASH_VERSION = "v1";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_BYTES = 16;

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES).toString("base64url");
  const derivedKey = (await scryptAsync(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `${PASSWORD_HASH_ALGORITHM}:${PASSWORD_HASH_VERSION}:${salt}:${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(password: string, passwordHash: string | null | undefined) {
  if (!passwordHash) return false;

  const [algorithm, version, salt, storedKey] = passwordHash.split(":");
  if (algorithm !== PASSWORD_HASH_ALGORITHM || version !== PASSWORD_HASH_VERSION || !salt || !storedKey) {
    return false;
  }

  try {
    const derivedKey = (await scryptAsync(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    const storedBuffer = Buffer.from(storedKey, "base64url");
    if (storedBuffer.length !== derivedKey.length) return false;
    return crypto.timingSafeEqual(storedBuffer, derivedKey);
  } catch {
    return false;
  }
}
