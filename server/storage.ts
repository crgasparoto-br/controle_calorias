// Storage helpers for backend-generated media.
// Uses Cloudflare R2 when R2_* variables are configured, otherwise falls back to
// the Biz-provided Forge storage proxy for existing environments.

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ENV } from "./_core/env";

type ForgeStorageConfig = { baseUrl: string; apiKey: string };
type R2StorageConfig = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
};

type StorageConfig =
  | { provider: "r2"; config: R2StorageConfig }
  | { provider: "forge"; config: ForgeStorageConfig };

type StoragePutOptions = {
  publicRead?: boolean;
};

const R2_REQUIRED_ENV = [
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PUBLIC_BASE_URL",
] as const;

let r2Client: S3Client | null = null;
let r2ClientAccountId: string | null = null;

function assertAbsoluteHttpUrl(value: string, envName: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("invalid protocol");
    }
    return value.replace(/\/+$/, "");
  } catch {
    throw new Error(`${envName} must be an absolute URL starting with https:// or http://`);
  }
}

function getR2Config(): R2StorageConfig | null {
  const config = {
    accountId: ENV.r2AccountId,
    bucket: ENV.r2Bucket,
    accessKeyId: ENV.r2AccessKeyId,
    secretAccessKey: ENV.r2SecretAccessKey,
    publicBaseUrl: ENV.r2PublicBaseUrl,
  };
  const values = Object.values(config);
  const hasAnyR2Config = values.some(Boolean);

  if (!hasAnyR2Config) {
    return null;
  }

  const missing = R2_REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error(
      `R2 storage credentials missing: set ${missing.join(", ")}`,
    );
  }

  return {
    ...config,
    publicBaseUrl: assertAbsoluteHttpUrl(config.publicBaseUrl, "R2_PUBLIC_BASE_URL"),
  };
}

function getForgeStorageConfig(): ForgeStorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage credentials missing: configure R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_PUBLIC_BASE_URL, or set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return {
    baseUrl: assertAbsoluteHttpUrl(baseUrl, "BUILT_IN_FORGE_API_URL"),
    apiKey,
  };
}

function getStorageConfig(): StorageConfig {
  const r2Config = getR2Config();
  if (r2Config) {
    return { provider: "r2", config: r2Config };
  }

  return { provider: "forge", config: getForgeStorageConfig() };
}

function getR2Client(config: R2StorageConfig) {
  if (!r2Client || r2ClientAccountId !== config.accountId) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    r2ClientAccountId = config.accountId;
  }

  return r2Client;
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string,
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl),
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
  });
  return (await response.json()).url;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const segmentStart = relKey.lastIndexOf("/");
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1 || lastDot <= segmentStart) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function extensionFromKey(relKey: string) {
  const lastSegment = normalizeKey(relKey).split("/").pop() ?? "";
  const lastDot = lastSegment.lastIndexOf(".");
  return lastDot > 0 ? lastSegment.slice(lastDot) : "";
}

function buildOpaqueR2Key(relKey: string, publicRead = false) {
  const prefix = publicRead ? "public" : "private";
  const extension = extensionFromKey(relKey);
  return `${prefix}/media/${crypto.randomUUID()}${extension}`;
}

function buildR2PublicUrl(publicBaseUrl: string, key: string) {
  const encodedKey = normalizeKey(key)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(encodedKey, ensureTrailingSlash(publicBaseUrl)).toString();
}

function buildR2InternalUrl(bucket: string, key: string) {
  return `r2://${bucket}/${normalizeKey(key)}`;
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string,
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

async function putToForgeStorage(
  config: ForgeStorageConfig,
  key: string,
  data: Buffer | Uint8Array | string,
  contentType: string,
) {
  const uploadUrl = buildUploadUrl(config.baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(config.apiKey),
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`,
    );
  }
  const url = (await response.json()).url;
  return { key, url };
}

async function putToR2Storage(
  config: R2StorageConfig,
  key: string,
  data: Buffer | Uint8Array | string,
  contentType: string,
  options: StoragePutOptions,
) {
  const client = getR2Client(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    }),
  );

  return {
    key,
    url: options.publicRead
      ? buildR2PublicUrl(config.publicBaseUrl, key)
      : buildR2InternalUrl(config.bucket, key),
  };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
  options: StoragePutOptions = {},
): Promise<{ key: string; url: string }> {
  const storage = getStorageConfig();
  const normalizedKey = normalizeKey(relKey);

  if (storage.provider === "r2") {
    const key = buildOpaqueR2Key(normalizedKey, options.publicRead);
    return putToR2Storage(storage.config, key, data, contentType, options);
  }

  const key = appendHashSuffix(normalizedKey);
  return putToForgeStorage(storage.config, key, data, contentType);
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const storage = getStorageConfig();
  const key = normalizeKey(relKey);

  if (storage.provider === "r2") {
    return {
      key,
      url: buildR2PublicUrl(storage.config.publicBaseUrl, key),
    };
  }

  return {
    key,
    url: await buildDownloadUrl(storage.config.baseUrl, key, storage.config.apiKey),
  };
}
