import crypto from "node:crypto";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";

const scryptAsync = promisify(crypto.scrypt);
const BCRYPT_PREFIX = "$2";
const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_HASH_VERSION = "v1";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_BYTES = 16;
const BCRYPT_COST = 12;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function passwordHashNeedsUpgrade(passwordHash: string | null | undefined) {
  return !passwordHash || !passwordHash.startsWith(BCRYPT_PREFIX);
}

async function verifyLegacyScrypt(password: string, passwordHash: string) {
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

export async function verifyPassword(password: string, passwordHash: string | null | undefined) {
  if (!passwordHash) return false;

  if (passwordHash.startsWith(BCRYPT_PREFIX)) {
    try {
      return await bcrypt.compare(password, passwordHash);
    } catch {
      return false;
    }
  }

  return verifyLegacyScrypt(password, passwordHash);
}
