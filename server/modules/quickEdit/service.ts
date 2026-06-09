import crypto from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { getDb, logInferenceEvent } from "../../db";
import { quickEditTokens } from "../../../drizzle/schema";
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
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error(
      "Nenhuma URL pública absoluta configurada para gerar links de edição rápida. " +
      "Defina QUICK_EDIT_BASE_URL, PUBLIC_APP_URL, APP_BASE_URL ou APP_URL com uma URL iniciando por https://.",
    );
  }
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

async function insertTokenInDb(row: QuickEditTokenRow) {
  const db = await getDb();
  if (!db) return;

  await db.insert(quickEditTokens).values({
    userId: row.userId,
    mealId: row.mealId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
  });
}

async function findTokenInDb(tokenHash: string) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(quickEditTokens)
    .where(eq(quickEditTokens.tokenHash, tokenHash))
    .limit(1);

  return rows[0] ?? null;
}

async function touchTokenInDb(tokenHash: string) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(quickEditTokens)
    .set({ lastAccessedAt: new Date() })
    .where(eq(quickEditTokens.tokenHash, tokenHash));
}

async function deleteExpiredTokensInDb() {
  const db = await getDb();
  if (!db) return;

  await db
    .delete(quickEditTokens)
    .where(lt(quickEditTokens.expiresAt, new Date()));
}

async function findQuickEditToken(token: string) {
  const tokenHash = hashToken(token.trim());
  assertTokenAttemptAllowed(tokenHash);

  const dbRow = await findTokenInDb(tokenHash);
  const row = dbRow ?? tokenStore.get(tokenHash) ?? null;
  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
    logInferenceEvent({
      origin: "web",
      status: "warning",
      eventType: "quick_edit.token_invalid",
      detail: "Tentativa de acesso com link de edição rápida inválido ou expirado.",
    });
    throw new QuickEditTokenError();
  }

  if (dbRow) {
    await touchTokenInDb(tokenHash);
  } else {
    tokenStore.set(tokenHash, { ...row, lastAccessedAt: new Date() });
  }

  return row;
}

type ListedMeal = Awaited<ReturnType<typeof listMeals>>[number];

type QuickEditPublicMeal = Omit<ListedMeal, "userId" | "sourceText" | "transcript" | "media">;

function toPublicMealView(meal: ListedMeal): QuickEditPublicMeal {
  const { userId: _u, sourceText: _s, transcript: _t, media: _m, ...rest } = meal;
  return rest;
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

  logInferenceEvent({
    userId: row.userId,
    origin: "web",
    status: "success",
    eventType: "quick_edit.link_opened",
    detail: "Página de edição rápida acessada por link temporário.",
  });

  return {
    meal: toPublicMealView(meal),
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

export async function purgeExpiredQuickEditTokens() {
  const now = Date.now();
  for (const [hash, row] of tokenStore.entries()) {
    if (new Date(row.expiresAt).getTime() <= now) {
      tokenStore.delete(hash);
    }
  }
  await deleteExpiredTokensInDb();
}

export function __resetQuickEditTokensForTests() {
  tokenStore.clear();
  tokenAttemptBuckets.clear();
  quickEditTokenSequence = 1;
}
