import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, logInferenceEvent } from "../../db";
import { listMeals, updateMeal } from "../meals/service";
import type { UpdateMealInput } from "../meals/schemas";

const QUICK_EDIT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TOKEN_ATTEMPTS_PER_WINDOW = 30;
const TOKEN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

type QuickEditTokenRow = {
  id: number;
  userId: number;
  mealId: number;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  lastAccessedAt: Date | null;
};

type QuickEditTokenView = {
  token: string;
  url: string;
  expiresAt: string;
};

type TokenAttemptBucket = {
  count: number;
  resetsAt: number;
};

const tokenStore = new Map<string, QuickEditTokenRow>();
const tokenAttemptBuckets = new Map<string, TokenAttemptBucket>();
let quickEditTokenSequence = 1;

export class QuickEditTokenError extends Error {
  constructor() {
    super("Link de edição inválido ou expirado.");
    this.name = "QuickEditTokenError";
  }
}

function createRandomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function getQuickEditBaseUrl() {
  const configured = process.env.QUICK_EDIT_BASE_URL
    ?? process.env.PUBLIC_APP_URL
    ?? process.env.APP_BASE_URL
    ?? process.env.APP_URL
    ?? "";
  return configured.replace(/\/+$/, "");
}

function buildQuickEditUrl(token: string) {
  const baseUrl = getQuickEditBaseUrl();
  return `${baseUrl}/quick-edit/${encodeURIComponent(token)}`;
}

function assertTokenAttemptAllowed(tokenHash: string) {
  const now = Date.now();
  const current = tokenAttemptBuckets.get(tokenHash);
  if (!current || current.resetsAt <= now) {
    tokenAttemptBuckets.set(tokenHash, { count: 1, resetsAt: now + TOKEN_ATTEMPT_WINDOW_MS });
    return;
  }

  current.count += 1;
  if (current.count > MAX_TOKEN_ATTEMPTS_PER_WINDOW) {
    throw new QuickEditTokenError();
  }
}

function normalizeDbRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as T[];
  }
  if (Array.isArray(result)) {
    return result as T[];
  }
  return [];
}

async function insertTokenInDb(row: QuickEditTokenRow) {
  const db = await getDb();
  if (!db) return;

  await db.execute(sql`
    INSERT INTO quickEditTokens (userId, mealId, tokenHash, expiresAt)
    VALUES (${row.userId}, ${row.mealId}, ${row.tokenHash}, ${row.expiresAt})
  `);
}

async function findTokenInDb(tokenHash: string) {
  const db = await getDb();
  if (!db) return null;

  const rows = normalizeDbRows<QuickEditTokenRow>(await db.execute(sql`
    SELECT id, userId, mealId, tokenHash, expiresAt, usedAt, createdAt, lastAccessedAt
    FROM quickEditTokens
    WHERE tokenHash = ${tokenHash}
    LIMIT 1
  `));

  return rows[0] ?? null;
}

async function touchTokenInDb(tokenHash: string) {
  const db = await getDb();
  if (!db) return;

  await db.execute(sql`
    UPDATE quickEditTokens
    SET lastAccessedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
    WHERE tokenHash = ${tokenHash}
  `);
}

async function findQuickEditToken(token: string) {
  const tokenHash = hashToken(token.trim());
  assertTokenAttemptAllowed(tokenHash);

  const dbRow = await findTokenInDb(tokenHash);
  const row = dbRow ?? tokenStore.get(tokenHash) ?? null;
  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new QuickEditTokenError();
  }

  if (dbRow) {
    await touchTokenInDb(tokenHash);
  } else {
    tokenStore.set(tokenHash, { ...row, lastAccessedAt: new Date() });
  }

  return row;
}

export async function createQuickEditLinkForMeal(input: {
  userId: number;
  mealId: number;
  expiresInMs?: number;
}): Promise<QuickEditTokenView> {
  const token = createRandomToken();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.expiresInMs ?? QUICK_EDIT_TOKEN_TTL_MS));
  const row: QuickEditTokenRow = {
    id: quickEditTokenSequence++,
    userId: input.userId,
    mealId: input.mealId,
    tokenHash,
    expiresAt,
    usedAt: null,
    createdAt: now,
    lastAccessedAt: null,
  };

  tokenStore.set(tokenHash, row);
  await insertTokenInDb(row);

  return {
    token,
    url: buildQuickEditUrl(token),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function tryCreateQuickEditLinkForMeal(input: { userId: number; mealId: number }) {
  try {
    return await createQuickEditLinkForMeal(input);
  } catch (error) {
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "quick_edit.token_generation_failed",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao gerar link de edição rápida.",
    });
    return null;
  }
}

export async function getQuickEditMeal(token: string) {
  const row = await findQuickEditToken(token);
  const meal = (await listMeals(row.userId)).find(item => item.id === row.mealId);
  if (!meal) {
    throw new QuickEditTokenError();
  }

  return {
    meal,
    expiresAt: new Date(row.expiresAt).toISOString(),
  };
}

export async function updateQuickEditMeal(token: string, input: Omit<UpdateMealInput, "mealId">) {
  const row = await findQuickEditToken(token);
  const meal = await updateMeal(row.userId, {
    ...input,
    mealId: row.mealId,
  });

  logInferenceEvent({
    userId: row.userId,
    origin: "web",
    status: "success",
    eventType: "quick_edit.meal_updated",
    detail: "Refeição atualizada por link temporário de edição rápida.",
  });

  return meal;
}

export function __resetQuickEditTokensForTests() {
  tokenStore.clear();
  tokenAttemptBuckets.clear();
  quickEditTokenSequence = 1;
}
