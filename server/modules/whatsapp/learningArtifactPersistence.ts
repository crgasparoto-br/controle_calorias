import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { whatsappLearningArtifacts } from "../../../drizzle/schema";
import { getDb, logPersistenceWarning } from "../../db";
import { canUseMemoryPersistenceFallback } from "../../repositories/memoryFallback";

export const WHATSAPP_LEARNING_ARTIFACTS_VERSION =
  "whatsapp-learning-artifacts/v1";

type ArtifactScope = "user" | "global";

export type WhatsappLearningArtifact<T = unknown> = {
  id: number;
  scope: ArtifactScope;
  userId: number | null;
  kind: string;
  key: string;
  value: T;
  version: string;
  createdAt: string;
  updatedAt: string;
};

type PersistArtifactInput<T> = {
  scope: ArtifactScope;
  userId?: number | null;
  kind: string;
  key: string;
  value: T;
  version?: string;
  createdAt?: Date;
};

type ArtifactIdentityInput = Pick<
  PersistArtifactInput<unknown>,
  "scope" | "userId" | "kind" | "key"
>;

type ArtifactRow = {
  id: number;
  scope: ArtifactScope;
  userId: number | null;
  artifactKind: string;
  artifactKey: string;
  artifactValue: string;
  artifactVersion: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const fallbackArtifacts = new Map<string, WhatsappLearningArtifact<unknown>>();
let fallbackNextId = 1;

function toIso(value: Date | string | undefined) {
  const date =
    value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

function normalizeKey(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function artifactScopeKey(input: ArtifactIdentityInput) {
  return createHash("sha256")
    .update(
      [
        input.scope,
        input.userId ?? "global",
        normalizeKey(input.kind),
        normalizeKey(input.key),
      ].join("|")
    )
    .digest("hex");
}

function fallbackKey(input: ArtifactIdentityInput) {
  return `${input.scope}:${input.userId ?? "global"}:${normalizeKey(input.kind)}:${normalizeKey(input.key)}`;
}

function parseRow<T = unknown>(
  row: ArtifactRow
): WhatsappLearningArtifact<T> | null {
  try {
    const value = JSON.parse(row.artifactValue) as T;
    return {
      id: Number(row.id),
      scope: row.scope,
      userId:
        row.userId === null || row.userId === undefined
          ? null
          : Number(row.userId),
      kind: row.artifactKind,
      key: row.artifactKey,
      value,
      version: row.artifactVersion,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  } catch {
    return null;
  }
}

function validateInput(input: ArtifactIdentityInput) {
  if (!input.kind.trim() || !input.key.trim()) return false;
  if (
    input.scope === "user" &&
    (!Number.isInteger(input.userId) || Number(input.userId) <= 0)
  )
    return false;
  if (
    input.scope === "global" &&
    input.userId !== null &&
    input.userId !== undefined
  )
    return false;
  return true;
}

export async function persistWhatsappLearningArtifact<T = unknown>(
  input: PersistArtifactInput<T>
): Promise<WhatsappLearningArtifact<T> | null> {
  if (!validateInput(input)) return null;
  const scopeKey = artifactScopeKey(input);
  const key = fallbackKey(input);
  const createdAt = toIso(input.createdAt);
  const version = input.version ?? WHATSAPP_LEARNING_ARTIFACTS_VERSION;
  const serialized = JSON.stringify(input.value);

  try {
    const db = await getDb();
    if (db) {
      await db
        .insert(whatsappLearningArtifacts)
        .values({
          scope: input.scope,
          userId: input.userId ?? null,
          artifactKind: normalizeKey(input.kind),
          artifactKey: scopeKey,
          artifactValue: serialized,
          artifactVersion: version,
          createdAt: new Date(createdAt),
          updatedAt: new Date(createdAt),
        })
        .onDuplicateKeyUpdate({
          set: {
            artifactValue: serialized,
            artifactVersion: version,
            updatedAt: new Date(createdAt),
          },
        });

      const rows = await db
        .select({
          id: whatsappLearningArtifacts.id,
          scope: whatsappLearningArtifacts.scope,
          userId: whatsappLearningArtifacts.userId,
          artifactKind: whatsappLearningArtifacts.artifactKind,
          artifactKey: whatsappLearningArtifacts.artifactKey,
          artifactValue: whatsappLearningArtifacts.artifactValue,
          artifactVersion: whatsappLearningArtifacts.artifactVersion,
          createdAt: whatsappLearningArtifacts.createdAt,
          updatedAt: whatsappLearningArtifacts.updatedAt,
        })
        .from(whatsappLearningArtifacts)
        .where(
          and(
            eq(whatsappLearningArtifacts.scope, input.scope),
            input.scope === "user"
              ? eq(whatsappLearningArtifacts.userId, Number(input.userId))
              : eq(whatsappLearningArtifacts.artifactKey, scopeKey),
            eq(whatsappLearningArtifacts.artifactKey, scopeKey)
          )
        )
        .limit(1);
      const persisted = rows
        .map(row => parseRow<T>(row))
        .find((artifact): artifact is WhatsappLearningArtifact<T> =>
          Boolean(artifact)
        );
      return persisted ?? null;
    }
  } catch (error) {
    logPersistenceWarning(
      "WhatsApp learning artifact persistence skipped",
      error
    );
    return null;
  }

  if (!canUseMemoryPersistenceFallback()) {
    logPersistenceWarning(
      "WhatsApp learning artifact persistence unavailable",
      new Error(
        "Database unavailable and process-local memory fallback is disabled."
      )
    );
    return null;
  }

  const existing = fallbackArtifacts.get(key);
  const persisted: WhatsappLearningArtifact<T> = {
    id: existing?.id ?? fallbackNextId++,
    scope: input.scope,
    userId: input.userId ?? null,
    kind: normalizeKey(input.kind),
    key: normalizeKey(input.key),
    value: input.value,
    version,
    createdAt: existing?.createdAt ?? createdAt,
    updatedAt: createdAt,
  };
  fallbackArtifacts.set(key, persisted);
  return persisted;
}

export async function listPersistedWhatsappLearningArtifacts<
  T = unknown,
>(input: {
  scope: ArtifactScope;
  userId?: number | null;
  kind?: string;
}): Promise<WhatsappLearningArtifact<T>[] | null> {
  if (
    input.scope === "user" &&
    (!Number.isInteger(input.userId) || Number(input.userId) <= 0)
  )
    return [];
  if (
    input.scope === "global" &&
    input.userId !== undefined &&
    input.userId !== null
  )
    return [];

  try {
    const db = await getDb();
    if (db) {
      const rows = await db
        .select({
          id: whatsappLearningArtifacts.id,
          scope: whatsappLearningArtifacts.scope,
          userId: whatsappLearningArtifacts.userId,
          artifactKind: whatsappLearningArtifacts.artifactKind,
          artifactKey: whatsappLearningArtifacts.artifactKey,
          artifactValue: whatsappLearningArtifacts.artifactValue,
          artifactVersion: whatsappLearningArtifacts.artifactVersion,
          createdAt: whatsappLearningArtifacts.createdAt,
          updatedAt: whatsappLearningArtifacts.updatedAt,
        })
        .from(whatsappLearningArtifacts)
        .where(
          and(
            eq(whatsappLearningArtifacts.scope, input.scope),
            input.scope === "user"
              ? eq(whatsappLearningArtifacts.userId, Number(input.userId))
              : eq(whatsappLearningArtifacts.scope, "global")
          )
        );
      return rows
        .map(row => parseRow<T>(row))
        .filter((artifact): artifact is WhatsappLearningArtifact<T> =>
          Boolean(artifact)
        )
        .filter(artifact => !input.kind || artifact.kind === input.kind);
    }
  } catch (error) {
    logPersistenceWarning("WhatsApp learning artifact read skipped", error);
    return null;
  }

  if (!canUseMemoryPersistenceFallback()) return null;
  return [...fallbackArtifacts.values()]
    .filter(artifact => artifact.scope === input.scope)
    .filter(
      artifact => input.scope === "global" || artifact.userId === input.userId
    )
    .filter(artifact => !input.kind || artifact.kind === input.kind)
    .map(artifact => ({ ...artifact })) as WhatsappLearningArtifact<T>[];
}

export async function removePersistedWhatsappLearningArtifact(input: {
  scope: ArtifactScope;
  userId?: number | null;
  kind: string;
  key: string;
}): Promise<boolean> {
  if (!validateInput(input)) return false;
  const scopeKey = artifactScopeKey(input);
  try {
    const db = await getDb();
    if (db) {
      await db
        .delete(whatsappLearningArtifacts)
        .where(
          and(
            eq(whatsappLearningArtifacts.scope, input.scope),
            eq(whatsappLearningArtifacts.artifactKey, scopeKey)
          )
        );
      return true;
    }
  } catch (error) {
    logPersistenceWarning("WhatsApp learning artifact removal skipped", error);
    return false;
  }
  if (!canUseMemoryPersistenceFallback()) return false;
  fallbackArtifacts.delete(fallbackKey(input));
  return true;
}

export function __resetWhatsappLearningArtifactPersistenceForTests() {
  fallbackArtifacts.clear();
  fallbackNextId = 1;
}

export const WHATSAPP_LEARNING_ARTIFACT_PERSISTENCE_PREFIX =
  "whatsapp-learning-artifact:";
