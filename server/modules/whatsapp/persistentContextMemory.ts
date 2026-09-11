import { createHash } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { userPreferences } from "../../../drizzle/schema";
import { getDb, logPersistenceWarning } from "../../db";
import { canUseMemoryPersistenceFallback } from "../../repositories/memoryFallback";
import type { WhatsappContextMemoryEntry } from "./contextMemory";

const PREFERENCE_PREFIX = "whatsapp_context_memory_v1:";
const fallbackEntries = new Map<string, { id: number; entry: WhatsappContextMemoryEntry }>();
let fallbackNextId = 1;

type StoredContextMemory = {
  version: 1;
  entry: Omit<WhatsappContextMemoryEntry, "id">;
};

function preferenceKeyFor(entry: WhatsappContextMemoryEntry) {
  const digest = createHash("sha256")
    .update([entry.scope, entry.keyHash].join("|"))
    .digest("hex");
  return `${PREFERENCE_PREFIX}${digest}`;
}

function serialize(entry: WhatsappContextMemoryEntry) {
  const stored: StoredContextMemory = {
    version: 1,
    entry: {
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      userId: entry.userId,
      scope: entry.scope,
      kind: entry.kind,
      status: entry.status,
      key: entry.key,
      keyHash: entry.keyHash,
      value: entry.value,
      valueHash: entry.valueHash,
      confidence: entry.confidence,
      priority: entry.priority,
      appliesToIntents: [...entry.appliesToIntents],
      source: { ...entry.source },
      replacesMemoryId: entry.replacesMemoryId,
      replacedByMemoryId: entry.replacedByMemoryId,
      expiresAt: entry.expiresAt,
      disabledReason: entry.disabledReason,
      privacy: entry.privacy,
    },
  };
  return JSON.stringify(stored);
}

function parseStored(id: number, userId: number, value: string | null | undefined): WhatsappContextMemoryEntry | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredContextMemory>;
    const entry = parsed.entry as Partial<WhatsappContextMemoryEntry> | undefined;
    if (parsed.version !== 1 || !entry) return null;
    if (entry.scope !== "individual" || entry.userId !== userId) return null;
    if (!entry.kind || !entry.status || !entry.key || !entry.keyHash || !entry.valueHash) return null;
    if (typeof entry.value !== "string" || typeof entry.confidence !== "number" || typeof entry.priority !== "number") return null;
    if (!Array.isArray(entry.appliesToIntents) || !entry.source || !entry.privacy) return null;
    return {
      ...(entry as Omit<WhatsappContextMemoryEntry, "id">),
      id,
      userId,
      appliesToIntents: [...entry.appliesToIntents],
      source: { ...entry.source },
    };
  } catch {
    return null;
  }
}

function fallbackKey(userId: number, preferenceKey: string) {
  return `${userId}:${preferenceKey}`;
}

export async function persistWhatsappContextMemoryEntry(
  entry: WhatsappContextMemoryEntry,
): Promise<WhatsappContextMemoryEntry | null> {
  if (entry.scope !== "individual" || !entry.userId) return null;
  const preferenceKey = preferenceKeyFor(entry);
  const preferenceValue = serialize(entry);

  try {
    const db = await getDb();
    if (db) {
      await db.insert(userPreferences).values({
        userId: entry.userId,
        preferenceKey,
        preferenceValue,
      }).onDuplicateKeyUpdate({
        set: {
          preferenceValue,
          updatedAt: new Date(),
        },
      });

      const [row] = await db.select({
        id: userPreferences.id,
        preferenceValue: userPreferences.preferenceValue,
      }).from(userPreferences).where(and(
        eq(userPreferences.userId, entry.userId),
        eq(userPreferences.preferenceKey, preferenceKey),
      )).limit(1);
      return row ? parseStored(row.id, entry.userId, row.preferenceValue) : null;
    }
  } catch (error) {
    logPersistenceWarning("WhatsApp contextual memory persistence skipped", error);
    return null;
  }

  if (!canUseMemoryPersistenceFallback()) {
    logPersistenceWarning(
      "WhatsApp contextual memory persistence unavailable",
      new Error("Database unavailable and process-local memory fallback is disabled."),
    );
    return null;
  }

  const key = fallbackKey(entry.userId, preferenceKey);
  const existing = fallbackEntries.get(key);
  const persisted = { ...entry, id: existing?.id ?? fallbackNextId++ };
  fallbackEntries.set(key, { id: persisted.id, entry: persisted });
  return persisted;
}

export async function loadPersistedWhatsappContextMemories(
  userId: number,
): Promise<WhatsappContextMemoryEntry[] | null> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.select({
        id: userPreferences.id,
        preferenceValue: userPreferences.preferenceValue,
      }).from(userPreferences).where(and(
        eq(userPreferences.userId, userId),
        like(userPreferences.preferenceKey, `${PREFERENCE_PREFIX}%`),
      ));
      return rows
        .map(row => parseStored(row.id, userId, row.preferenceValue))
        .filter((entry): entry is WhatsappContextMemoryEntry => Boolean(entry));
    }
  } catch (error) {
    logPersistenceWarning("WhatsApp contextual memory read skipped", error);
    return null;
  }

  if (!canUseMemoryPersistenceFallback()) return null;
  return [...fallbackEntries.values()]
    .map(row => row.entry)
    .filter(entry => entry.userId === userId)
    .map(entry => ({ ...entry, source: { ...entry.source }, appliesToIntents: [...entry.appliesToIntents] }));
}

export function __resetPersistentWhatsappContextMemoryForTests() {
  fallbackEntries.clear();
  fallbackNextId = 1;
}

export const WHATSAPP_CONTEXT_MEMORY_PREFERENCE_PREFIX = PREFERENCE_PREFIX;
