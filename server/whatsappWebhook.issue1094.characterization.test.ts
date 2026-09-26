import express from "express";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  AppendMessageInput,
  DomainLinkInput,
  WhatsAppConversationRepository,
} from "./repositories/whatsappConversationRepository";
import type { WhatsAppConversationMessageEnrichmentRepository } from "./repositories/whatsappConversationMessageEnrichmentRepository";
import type { WhatsAppProcessingClaimRepository } from "./repositories/whatsappProcessingClaimRepository";
import type { CatalogFood, MealProcessingInput } from "./nutritionEngineTypes";
import {
  normalizeForMatching,
  parseFoodText,
  splitFoodTextSegments,
} from "./mealTextParsing";
import { RATE_LIMITS, createExpressRateLimit } from "./_core/rateLimit";
import { registerWhatsAppPublicPostRoute } from "./whatsappPublicRoute";

type SemanticFactSnapshot = {
  originalText: string;
  foodName: string;
  brand: string | null;
  productVariant: string | null;
  quantity: number;
  unit: string;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  nutritionOrigin: string;
  nutritionVerified: boolean;
  sourceUrls: string[];
};

const nativeFetch = globalThis.fetch.bind(globalThis);
const BASELINE_DEVELOP_SHA = "4d86cb814ff57164ff16cd7626ea21be46719fce";
const METRICS_BASELINE_DEVELOP_SHA = "521b645182f3811bf904cb28aafb152b990ed184";
const F0_07_REVALIDATION = {
  status: "revalidated" as const,
  baselineSha: BASELINE_DEVELOP_SHA,
  affectedPaths: [
    "POST /api/whatsapp/webhook",
    "server/whatsappPersistentContextWebhook.ts",
    "server/whatsappWebhook.ts::handleWhatsAppWebhook",
  ],
};
const CHARACTERIZATION_DEVELOP_SHA = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unavailable";
  }
})();
const TEST_PHONE = "5511999999999";
const CHANNEL_PHONE_NUMBER_ID = "phone-number-test";
let activeVisionFixtureText: string | null = null;

const state = vi.hoisted(() => {
  const metrics = () => ({
    // primary metrics
    processMealInput: 0,
    mealProcessingResults: 0,
    nutritionSearchAttempts: 0,
    nutritionSearchOutbound: 0,
    webNutritionCacheLookups: 0,
    nutritionSearchByItem: {} as Record<
      string,
      { attempts: number; outbound: number }
    >,
    householdMeasureAttempts: 0,
    roundTrips: 0,
    roundTripFailures: 0,
    fullSemanticRoundTrips: 0,
    fullSemanticRoundTripFailures: 0,
    monotonicChecks: 0,
    monotonicViolations: 0,
    pendingReplyOrderChecks: 0,
    pendingReplyOrderViolations: 0,
    semanticContracts: 0,
    drafts: 0,
    persistedMeals: 0,
    persistedItems: 0,
    pendingCreated: 0,
    pendingClaimed: 0,
    pendingConsumed: 0,
    domainLinks: 0,
  });

  return {
    users: new Map<string, number>(),
    catalog: [] as CatalogFood[],
    events: [] as Array<{ eventType?: string; detail?: string }>,
    contracts: [] as Array<{
      originalText: string;
      items: SemanticFactSnapshot[];
    }>,
    outboundReplies: [] as string[],
    nutritionSearchItems: {} as Record<string, string>,
    nutritionSearchResults: {} as Record<
      string,
      {
        requested: string;
        matched: string;
        sourceUrl: string;
        sourceEvidence: string;
      }
    >,
    pendingRows: new Map<number, any>(),
    nextPendingId: 1,
    claims: new Map<number, { ownerToken: string; heartbeatAt: Date }>(),
    semanticSnapshots: new Map<string, SemanticFactSnapshot[]>(),
    sequence: [] as string[],
    metrics: metrics(),
    searchMode: "accepted" as
      | "accepted"
      | "variant_mismatch"
      | "grounding_missing"
      | "failed"
      | "unavailable",
    transcript: "100 g de arroz branco",
    visionFoodText: null as string | null,
    webNutritionCache: null as CatalogFood | null,
    visionRequestObserved: false,
    pendingCreateFailure: false,
    sendReplyFailure: false,
    pendingStorePath: null as string | null,
    lifecycleStorePath: null as string | null,
    pendingDb: null as any,
    reset() {
      this.users.clear();
      this.catalog = [];
      this.events = [];
      this.contracts = [];
      this.semanticSnapshots.clear();
      this.sequence = [];
      this.outboundReplies = [];
      this.nutritionSearchItems = {};
      this.nutritionSearchResults = {};
      this.pendingRows.clear();
      this.nextPendingId = 1;
      this.claims.clear();
      this.metrics = metrics();
      this.searchMode = "accepted";
      this.transcript = "100 g de arroz branco";
      this.visionFoodText = null;
      this.webNutritionCache = null;
      this.visionRequestObserved = false;
      this.pendingCreateFailure = false;
      this.sendReplyFailure = false;
      this.pendingStorePath = null;
      this.lifecycleStorePath = null;
      this.pendingDb = null;
    },
  };
});

function revivePendingRow(row: any) {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    updatedAt: new Date(row.updatedAt),
    consumedAt: row.consumedAt ? new Date(row.consumedAt) : null,
  };
}

function readPendingRows() {
  if (!state.pendingStorePath) return [...state.pendingRows.values()];
  if (!existsSync(state.pendingStorePath)) return [];
  return JSON.parse(readFileSync(state.pendingStorePath, "utf8")).map(
    revivePendingRow
  );
}

function writePendingRows(rows: any[]) {
  if (!state.pendingStorePath) {
    state.pendingRows.clear();
    for (const row of rows) state.pendingRows.set(row.id, row);
    return;
  }
  writeFileSync(state.pendingStorePath, JSON.stringify(rows), "utf8");
}

function cleanupPendingStore() {
  const storePath = state.pendingStorePath ?? state.lifecycleStorePath;
  if (!storePath) return;
  rmSync(storePath, { force: true });
  rmSync(dirname(storePath), { force: true, recursive: true });
  state.pendingStorePath = null;
  state.lifecycleStorePath = null;
}

function reviveStoredMessage(message: any): StoredMessage {
  return {
    ...message,
    occurredAt: new Date(message.occurredAt),
    createdAt: new Date(message.createdAt),
    updatedAt: new Date(message.updatedAt),
    processedAt: message.processedAt ? new Date(message.processedAt) : null,
  };
}

function persistLifecycleState(shared: SharedLifecycleState) {
  if (!state.lifecycleStorePath) return;
  writeFileSync(
    state.lifecycleStorePath,
    JSON.stringify({
      messages: shared.messages,
      domainLinks: shared.domainLinks,
      nextMessageId: shared.nextMessageId,
    }),
    "utf8"
  );
}

type QueryToken =
  | { kind: "column"; name: string }
  | { kind: "operator"; value: string }
  | { kind: "param"; value: unknown };

function queryTokens(value: unknown): QueryToken[] {
  if (Array.isArray(value)) return value.flatMap(queryTokens);
  if (!value || typeof value !== "object") return [];

  const object = value as Record<string, any>;
  const constructorName = (value as object).constructor?.name ?? "";
  if (constructorName === "SQL") return queryTokens(object.queryChunks);
  if (constructorName === "StringChunk") {
    const text = Array.isArray(object.value)
      ? object.value.join("")
      : String(object.value ?? "");
    return [{ kind: "operator", value: text }];
  }
  if (constructorName === "Param") {
    return [{ kind: "param", value: object.value }];
  }
  if (constructorName.startsWith("MySql") && typeof object.name === "string") {
    return [{ kind: "column", name: object.name }];
  }
  return [];
}

function queryComparisons(condition: unknown) {
  const tokens = queryTokens(condition);
  const comparisons: Array<{
    name: string;
    operator: "=" | "<>" | "<";
    value: unknown;
  }> = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const column = tokens[index];
    const operator = tokens[index + 1];
    const parameter = tokens[index + 2];
    if (
      column.kind !== "column" ||
      operator.kind !== "operator" ||
      parameter.kind !== "param"
    )
      continue;
    const match = operator.value.match(/(<>|=|<)/u)?.[1] as
      | "="
      | "<>"
      | "<"
      | undefined;
    if (match)
      comparisons.push({
        name: column.name,
        operator: match,
        value: parameter.value,
      });
  }
  return comparisons;
}

function pendingDateValue(value: unknown) {
  return value instanceof Date
    ? value.getTime()
    : new Date(String(value)).getTime();
}

function matchesPendingRow(row: any, condition: unknown) {
  return queryComparisons(condition).every(comparison => {
    const actual = row[comparison.name];
    if (comparison.name === "updatedAt" || comparison.name === "expiresAt") {
      const left = pendingDateValue(actual);
      const right = pendingDateValue(comparison.value);
      if (comparison.operator === "<") return left < right;
      if (comparison.operator === "=") return left === right;
      return left !== right;
    }
    if (comparison.operator === "=") return actual === comparison.value;
    if (comparison.operator === "<>") return actual !== comparison.value;
    return actual < (comparison.value as any);
  });
}

function clonePendingRow(row: any) {
  return {
    ...row,
    target: structuredClone(row.target),
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    updatedAt: new Date(row.updatedAt),
    consumedAt: row.consumedAt ? new Date(row.consumedAt) : null,
  };
}

function createProductionPendingDb() {
  const load = () => readPendingRows().map(clonePendingRow);
  const save = (rows: any[]) => writePendingRows(rows.map(clonePendingRow));
  const select = vi.fn(() => {
    let whereCondition: unknown;
    let orderByCondition: unknown;
    let limitValue: number | undefined;
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn((condition: unknown) => {
        whereCondition = condition;
        return chain;
      }),
      orderBy: vi.fn((condition: unknown) => {
        orderByCondition = condition;
        return chain;
      }),
      limit: vi.fn((value: number) => {
        limitValue = value;
        let rows = load().filter(row => matchesPendingRow(row, whereCondition));
        if (
          queryTokens(orderByCondition).some(
            token => token.kind === "operator" && /desc/u.test(token.value)
          )
        ) {
          rows = rows.sort((left, right) => right.id - left.id);
        }
        return Promise.resolve(rows.slice(0, limitValue).map(clonePendingRow));
      }),
    };
    return chain;
  });

  return {
    select,
    insert: vi.fn(() => ({
      values: vi.fn(async (payload: any) => {
        if (state.pendingCreateFailure)
          throw new Error("pending persistence failure");
        const rows = load();
        const now = new Date();
        const id = Math.max(0, ...rows.map(row => Number(row.id))) + 1;
        const row = {
          id,
          ...payload,
          createdAt: now,
          updatedAt: now,
          consumedAt: null,
        };
        save([...rows, row]);
        state.metrics.pendingCreated += 1;
        state.sequence.push("pending-created");
        return { insertId: id };
      }),
    })),
    update: vi.fn(() => {
      let setPayload: any = {};
      return {
        set: vi.fn((payload: any) => {
          setPayload = payload;
          return {
            where: vi.fn(async (condition: unknown) => {
              const rows = load();
              const matching = rows.filter(row =>
                matchesPendingRow(row, condition)
              );
              for (const row of matching) Object.assign(row, setPayload);
              save(rows);
              if (setPayload.state === "consumed" && matching.length > 0) {
                state.metrics.pendingClaimed += 1;
                state.metrics.pendingConsumed += 1;
                state.sequence.push("pending-claimed");
              }
              return { affectedRows: matching.length };
            }),
          };
        }),
      };
    }),
    delete: vi.fn(() => ({
      where: vi.fn(async (condition: unknown) => {
        const rows = load();
        const remaining = rows.filter(
          row => !matchesPendingRow(row, condition)
        );
        save(remaining);
        return { affectedRows: rows.length - remaining.length };
      }),
    })),
  };
}

const readyPolicy = (capability: string) => ({
  capability,
  state: "ready",
  primary: { provider: "openai", model: "gpt-4.1-mini" },
  fallback: {
    requested: false,
    effectivelyEnabled: false,
    provider: null,
    model: null,
    crossProviderEnabled: false,
  },
  timeoutMs: 8_000,
  maxAttempts: 1,
  diagnostics: [],
  usedLegacyVariables: false,
});

function catalogFood(input: {
  name: string;
  aliases?: string[];
  servingLabel: string;
  gramsPerServing: number;
  brandName?: string | null;
  productVariant?: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}): CatalogFood {
  const brandName = input.brandName ?? null;
  const isBrandedProduct = Boolean(brandName);
  return {
    slug: input.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-"),
    name: input.name,
    aliases: input.aliases ?? [input.name],
    servingLabel: input.servingLabel,
    gramsPerServing: input.gramsPerServing,
    calories: input.calories,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    brandName,
    isBrandedProduct,
    ...(isBrandedProduct
      ? {
          productVariant: input.productVariant ?? null,
          variants: input.productVariant ? [input.productVariant] : [],
          researchIdentityKey: `nutrition-research-v1:${input.name}`,
          sourceUrls: [
            `https://catalog.example/${input.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`,
          ],
          sourceEvidence: `${input.name}. Porção de ${input.gramsPerServing} g (${input.servingLabel}): ${input.calories} kcal, proteínas ${input.protein} g, carboidratos ${input.carbs} g, gorduras totais ${input.fat} g.`,
          sourceVerifiedAt: new Date("2026-09-16T10:00:00.000Z"),
          sourceConfidence: 0.96,
        }
      : {}),
  };
}

function defaultCatalog() {
  return [
    catalogFood({
      name: "Arroz branco cozido",
      aliases: ["arroz branco", "arroz branco cozido", "arroz"],
      servingLabel: "100 g",
      gramsPerServing: 100,
      calories: 130,
      protein: 2.7,
      carbs: 28,
      fat: 0.3,
    }),
    catalogFood({
      name: "Pão de Forma Panco Premium",
      aliases: ["pão de forma Panco Premium", "panco premium"],
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
      brandName: "Panco",
      productVariant: "premium",
      calories: 127,
      protein: 4,
      carbs: 24,
      fat: 2,
    }),
    catalogFood({
      name: "Pão integral Wickbold",
      aliases: ["pão integral Wickbold", "wickbold pão integral"],
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
      brandName: "Wickbold",
      productVariant: "integral",
      calories: 124,
      protein: 5,
      carbs: 21,
      fat: 2,
    }),
    catalogFood({
      name: "Kit Kat ao leite Nestlé",
      aliases: ["Kit Kat ao leite Nestlé", "kit kat Nestlé", "kit kat"],
      servingLabel: "1 unidade",
      gramsPerServing: 41.5,
      brandName: "Nestlé",
      productVariant: "ao leite",
      calories: 220,
      protein: 3.3,
      carbs: 24,
      fat: 12,
    }),
  ];
}

function extractMealText(request: any) {
  const inputText = request?.input?.[0]?.content?.find(
    (item: any) => item?.type === "input_text"
  )?.text;
  const match =
    typeof inputText === "string"
      ? inputText.match(/Texto disponível: ([^\n]*)/u)
      : null;
  const value = match?.[1]?.trim() ?? "";
  return value === "não informado" ? "" : value;
}

function factFromContractItem(item: any): SemanticFactSnapshot {
  const nutrition = item.evidence.nutrition;
  return {
    originalText: item.originalText,
    foodName: item.commercialName,
    brand: item.brand,
    productVariant: item.productVariant,
    quantity: item.quantity,
    unit: item.unit,
    estimatedGrams: item.estimatedGrams,
    calories: nutrition.value.calories,
    protein: nutrition.value.protein,
    carbs: nutrition.value.carbs,
    fat: nutrition.value.fat,
    nutritionOrigin: nutrition.origin,
    nutritionVerified: nutrition.verified,
    sourceUrls: [...nutrition.value.sourceUrls],
  };
}

function factFromPersistedItem(item: any): SemanticFactSnapshot {
  const resolution = item.resolution ?? {};
  return {
    originalText: item.originalText ?? item.foodName,
    foodName: item.foodName,
    brand: item.brand ?? null,
    productVariant: resolution.productVariant ?? null,
    quantity: item.quantity,
    unit: item.unit,
    estimatedGrams: item.estimatedGrams,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    nutritionOrigin: resolution.nutritionOrigin ?? item.source,
    nutritionVerified:
      resolution.nutritionVerified ?? item.source === "catalog",
    sourceUrls: [...(resolution.sourceUrls ?? [])],
  };
}

function semanticFactKey(
  fact: Pick<SemanticFactSnapshot, "foodName" | "brand" | "productVariant">
) {
  return createHash("sha256")
    .update(
      [fact.foodName, fact.brand ?? "", fact.productVariant ?? ""]
        .map(normalizeForMatching)
        .join("|")
    )
    .digest("hex")
    .slice(0, 12);
}

function measureMealTextRoundTrip(facts: SemanticFactSnapshot[]) {
  const serializedLines = facts.map(fact => {
    const quantity = Number.isInteger(fact.quantity)
      ? String(fact.quantity)
      : `${Math.round(fact.quantity * 10)} / 10`;
    return `${quantity} ${fact.unit} de ${fact.foodName}`;
  });
  const serializedText = serializedLines.join("\n");
  const reconstructed = serializedLines.map(parseFoodText);
  const textRoundTripOk =
    reconstructed.length === facts.length &&
    reconstructed.every((parsed, index) => {
      const original = facts[index];
      return (
        normalizeForMatching(parsed.foodName) ===
          normalizeForMatching(original.foodName) &&
        parsed.quantity === original.quantity &&
        parsed.unit === original.unit &&
        (parsed.estimatedGrams === undefined ||
          original.estimatedGrams === undefined ||
          Math.abs(parsed.estimatedGrams - original.estimatedGrams) < 0.01)
      );
    });
  // Round-trip semântico independente: os fatos são codificados em texto
  // delimitado e reconstruídos exclusivamente a partir desse texto. O fato
  // original não é mantido em um envelope, evitando uma comparação da
  // estrutura consigo mesma que não detectaria perda de semântica.
  const semanticText = facts
    .map(fact =>
      [
        fact.originalText,
        fact.foodName,
        fact.brand ?? "",
        fact.productVariant ?? "",
        fact.quantity,
        fact.unit,
        fact.estimatedGrams,
        fact.calories,
        fact.protein,
        fact.carbs,
        fact.fat,
        fact.nutritionOrigin,
        fact.nutritionVerified ? "1" : "0",
        JSON.stringify(fact.sourceUrls),
      ]
        .map(value => encodeURIComponent(String(value)))
        .join("\t")
    )
    .join("\n");
  const reconstructedFacts = semanticText
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const fields = line.split("\t").map(value => decodeURIComponent(value));
      if (fields.length !== 14)
        throw new Error("Invalid semantic text payload");
      return {
        originalText: fields[0],
        foodName: fields[1],
        brand: fields[2] || null,
        productVariant: fields[3] || null,
        quantity: Number(fields[4]),
        unit: fields[5],
        estimatedGrams: Number(fields[6]),
        calories: Number(fields[7]),
        protein: Number(fields[8]),
        carbs: Number(fields[9]),
        fat: Number(fields[10]),
        nutritionOrigin: fields[11],
        nutritionVerified: fields[12] === "1",
        sourceUrls: JSON.parse(fields[13]) as string[],
      } satisfies SemanticFactSnapshot;
    });
  const fullSemanticRoundTripOk =
    semanticText.length > 0 &&
    reconstructedFacts.length === facts.length &&
    reconstructedFacts.every((fact, index) => {
      const expected = facts[index];
      return (
        fact.originalText === expected.originalText &&
        fact.foodName === expected.foodName &&
        fact.brand === expected.brand &&
        fact.productVariant === expected.productVariant &&
        fact.quantity === expected.quantity &&
        fact.unit === expected.unit &&
        fact.estimatedGrams === expected.estimatedGrams &&
        fact.calories === expected.calories &&
        fact.protein === expected.protein &&
        fact.carbs === expected.carbs &&
        fact.fat === expected.fat &&
        fact.nutritionOrigin === expected.nutritionOrigin &&
        fact.nutritionVerified === expected.nutritionVerified &&
        JSON.stringify(fact.sourceUrls) === JSON.stringify(expected.sourceUrls)
      );
    });
  if (textRoundTripOk) state.metrics.roundTrips += 1;
  else state.metrics.roundTripFailures += 1;
  if (fullSemanticRoundTripOk) state.metrics.fullSemanticRoundTrips += 1;
  else state.metrics.fullSemanticRoundTripFailures += 1;
  return {
    serializedText,
    reconstructed,
    roundTripOk: textRoundTripOk && fullSemanticRoundTripOk,
    fullSemanticRoundTripOk,
  };
}

function recordSemanticContract(contract: any) {
  const facts = contract.items.map(factFromContractItem);
  measureMealTextRoundTrip(facts);
  for (const fact of facts) {
    const key = semanticFactKey(fact);
    const snapshots = state.semanticSnapshots.get(key) ?? [];
    snapshots.push(fact);
    state.semanticSnapshots.set(key, snapshots);
  }
  return facts;
}

function assertPersistedFactsMatchSnapshots(meal: any) {
  for (const item of meal.items ?? []) {
    const actual = factFromPersistedItem(item);
    const snapshots = [...state.semanticSnapshots.values()].flat();
    const expected = snapshots.find(
      snapshot =>
        (normalizeForMatching(snapshot.foodName) ===
          normalizeForMatching(actual.foodName) ||
          normalizeForMatching(snapshot.foodName).includes(
            normalizeForMatching(actual.foodName)
          ) ||
          normalizeForMatching(actual.foodName).includes(
            normalizeForMatching(snapshot.foodName)
          )) &&
        snapshot.brand === actual.brand &&
        snapshot.quantity === actual.quantity &&
        snapshot.unit === actual.unit &&
        Math.abs(snapshot.estimatedGrams - actual.estimatedGrams) < 0.01
    );
    state.metrics.monotonicChecks += 1;
    expect(expected).toBeDefined();
    if (!expected) {
      state.metrics.monotonicViolations += 1;
      continue;
    }
    const fields: Array<keyof SemanticFactSnapshot> = [
      "foodName",
      "brand",
      "quantity",
      "unit",
      "estimatedGrams",
      "calories",
      "protein",
      "carbs",
      "fat",
      "nutritionOrigin",
      "nutritionVerified",
    ];
    for (const field of fields) {
      expect(actual[field]).toEqual(expected[field]);
      if (actual[field] !== expected[field])
        state.metrics.monotonicViolations += 1;
    }
    if (actual.brand) {
      expect(actual.productVariant).toEqual(expected.productVariant);
      if (actual.productVariant !== expected.productVariant)
        state.metrics.monotonicViolations += 1;
    }
    if (expected.sourceUrls.length > 0) {
      expect(actual.sourceUrls).toEqual(expected.sourceUrls);
    }
  }
}

function assertPendingWasPersistedBeforeReply() {
  const pendingIndex = state.sequence.indexOf("pending-created");
  const replyIndex = state.sequence.indexOf("reply-attempt");
  state.metrics.pendingReplyOrderChecks += 1;
  expect(pendingIndex).toBeGreaterThanOrEqual(0);
  expect(replyIndex).toBeGreaterThanOrEqual(0);
  expect(pendingIndex).toBeLessThan(replyIndex);
  if (pendingIndex < 0 || replyIndex < 0 || pendingIndex >= replyIndex) {
    state.metrics.pendingReplyOrderViolations += 1;
  }
}

function classificationFor(foodName: string) {
  if (/panco|wickbold|kit kat|nestlé/i.test(foodName)) {
    return {
      processingLevel: "ultra_processed",
      isFruit: false,
      isVegetable: false,
      fiberGrams: 0,
      isPlainWater: false,
    };
  }
  return {
    processingLevel: "processed",
    isFruit: false,
    isVegetable: false,
    fiberGrams: 0,
    isPlainWater: false,
  };
}

function buildExtraction(sourceText: string) {
  const segments = splitFoodTextSegments(sourceText).filter(Boolean);
  const items = segments.map(segment => {
    const parsed = parseFoodText(segment);
    const foodName = parsed.foodName || segment;
    const quantity = parsed.quantity ?? 1;
    const unit = parsed.unit ?? "porção";
    const estimatedGrams =
      parsed.estimatedGrams ??
      (/kit kat/i.test(foodName)
        ? 41.5
        : /panco|wickbold/i.test(foodName)
          ? 50
          : 100);
    return {
      foodName,
      brand: /panco/i.test(foodName)
        ? "Panco"
        : /wickbold/i.test(foodName)
          ? "Wickbold"
          : /nestlé|kit kat/i.test(foodName)
            ? "Nestlé"
            : null,
      quantity,
      unit,
      portionText: parsed.portionText ?? `${quantity} ${unit}`,
      servings: Math.max(estimatedGrams / 100, 0.25),
      estimatedGrams,
      estimatedCalories: /arroz/i.test(foodName)
        ? 130
        : /panco/i.test(foodName)
          ? 127
          : /wickbold/i.test(foodName)
            ? 124
            : /kit kat/i.test(foodName)
              ? 220
              : 150,
      estimatedMacros: /arroz/i.test(foodName)
        ? { protein: 2.7, carbs: 28, fat: 0.3 }
        : /panco/i.test(foodName)
          ? { protein: 4, carbs: 24, fat: 2 }
          : /wickbold/i.test(foodName)
            ? { protein: 5, carbs: 21, fat: 2 }
            : /kit kat/i.test(foodName)
              ? { protein: 3.3, carbs: 24, fat: 12 }
              : { protein: 6, carbs: 15, fat: 5 },
      confidence: 0.96,
      foodClassification: classificationFor(foodName),
    };
  });
  return {
    mealLabel: "Refeição",
    confidence: 0.96,
    reasoning:
      "Fixture determinística de boundary externo; não contém texto de entrada na evidência.",
    items,
  };
}

function providerNutritionResult(request: any) {
  const requestText = JSON.stringify(request?.input ?? "");
  const isWickbold = /wickbold/i.test(requestText);
  const isKitKat = /kit kat|kitkat|nestlé|nestle/i.test(requestText);
  const isPanco = /panco/i.test(requestText);
  const requestedProduct = isWickbold
    ? "Pão integral Wickbold"
    : isKitKat
      ? "Kit Kat ao leite Nestlé"
      : "Pão de Forma Panco Premium";
  const matchedProductName =
    state.searchMode === "variant_mismatch" && isPanco
      ? "Pão de Forma Panco Integral"
      : requestedProduct;
  const brandName = isWickbold ? "Wickbold" : isKitKat ? "Nestlé" : "Panco";
  const servingLabel = isKitKat ? "1 unidade" : "2 fatias (50 g)";
  const gramsPerServing = isKitKat ? 41.5 : 50;
  const calories = isKitKat ? 220 : isWickbold ? 124 : 127;
  const protein = isKitKat ? 3.3 : isWickbold ? 5 : 4;
  const carbs = isKitKat ? 24 : isWickbold ? 21 : 24;
  const fat = isKitKat ? 12 : 2;
  const sourceEvidence =
    state.searchMode === "grounding_missing"
      ? `${matchedProductName}: fonte sem porção ou valores nutricionais verificáveis.`
      : `Porção: ${servingLabel}. ${matchedProductName}: ${calories} kcal, ${protein} g proteínas, ${carbs} g carboidratos e ${fat} g gorduras.`;
  return {
    found: true,
    matchedProductName,
    brandName,
    servingLabel,
    gramsPerServing,
    calories,
    protein,
    carbs,
    fat,
    confidence: 0.96,
    sourceUrl: `https://provider.example/${matchedProductName.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`,
    evidence: "Resumo estruturado não usado como prova de grounding.",
    sourceEvidence,
  };
}

vi.mock("./_core/ai/configResolver", () => ({
  resolveCapabilityConfig: (capability: string) => {
    if (
      capability === "NUTRITION_SEARCH" &&
      state.searchMode === "unavailable"
    ) {
      return { ...readyPolicy(capability), state: "disabled", primary: null };
    }
    return readyPolicy(capability);
  },
}));

vi.mock("./_core/ai/capabilityExecutor", () => ({
  executeResolvedCapability: async (
    policy: { capability?: string },
    operation: (context: any) => Promise<unknown>
  ) => {
    if (policy.capability === "NUTRITION_SEARCH")
      state.metrics.nutritionSearchAttempts += 1;
    if (
      policy.capability === "NUTRITION_SEARCH" &&
      state.searchMode === "failed"
    ) {
      throw new Error();
    }
    const value = await operation({
      signal: new AbortController().signal,
      source: "primary",
      attempt: 1,
      timeoutMs: 8_000,
      provider: { id: "deterministic-boundary" },
      providerId: "openai",
      model: "gpt-4.1-mini",
    });
    return { value, source: "primary", attempts: 1, usedFallback: false };
  },
  observeUnavailableResolvedCapability: async () => undefined,
}));

vi.mock("./_core/ai/domainTextResponse", () => ({
  createDomainTextResponse: async (_provider: unknown, request: any) => {
    if (request?.format?.name === "household_measure_lookup") {
      state.metrics.householdMeasureAttempts += 1;
      const requestText = String(request?.input?.[0]?.content?.[0]?.text ?? "");
      if (/bolo/i.test(requestText)) {
        return {
          id: "household-measure-unavailable",
          outputText: JSON.stringify({ found: false, references: [] }),
          webSearch: { executed: true, sources: [] },
        };
      }
    }
    if (request?.format?.name === "branded_food_nutrition_lookup") {
      state.metrics.nutritionSearchOutbound += 1;
      const requestText = String(request?.input?.[0]?.content?.[0]?.text ?? "");
      const itemIdentity =
        requestText.match(/^Produto reconhecido: ([^\n]+)/u)?.[1] ?? "unknown";
      const itemKey = createHash("sha256")
        .update(itemIdentity)
        .digest("hex")
        .slice(0, 12);
      const current = state.metrics.nutritionSearchByItem[itemKey] ?? {
        attempts: 0,
        outbound: 0,
      };
      state.metrics.nutritionSearchByItem[itemKey] = {
        attempts: current.attempts + 1,
        outbound: current.outbound + 1,
      };
      const result = providerNutritionResult(request);
      state.nutritionSearchItems[itemKey] = itemIdentity;
      state.nutritionSearchResults[itemKey] = {
        requested: itemIdentity,
        matched: result.matchedProductName,
        sourceUrl: result.sourceUrl,
        sourceEvidence: result.sourceEvidence,
      };
      return {
        id: "provider-response-redacted",
        outputText: JSON.stringify(result),
        webSearch: {
          executed: true,
          sources: [
            {
              url: result.sourceUrl,
              title: result.matchedProductName,
              supportingText: [result.sourceEvidence],
            },
          ],
        },
      };
    }
    const hasImage = JSON.stringify(request ?? "").includes(
      '\"type\":\"input_image\"'
    );
    if (hasImage) state.visionRequestObserved = true;
    const extractionPayload = buildExtraction(
      activeVisionFixtureText || extractMealText(request)
    );
    return {
      id: "meal-response-redacted",
      outputText: JSON.stringify(extractionPayload),
    };
  },
}));

vi.mock("./catalogRuntime", () => ({
  getCatalogCache: () => state.catalog,
}));

vi.mock("./brandedNutritionPersistence", async () => {
  const actual = await vi.importActual<
    typeof import("./brandedNutritionPersistence")
  >("./brandedNutritionPersistence");
  return {
    ...actual,
    getDefaultNutritionResearchPersistence: () => ({
      findByIdentity: async () => {
        state.metrics.webNutritionCacheLookups += 1;
        return state.webNutritionCache;
      },
      save: async (_key: string, food: CatalogFood) => food,
    }),
  };
});

vi.mock("./modules/billing/service", async () => {
  const actual = await vi.importActual<
    typeof import("./modules/billing/service")
  >("./modules/billing/service");
  return {
    ...actual,
    billingService: {
      ...actual.billingService,
      getUserEntitlements: vi.fn(async () => ({
        allowed: true,
        reason: "open_access",
        sourceAvailable: true,
        evaluatedAt: new Date(),
        subscription: null,
      })),
    },
  };
});

vi.mock("./modules/whatsapp/timeZoneContext", async () => {
  const actual = await vi.importActual<
    typeof import("./modules/whatsapp/timeZoneContext")
  >("./modules/whatsapp/timeZoneContext");
  return {
    ...actual,
    resolveWhatsAppOperationTimeZone: vi.fn(async () => ({
      timeZone: "America/Sao_Paulo",
      source: "test",
    })),
  };
});

vi.mock("./modules/whatsapp/userMeasurementReplyContext", async () => {
  const actual = await vi.importActual<
    typeof import("./modules/whatsapp/userMeasurementReplyContext")
  >("./modules/whatsapp/userMeasurementReplyContext");
  return {
    ...actual,
    getWhatsAppWaterProgress: vi.fn(async () => ({
      totalMl: 0,
      goalMl: null,
      timeZone: "America/Sao_Paulo",
      dateKey: "2026-09-16",
    })),
    getWhatsAppWeightVariation: vi.fn(async () => ({
      variationKg: null,
      previousWeightKg: null,
    })),
  };
});

vi.mock("./modules/whatsapp/goalProgressService", () => ({
  getWhatsAppMealGoalProgress: vi.fn(async () => null),
}));

vi.mock("./repositories/whatsappPendingOperationRepository", async () => {
  const actual = await vi.importActual<
    typeof import("./repositories/whatsappPendingOperationRepository")
  >("./repositories/whatsappPendingOperationRepository");
  return {
    ...actual,
    createDrizzleWhatsAppPendingOperationRepository: (deps: any) =>
      actual.createDrizzleWhatsAppPendingOperationRepository({
        ...deps,
        getDb: async () => state.pendingDb,
      }),
  };
});

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    getDb: vi.fn(async () => null),
    getUserIdByWhatsappPhone: vi.fn(
      async (phone: string) => state.users.get(phone) ?? null
    ),
    getWhatsAppAccessToken: vi.fn(async () => "access-token-test"),
    getHabitSnapshots: vi.fn(async () => []),
    listUserExercises: vi.fn(async () => []),
    logInferenceEvent: vi.fn(
      (entry: { eventType?: string; detail?: string }) => {
        state.events.push({ eventType: entry.eventType, detail: entry.detail });
        actual.logInferenceEvent(entry as any);
      }
    ),
    createPendingMealInference: vi.fn((...args: any[]) => {
      state.metrics.drafts += 1;
      return actual.createPendingMealInference(...args);
    }),
    confirmPendingMeal: vi.fn(async (input: any) => {
      state.metrics.persistedMeals += 1;
      state.metrics.persistedItems += input.items?.length ?? 0;
      return actual.confirmPendingMeal(input);
    }),
    createUserWaterLog: vi.fn(async (...args: any[]) =>
      actual.createUserWaterLog(...args)
    ),
    buildSavedMedia: vi.fn((input: any) => actual.buildSavedMedia(input)),
    listUserMeals: vi.fn((...args: any[]) => actual.listUserMeals(...args)),
    updateUserMeal: vi.fn((...args: any[]) => actual.updateUserMeal(...args)),
    removeUserMeal: vi.fn((...args: any[]) => actual.removeUserMeal(...args)),
  };
});

vi.mock("./modules/meals/service", async () => {
  const actual = await vi.importActual<
    typeof import("./modules/meals/service")
  >("./modules/meals/service");
  return {
    ...actual,
    createManualMeal: vi.fn(async (...args: any[]) => {
      state.metrics.persistedMeals += 1;
      state.metrics.persistedItems += args[1]?.items?.length ?? 0;
      return actual.createManualMeal(...args);
    }),
  };
});

vi.mock("./nutritionEngine", async () => {
  const actual =
    await vi.importActual<typeof import("./nutritionEngine")>(
      "./nutritionEngine"
    );
  return {
    ...actual,
    processMealInput: vi.fn(async (input: MealProcessingInput) => {
      state.metrics.processMealInput += 1;
      const result = await actual.processMealInput(input);
      state.metrics.mealProcessingResults += 1;
      return result;
    }),
  };
});

vi.mock("./mealSemanticContract", async () => {
  const actual = await vi.importActual<typeof import("./mealSemanticContract")>(
    "./mealSemanticContract"
  );
  return {
    ...actual,
    buildMealSemanticContract: vi.fn((...args: any[]) => {
      state.metrics.semanticContracts += 1;
      const contract = actual.buildMealSemanticContract(...args);
      state.contracts.push({
        originalText: contract.originalText,
        items: recordSemanticContract(contract),
      });
      return contract;
    }),
  };
});

vi.mock("./storage", async () => {
  const { notifyWhatsAppMediaPersisted } = await vi.importActual<
    typeof import("./modules/whatsapp/mediaPersistenceCorrelation")
  >("./modules/whatsapp/mediaPersistenceCorrelation");
  return {
    storagePut: vi.fn(
      async (sourceKey: string, _data: unknown, mimeType: string) => {
        const extension = mimeType.startsWith("audio/") ? "ogg" : "jpg";
        const key = `private/media/${crypto.randomUUID()}.${extension}`;
        await notifyWhatsAppMediaPersisted(sourceKey, key, mimeType);
        return { key, url: `https://storage.test/${key}` };
      }
    ),
  };
});

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: vi.fn(async () => ({
    task: "transcribe",
    language: "pt",
    duration: 2,
    text: state.transcript,
    segments: [],
  })),
}));

vi.mock("./modules/whatsapp/annotatedImage", () => ({
  generateAnnotatedMealImage: vi.fn(async () => ({
    url: "https://storage.test/public/media/annotated.png",
    storageKey: "public/media/annotated.png",
    mimeType: "image/png",
  })),
}));

vi.mock("./modules/quickEdit/service", () => ({
  tryCreateQuickEditLinkForMeal: vi.fn(async () => null),
}));

const { createMessageLifecycleService, withMessageLifecycleService } =
  await import("./modules/whatsapp/messageLifecycle");
const { handleWhatsAppPersistentContextWebhook } = await import(
  "./whatsappPersistentContextWebhook"
);
const { resetAllMessageDeduplicationCachesForTests } = await import(
  "./modules/whatsapp/messageDeduplicationCache"
);
const { __resetWhatsAppImageIdempotencyForTests } = await import(
  "./whatsappImageIdempotencyWebhook"
);
const { __resetWhatsAppAnnotatedImageDeduplicationForTests } = await import(
  "./whatsappAnnotatedImageWebhook"
);
const { __resetWhatsAppWebhookDeduplicationForTests } = await import(
  "./whatsappWebhook"
);
const { listUserMeals } = await import("./db");

interface StoredMessage {
  id: number;
  conversationId: number;
  userId: number;
  direction: "inbound" | "outbound";
  externalMessageId: string | null;
  idempotencyKey: string;
  contentType: string;
  text: string | null;
  transcript: string | null;
  captionText: string | null;
  mediaStorageKey: string | null;
  mediaMimeType: string | null;
  respondsToMessageId: number | null;
  occurredAt: Date;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SharedLifecycleState {
  messages: StoredMessage[];
  domainLinks: Array<{ messageId: number; link: DomainLinkInput }>;
  nextMessageId: number;
}

function createLifecycleState(): SharedLifecycleState {
  if (state.lifecycleStorePath && existsSync(state.lifecycleStorePath)) {
    const stored = JSON.parse(readFileSync(state.lifecycleStorePath, "utf8"));
    return {
      messages: (stored.messages ?? []).map(reviveStoredMessage),
      domainLinks: stored.domainLinks ?? [],
      nextMessageId: stored.nextMessageId ?? 1,
    };
  }
  return { messages: [], domainLinks: [], nextMessageId: 1 };
}

function idempotencyKey(input: AppendMessageInput) {
  return input.externalMessageId
    ? `whatsapp:${input.direction}:${input.externalMessageId}`
    : `whatsapp:${input.direction}:${input.conversationId}:${input.respondsToMessageId ?? "root"}:${crypto.randomUUID()}`;
}

function createConversationRepository(
  shared: SharedLifecycleState
): WhatsAppConversationRepository {
  return {
    async createOrGetActiveConversation(
      userId,
      whatsappConnectionId,
      phoneNumber,
      now = new Date()
    ) {
      return {
        id: userId,
        userId,
        whatsappConnectionId,
        phoneNumber,
        status: "active",
        startedAt: now,
        lastActivityAt: now,
        endedAt: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      } as never;
    },
    async appendMessage(input) {
      const key = idempotencyKey(input);
      const existing = shared.messages.find(
        message => message.idempotencyKey === key
      );
      if (existing) return { message: existing as never, wasNewInsert: false };
      const now = new Date();
      const message: StoredMessage = {
        id: shared.nextMessageId++,
        conversationId: input.conversationId,
        userId: input.userId,
        direction: input.direction,
        externalMessageId: input.externalMessageId ?? null,
        idempotencyKey: key,
        contentType: input.contentType,
        text: input.text ?? null,
        transcript: input.transcript ?? null,
        captionText: input.captionText ?? null,
        mediaStorageKey: input.mediaStorageKey ?? null,
        mediaMimeType: input.mediaMimeType ?? null,
        respondsToMessageId: input.respondsToMessageId ?? null,
        occurredAt: input.occurredAt,
        processedAt: input.processedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      shared.messages.push(message);
      persistLifecycleState(shared);
      return { message: message as never, wasNewInsert: true };
    },
    async findByIdempotencyKey(key) {
      return (
        (shared.messages.find(
          message => message.idempotencyKey === key
        ) as never) ?? null
      );
    },
    async linkResponse() {},
    async linkDomainRecord(messageId, link) {
      shared.domainLinks.push({ messageId, link });
      state.metrics.domainLinks += 1;
      persistLifecycleState(shared);
    },
    async findRecentMessages(conversationId, limit = 20) {
      return shared.messages
        .filter(message => message.conversationId === conversationId)
        .slice(-limit) as never;
    },
    async findRecentMessagesByUser(userId, limit = 20) {
      return shared.messages
        .filter(message => message.userId === userId)
        .slice(-limit) as never;
    },
    async findMessagesBefore(
      conversationId,
      beforeOccurredAt,
      beforeId,
      limit = 20
    ) {
      return shared.messages
        .filter(
          message =>
            message.conversationId === conversationId &&
            (message.occurredAt < beforeOccurredAt || message.id < beforeId)
        )
        .slice(-limit) as never;
    },
    async findDomainLinksForMessage(messageId) {
      return shared.domainLinks
        .filter(entry => entry.messageId === messageId)
        .map((entry, index) => ({
          id: index + 1,
          messageId,
          ...entry.link,
        })) as never;
    },
    async markProcessed(messageId, processedAt = new Date()) {
      const message = shared.messages.find(
        candidate => candidate.id === messageId
      );
      if (message) {
        message.processedAt = processedAt;
        message.updatedAt = processedAt;
        persistLifecycleState(shared);
      }
    },
    async insertConversationSummary() {},
    async findLatestConversationSummary() {
      return null;
    },
    async purgeExpiredRawText() {
      return 0;
    },
    async purgeExpiredSanitizedText() {
      return 0;
    },
    async purgeExpiredAuditRows() {
      return 0;
    },
  };
}

function createEnrichmentRepository(
  shared: SharedLifecycleState
): WhatsAppConversationMessageEnrichmentRepository {
  return {
    async enrichInboundMessageByExternalId(externalMessageId, input) {
      const message = shared.messages.find(
        candidate =>
          candidate.direction === "inbound" &&
          candidate.externalMessageId === externalMessageId
      );
      if (!message) return false;
      if (input.transcript) message.transcript = input.transcript;
      if (input.mediaStorageKey)
        message.mediaStorageKey = input.mediaStorageKey;
      if (input.mediaMimeType) message.mediaMimeType = input.mediaMimeType;
      message.updatedAt = new Date();
      persistLifecycleState(shared);
      return true;
    },
  };
}

function createClaimRepository(
  shared: SharedLifecycleState
): WhatsAppProcessingClaimRepository {
  return {
    async claimUnprocessedMessage(
      messageId,
      ownerToken,
      staleBefore,
      claimedAt = new Date()
    ) {
      const message = shared.messages.find(
        candidate => candidate.id === messageId
      );
      if (!message) return { state: "unavailable" };
      if (message.processedAt) return { state: "processed" };
      const current = state.claims.get(messageId);
      if (!current || current.heartbeatAt < staleBefore) {
        state.claims.set(messageId, { ownerToken, heartbeatAt: claimedAt });
        return {
          state: current ? "recovered" : "claimed",
          ownerToken,
          heartbeatAt: claimedAt,
        };
      }
      return { state: "inflight", heartbeatAt: current.heartbeatAt };
    },
    async heartbeatOwnedUnprocessedMessage(
      messageId,
      ownerToken,
      heartbeatAt = new Date()
    ) {
      const message = shared.messages.find(
        candidate => candidate.id === messageId
      );
      const current = state.claims.get(messageId);
      if (!message || message.processedAt || current?.ownerToken !== ownerToken)
        return false;
      state.claims.set(messageId, { ownerToken, heartbeatAt });
      return true;
    },
    async releaseOwnedUnprocessedMessage(messageId, ownerToken) {
      const current = state.claims.get(messageId);
      if (current?.ownerToken !== ownerToken) return false;
      state.claims.delete(messageId);
      return true;
    },
    async completeOwnedMessageClaim(messageId, ownerToken) {
      const current = state.claims.get(messageId);
      if (current?.ownerToken !== ownerToken) return false;
      state.claims.delete(messageId);
      return true;
    },
  };
}

function createRuntime(shared: SharedLifecycleState) {
  return createMessageLifecycleService({
    conversationRepository: createConversationRepository(shared),
    enrichmentRepository: createEnrichmentRepository(shared),
    processingClaimRepository: createClaimRepository(shared),
    processingHeartbeatIntervalMs: 1000,
  });
}

function payload(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business-account-id",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5511000000000",
                phone_number_id: CHANNEL_PHONE_NUMBER_ID,
              },
              messages: [{ from: TEST_PHONE, ...message }],
            },
          },
        ],
      },
    ],
  };
}

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test HTTP server did not expose a port.");
  return {
    server,
    url: `http://127.0.0.1:${address.port}/api/whatsapp/webhook`,
  };
}

async function close(server: Server) {
  await new Promise<void>(resolve => server.close(() => resolve()));
}

async function post(url: string, body: unknown) {
  const response = await nativeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
}

function resetCaches() {
  resetAllMessageDeduplicationCachesForTests();
  __resetWhatsAppImageIdempotencyForTests();
  __resetWhatsAppAnnotatedImageDeduplicationForTests();
  __resetWhatsAppWebhookDeduplicationForTests();
}

function configureScenario(input: {
  catalog?: CatalogFood[];
  searchMode?: typeof state.searchMode;
  transcript?: string;
  pendingCreateFailure?: boolean;
  sendReplyFailure?: boolean;
  visionFoodText?: string | null;
  pendingStorePath?: string;
  webNutritionCache?: CatalogFood | null;
}) {
  state.catalog = input.catalog ?? defaultCatalog();
  state.searchMode = input.searchMode ?? "accepted";
  state.transcript = input.transcript ?? "100 g de arroz branco";
  state.webNutritionCache = input.webNutritionCache ?? null;
  state.pendingCreateFailure = input.pendingCreateFailure ?? false;
  state.sendReplyFailure = input.sendReplyFailure ?? false;
  state.visionFoodText = input.visionFoodText ?? null;
  activeVisionFixtureText = input.visionFoodText ?? null;
  state.pendingStorePath = input.pendingStorePath ?? null;
  state.lifecycleStorePath = input.pendingStorePath
    ? join(dirname(input.pendingStorePath), "lifecycle.json")
    : null;
  state.pendingDb = createProductionPendingDb();
}

function assertOpaqueSearchKeys(expectedItems: RegExp[]) {
  const keys = Object.keys(state.nutritionSearchItems);
  expect(keys).toHaveLength(expectedItems.length);
  expect(keys).toEqual(Object.keys(state.metrics.nutritionSearchByItem));
  expect(keys.every(key => /^[0-9a-f]{12}$/u.test(key))).toBe(true);
  const requestedItems = Object.values(state.nutritionSearchItems);
  for (const expectedItem of expectedItems) {
    expect(requestedItems.some(item => expectedItem.test(item))).toBe(true);
  }
}

function eventEvidenceOnly() {
  return state.events.map(event => ({
    eventType: event.eventType,
    detail: event.detail,
  }));
}

function assertSanitizedEvidence(shared: SharedLifecycleState) {
  const allowedEventTypes = new Set([
    "nutrition.search_decision",
    "meal.inference_fallback",
    "whatsapp.meal_intent_decision.registration_details_requested",
    "whatsapp.meal_intent_decision.registration_details_unavailable",
    "whatsapp.meal_intent_decision.registered",
    "whatsapp.idempotency.processed_duplicate",
    "whatsapp.processing_error",
    "whatsapp.reply_failed",
    "whatsapp.food_clarification.requested",
    "whatsapp.food_clarification.persistence_unavailable",
    "whatsapp.message_processed",
    "whatsapp.interactive_callback.unavailable",
  ]);
  for (const event of state.events) {
    expect(allowedEventTypes).toContain(event.eventType);
    expect(event.detail ?? "").not.toMatch(
      /https?:\/\/|Error(?::|\s+at\b)|stack|outputText|provider-response|sourceEvidence|prompt|query|input_text|5511999999999/u
    );
  }
  const evidence = JSON.stringify({
    baselineDevelopSha: BASELINE_DEVELOP_SHA,
    characterizationDevelopSha: CHARACTERIZATION_DEVELOP_SHA,
    metrics: state.metrics,
    events: eventEvidenceOnly(),
    inbound: shared.messages
      .filter(message => message.direction === "inbound")
      .map(message => ({
        contentType: message.contentType,
        mediaStorageKey: message.mediaStorageKey ? "opaque" : null,
        mediaMimeType: message.mediaMimeType,
        hasTranscript: Boolean(message.transcript),
      })),
  });
  expect(evidence).not.toContain(TEST_PHONE);
  expect(evidence).not.toMatch(/https?:\/\//u);
  expect(evidence).not.toMatch(
    /Panco|Wickbold|Nestlé|arroz|query|prompt|provider-response|sourceEvidence|evidência bruta|meta transport failure|pending persistence failure|provider failure/iu
  );
}

function assertPersistedOriginalText(meal: any) {
  const expectedOriginalTexts = activeLifecycle.messages
    .filter(message => message.direction === "inbound")
    .flatMap(message => [message.text, message.captionText, message.transcript])
    .filter((value): value is string => Boolean(value))
    .concat(
      [...state.pendingRows.values(), ...readPendingRows()]
        .map(row => row.target?.originalText)
        .filter((value): value is string => Boolean(value))
    );
  if (expectedOriginalTexts.length === 0) return;
  expect(expectedOriginalTexts).toContain(meal.notes);
}

const scenarioDefinitions = [
  {
    id: "01-panco-premium",
    title: "Panco Premium com relação física verificável",
    expectedResult: "registered",
  },
  {
    id: "02-wickbold-equivalente",
    title: "Produto equivalente de outra marca",
    expectedResult: "registered",
  },
  {
    id: "03-commercial-non-bread",
    title: "Produto comercial não-pão com unidade",
    expectedResult: "registered",
  },
  {
    id: "04-generic-canonical-portion",
    title: "Alimento genérico com porção canônica",
    expectedResult: "registered",
  },
  {
    id: "05-explicit-mass",
    title: "Massa explícita",
    expectedResult: "registered",
  },
  {
    id: "06-variant-incompatible",
    title: "Variante divergente fail-closed",
    expectedResult: "clarification",
  },
  {
    id: "07-grounding-insufficient",
    title: "Grounding insuficiente/conflictante fail-closed",
    expectedResult: "clarification",
  },
  {
    id: "08-search-failure",
    title: "NUTRITION_SEARCH indisponível/falhando",
    expectedResult: "clarification",
  },
  {
    id: "08-search-unavailable",
    title: "NUTRITION_SEARCH sem configuração disponível",
    expectedResult: "clarification",
  },
  {
    id: "09-empty-cache",
    title: "Cache web_nutrition vazio",
    expectedResult: "registered",
  },
  {
    id: "10-incompatible-cache",
    title: "Cache incompatível presente",
    expectedResult: "registered",
  },
  {
    id: "11-multi-item-atomic",
    title: "Refeição multi-item atômica",
    expectedResult: "registered",
  },
  {
    id: "12-mixed-partial",
    title: "Lote misto com pendência quantitativa",
    expectedResult: "registered",
  },
  {
    id: "13-audio-convergent",
    title: "Áudio/transcrição convergente",
    expectedResult: "registered",
  },
  {
    id: "14-image-convergent",
    title: "Imagem convergente",
    expectedResult: "registered",
  },
  {
    id: "15-durable-partial-idempotency",
    title: "Idempotência de lote parcial após reinicialização do runtime",
    expectedResult: "registered",
  },
] as const;

type EvidenceRow = {
  scenarioId: string;
  result: "ready" | "clarification" | "registered";
  metrics: ReturnType<typeof makeEmptyMetrics>;
};

function makeEmptyMetrics() {
  return {
    roundTripFailures: 0,
    fullSemanticRoundTrips: 0,
    fullSemanticRoundTripFailures: 0,
    monotonicChecks: 0,
    monotonicViolations: 0,
    pendingReplyOrderChecks: 0,
    pendingReplyOrderViolations: 0,
    processMealInput: 0,
    mealProcessingResults: 0,
    nutritionSearchAttempts: 0,
    nutritionSearchOutbound: 0,
    webNutritionCacheLookups: 0,
    nutritionSearchByItem: {} as Record<
      string,
      { attempts: number; outbound: number }
    >,
    householdMeasureAttempts: 0,
    roundTrips: 0,
    semanticContracts: 0,
    drafts: 0,
    persistedMeals: 0,
    persistedItems: 0,
    pendingCreated: 0,
    pendingClaimed: 0,
    pendingConsumed: 0,
    domainLinks: 0,
  };
}

const evidenceRows: EvidenceRow[] = [];
let activeServer: Server | null = null;
let activeUrl = "";
let activeLifecycle: SharedLifecycleState;
let nextUserId = 9_400_000;

function installNetworkBoundary() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/messages")) {
      state.outboundReplies.push(url);
      state.sequence.push("reply-attempt");
      if (state.sendReplyFailure) {
        return new Response(null, {
          status: 503,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(
        JSON.stringify({
          messages: [{ id: `wamid-out-${crypto.randomUUID()}` }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }
    if (url.includes("graph.facebook.com") && !url.includes("/messages")) {
      const isAudio = /audio/u.test(url);
      return new Response(
        JSON.stringify({
          url: `https://media.test/download/${isAudio ? "audio" : "image"}`,
          mime_type: isAudio ? "audio/ogg" : "image/jpeg",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }
    if (url.startsWith("https://media.test/")) {
      return new Response(Buffer.from("deterministic-media"), {
        status: 200,
        headers: {
          "content-type": /audio/u.test(url) ? "audio/ogg" : "image/jpeg",
        },
      });
    }
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

async function startScenario(input: {
  catalog?: CatalogFood[];
  searchMode?: typeof state.searchMode;
  transcript?: string;
  pendingCreateFailure?: boolean;
  sendReplyFailure?: boolean;
  visionFoodText?: string | null;
  pendingStorePath?: string;
  lifecycleStorePath?: string;
}) {
  cleanupPendingStore();
  state.reset();
  configureScenario(input);
  resetCaches();
  installNetworkBoundary();
  const userId = nextUserId++;
  state.users.set(TEST_PHONE, userId);
  activeLifecycle = createLifecycleState();
  const app = express();
  registerWhatsAppPublicPostRoute(app, {
    runtimeBootId: "test-issue-1094",
    webhookRateLimit: createExpressRateLimit(RATE_LIMITS.whatsappWebhook),
    handle: (req, res) =>
      withMessageLifecycleService(createRuntime(activeLifecycle), () =>
        handleWhatsAppPersistentContextWebhook(req as never, res as never)
      ),
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (!res.headersSent) res.status(500).json({ ok: false });
      void error;
    }
  );
  const listening = await listen(app);
  activeServer = listening.server;
  activeUrl = listening.url;
  return userId;
}

async function restartScenarioRuntime() {
  if (activeServer) await close(activeServer);
  resetCaches();
  state.pendingRows.clear();
  state.claims.clear();
  state.nextPendingId = 1;
  activeLifecycle = createLifecycleState();
  const app = express();
  registerWhatsAppPublicPostRoute(app, {
    runtimeBootId: "test-issue-1094-restarted",
    webhookRateLimit: createExpressRateLimit(RATE_LIMITS.whatsappWebhook),
    handle: (req, res) =>
      withMessageLifecycleService(createRuntime(activeLifecycle), () =>
        handleWhatsAppPersistentContextWebhook(req as never, res as never)
      ),
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (!res.headersSent) res.status(500).json({ ok: false });
      void error;
    }
  );
  const listening = await listen(app);
  activeServer = listening.server;
  activeUrl = listening.url;
}

async function finishScenario(
  scenarioId: string,
  result: EvidenceRow["result"]
) {
  const definition = scenarioDefinitions.find(
    scenario => scenario.id === scenarioId
  );
  expect(definition).toBeDefined();
  expect(result).toBe(definition?.expectedResult);
  if (result === "registered") {
    const meals = await listUserMeals(nextUserId - 1);
    for (const meal of meals) {
      assertPersistedOriginalText(meal);
      assertPersistedFactsMatchSnapshots(meal);
    }
  }
  if (state.metrics.pendingCreated > 0) {
    assertPendingWasPersistedBeforeReply();
  }
  assertSanitizedEvidence(activeLifecycle);
  evidenceRows.push({ scenarioId, result, metrics: { ...state.metrics } });
  if (activeServer) await close(activeServer);
  activeServer = null;
  activeUrl = "";
}

beforeAll(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
  process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
  process.env.WHATSAPP_PHONE_NUMBER_ID = CHANNEL_PHONE_NUMBER_ID;
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
  process.env.QUICK_EDIT_BASE_URL = "https://app.example.com";
});

afterEach(async () => {
  if (activeServer) await close(activeServer);
  activeServer = null;
  activeUrl = "";
  cleanupPendingStore();
});

afterAll(() => {
  expect(evidenceRows).toHaveLength(scenarioDefinitions.length);
  expect(evidenceRows.map(row => row.scenarioId)).toEqual(
    scenarioDefinitions.map(scenario => scenario.id)
  );
  const contractRows = evidenceRows.filter(
    row => row.metrics.semanticContracts > 0
  );
  expect(contractRows.length).toBeGreaterThan(0);
  expect(contractRows.every(row => row.metrics.roundTrips > 0)).toBe(true);
  expect(contractRows.every(row => row.metrics.roundTripFailures === 0)).toBe(
    true
  );
  expect(
    contractRows.every(row => row.metrics.fullSemanticRoundTrips > 0)
  ).toBe(true);
  expect(
    contractRows.every(row => row.metrics.fullSemanticRoundTripFailures === 0)
  ).toBe(true);
  expect(evidenceRows.every(row => row.metrics.monotonicViolations === 0)).toBe(
    true
  );
  expect(
    evidenceRows.every(row => row.metrics.pendingReplyOrderViolations === 0)
  ).toBe(true);
  const evidence = {
    schemaVersion: 1,
    issue: 1094,
    baselineDevelopSha: BASELINE_DEVELOP_SHA,
    metricsBaselineDevelopSha: METRICS_BASELINE_DEVELOP_SHA,
    characterizationDevelopSha: CHARACTERIZATION_DEVELOP_SHA,
    f0_07Revalidation: F0_07_REVALIDATION,
    entrypoint: "POST /api/whatsapp/webhook",
    scenarios: evidenceRows,
  };
  console.info("[issue-1094-evidence]", JSON.stringify(evidence));
});

describe("Issue #1094 — golden flows iniciados no POST público do WhatsApp", () => {
  it("01 — registra uma fatia de pão de forma Panco Premium sem perder marca, variante ou medida", async () => {
    await startScenario({});
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-01",
        timestamp: "1789556400",
        type: "text",
        text: { body: "1 fatia de pão de forma Panco Premium" },
      })
    );
    const meals = await listUserMeals(nextUserId - 1);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-whatsapp-processing-outcome")).toBe(
      "meal_registered"
    );
    expect(meals).toHaveLength(1);
    expect(meals[0].items[0]).toEqual(
      expect.objectContaining({
        brand: "Panco",
        estimatedGrams: 25,
        unit: "fatia",
        quantity: 1,
        portionText: "1 fatia",
      })
    );
    expect(meals[0].items[0].resolution).toEqual(
      expect.objectContaining({
        productVariant: "premium",
        nutritionVerified: true,
        nutritionOrigin: "web_research",
        sourceUrls: expect.any(Array),
        measureResolution: expect.objectContaining({
          requestedQuantity: 1,
          requestedUnit: "fatia",
          grams: 25,
          verified: true,
        }),
      })
    );
    expect(state.contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalText: "1 fatia de pão de forma Panco Premium",
          items: expect.arrayContaining([
            expect.objectContaining({
              originalText: "1 fatia de pão de forma Panco Premium",
              quantity: 1,
              unit: "fatia",
              estimatedGrams: 25,
            }),
          ]),
        }),
      ])
    );
    await finishScenario("01-panco-premium", "registered");
  });

  it("02 — mantém o mesmo contrato para Wickbold sem hardcode na marca Panco", async () => {
    await startScenario({});
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-02",
        timestamp: "1789556460",
        type: "text",
        text: { body: "1 fatia de pão integral Wickbold" },
      })
    );
    const meals = await listUserMeals(nextUserId - 1);
    expect(response.status).toBe(200);
    expect(meals).toHaveLength(1);
    expect(meals[0].items[0]).toEqual(
      expect.objectContaining({
        brand: "Wickbold",
        estimatedGrams: 25,
        unit: "fatia",
        quantity: 1,
        portionText: "1 fatia",
      })
    );
    expect(meals[0].items[0].resolution).toEqual(
      expect.objectContaining({
        productVariant: "integral",
        nutritionVerified: true,
        nutritionOrigin: "web_research",
        sourceUrls: expect.any(Array),
      })
    );
    expect(meals[0].items[0].resolution).toEqual(
      expect.objectContaining({
        nutritionOrigin: "web_research",
        nutritionVerified: true,
        sourceUrls: [expect.stringMatching(/p-o-integral-wickbold/u)],
        sourceEvidence: expect.stringContaining("Pão integral Wickbold"),
      })
    );
    await finishScenario("02-wickbold-equivalente", "registered");
  });

  it("03 — resolve produto comercial não-pão por unidade", async () => {
    await startScenario({});
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-03",
        timestamp: "1789556520",
        type: "text",
        text: { body: "1 unidade de Kit Kat ao leite Nestlé" },
      })
    );
    const meals = await listUserMeals(nextUserId - 1);
    expect(response.status).toBe(200);
    expect(meals).toHaveLength(1);
    expect(meals[0].items[0]).toEqual(
      expect.objectContaining({
        brand: "Nestlé",
        estimatedGrams: 41.5,
        unit: "un",
        quantity: 1,
        portionText: "1 un",
      })
    );
    expect(meals[0].items[0].resolution.measureResolution).toEqual(
      expect.objectContaining({
        requestedUnit: "unidade",
        verified: true,
        sourceUrls: [expect.stringMatching(/kit-kat-ao-leite-nestl/u)],
        sourceEvidence: expect.stringContaining("Kit Kat ao leite Nestlé"),
      })
    );
    await finishScenario("03-commercial-non-bread", "registered");
  });

  it("04 — preserva alimento genérico e porção canônica", async () => {
    await startScenario({});
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-04",
        timestamp: "1789556580",
        type: "text",
        text: { body: "100 g de arroz branco" },
      })
    );
    const meals = await listUserMeals(nextUserId - 1);
    expect(response.status).toBe(200);
    expect(meals).toHaveLength(1);
    expect(meals[0].items[0]).toEqual(
      expect.objectContaining({
        brand: null,
        estimatedGrams: 100,
        unit: "g",
        quantity: 100,
        portionText: "100 g",
      })
    );
    await finishScenario("04-generic-canonical-portion", "registered");
  });

  it("05 — preserva massa explicitamente informada sem inventar medida contável", async () => {
    await startScenario({});
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-05",
        timestamp: "1789556640",
        type: "text",
        text: { body: "120 g de massa cozida" },
      })
    );
    const meals = await listUserMeals(nextUserId - 1);
    expect(response.status).toBe(200);
    expect(meals).toHaveLength(1);
    expect(meals[0].items[0]).toEqual(
      expect.objectContaining({
        estimatedGrams: 120,
        unit: "g",
        quantity: 120,
        portionText: "120 g",
      })
    );
    await finishScenario("05-explicit-mass", "registered");
  });

  it("06 — bloqueia variante divergente antes de qualquer persistência", async () => {
    await startScenario({ catalog: [], searchMode: "variant_mismatch" });
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-06",
        timestamp: "1789556700",
        type: "text",
        text: { body: "1 fatia de pão de forma Panco Premium" },
      })
    );
    expect(response.status).toBe(200);
    expect(state.metrics.nutritionSearchOutbound).toBe(1);
    expect(state.metrics.persistedMeals).toBe(0);
    expect(state.metrics.pendingCreated).toBe(1);
    await finishScenario("06-variant-incompatible", "clarification");
  });

  it("07 — mantém grounding insuficiente em fail-closed", async () => {
    await startScenario({ catalog: [], searchMode: "grounding_missing" });
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-07",
        timestamp: "1789556760",
        type: "text",
        text: { body: "1 fatia de pão de forma Panco Premium" },
      })
    );
    expect(response.status).toBe(200);
    expect(state.metrics.nutritionSearchOutbound).toBe(1);
    expect(state.metrics.persistedMeals).toBe(0);
    expect(state.metrics.pendingCreated).toBe(1);
    await finishScenario("07-grounding-insufficient", "clarification");
  });

  it("08 — falha de NUTRITION_SEARCH sem fallback genérico ou mutação parcial", async () => {
    await startScenario({
      catalog: [],
      searchMode: "failed",
      sendReplyFailure: true,
    });
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-08",
        timestamp: "1789556820",
        type: "text",
        text: { body: "1 fatia de pão de forma Panco Premium" },
      })
    );
    expect(response.status).toBe(200);
    expect(state.metrics.nutritionSearchAttempts).toBe(1);
    expect(state.metrics.nutritionSearchOutbound).toBe(0);
    expect(state.outboundReplies).toHaveLength(1);
    expect(state.metrics.persistedMeals).toBe(0);
    expect(state.metrics.pendingCreated).toBe(1);
    const replyFailure = state.events.find(
      event => event.eventType === "whatsapp.reply_failed"
    );
    expect(replyFailure?.detail).toBe(
      "Falha ao enviar resposta lógica para o contato WhatsApp."
    );
    expect(replyFailure?.detail).not.toContain(TEST_PHONE);
    await finishScenario("08-search-failure", "clarification");
  });

  it("08b — configuração indisponível de NUTRITION_SEARCH permanece fail-closed", async () => {
    await startScenario({
      catalog: [],
      searchMode: "unavailable",
    });
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-08b",
        timestamp: "1789556850",
        type: "text",
        text: { body: "1 fatia de pão de forma Panco Premium" },
      })
    );
    expect(response.status).toBe(200);
    expect(state.metrics.nutritionSearchAttempts).toBe(0);
    expect(state.metrics.nutritionSearchOutbound).toBe(0);
    expect(state.metrics.persistedMeals).toBe(0);
    expect(state.metrics.pendingCreated).toBe(1);
    await finishScenario("08-search-unavailable", "clarification");
  });

  it("09 — pesquisa uma única vez com cache web_nutrition vazio e persiste a proveniência", async () => {
    await startScenario({ catalog: [], searchMode: "accepted" });
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-09",
        timestamp: "1789556880",
        type: "text",
        text: { body: "1 fatia de pão de forma Panco Premium" },
      })
    );
    const meals = await listUserMeals(nextUserId - 1);
    expect(response.status).toBe(200);
    expect(state.metrics.nutritionSearchAttempts).toBe(1);
    expect(state.metrics.nutritionSearchOutbound).toBe(1);
    expect(meals).toHaveLength(1);
    expect(meals[0].items[0].resolution).toEqual(
      expect.objectContaining({
        nutritionOrigin: "web_research",
        nutritionVerified: true,
        sourceUrls: expect.any(Array),
        sourceEvidence: expect.any(String),
        measureResolution: expect.objectContaining({
          requestedQuantity: 1,
          requestedUnit: "fatia",
          grams: 25,
          verified: true,
        }),
      })
    );
    expect(Object.values(state.metrics.nutritionSearchByItem)).toEqual([
      { attempts: 1, outbound: 1 },
    ]);
    expect(Object.values(state.nutritionSearchResults)).toEqual([
      expect.objectContaining({
        requested: expect.stringMatching(/Panco Premium/u),
        matched: "Pão de Forma Panco Premium",
        sourceUrl: expect.stringMatching(/p-o-de-forma-panco-premium/u),
        sourceEvidence: expect.stringContaining("Pão de Forma Panco Premium"),
      }),
    ]);
    assertOpaqueSearchKeys([/Panco Premium/u]);
    const outboundBeforeRetry = state.outboundReplies.length;
    resetCaches();
    const duplicate = await post(
      activeUrl,
      payload({
        id: "wamid-1094-09",
        timestamp: "1789556880",
        type: "text",
        text: { body: "1 fatia de pão de forma Panco Premium" },
      })
    );
    expect(duplicate.status).toBe(200);
    expect(duplicate.headers.get("x-whatsapp-processing-outcome")).toBe(
      "duplicate_ignored"
    );
    expect(await listUserMeals(nextUserId - 1)).toHaveLength(1);
    expect(state.metrics.nutritionSearchAttempts).toBe(1);
    expect(state.metrics.nutritionSearchOutbound).toBe(1);
    expect(state.metrics.pendingCreated).toBe(0);
    expect(state.outboundReplies).toHaveLength(outboundBeforeRetry);
    await finishScenario("09-empty-cache", "registered");
  });

  it("10 — não aceita cache incompatível e usa uma única busca específica", async () => {
    const incompatible = catalogFood({
      name: "Pão de Forma Panco Integral",
      aliases: ["pão de forma Panco Integral"],
      servingLabel: "2 fatias (50 g)",
      gramsPerServing: 50,
      brandName: "Panco",
      productVariant: "integral",
      calories: 120,
      protein: 4,
      carbs: 22,
      fat: 2,
    });
    await startScenario({
      catalog: [],
      searchMode: "accepted",
      webNutritionCache: incompatible,
    });
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-10",
        timestamp: "1789556940",
        type: "text",
        text: { body: "1 fatia de pão de forma Panco Premium" },
      })
    );
    const meals = await listUserMeals(nextUserId - 1);
    expect(response.status).toBe(200);
    expect(state.metrics.nutritionSearchAttempts).toBe(1);
    expect(state.metrics.nutritionSearchOutbound).toBe(1);
    expect(state.metrics.webNutritionCacheLookups).toBe(1);
    expect(meals).toHaveLength(1);
    expect(meals[0].items[0]).toEqual(
      expect.objectContaining({
        brand: "Panco",
        estimatedGrams: 25,
        quantity: 1,
        unit: "fatia",
        portionText: "1 fatia",
      })
    );
    expect(meals[0].items[0].resolution).toEqual(
      expect.objectContaining({
        productVariant: "premium",
        nutritionOrigin: "web_research",
        nutritionVerified: true,
        sourceUrls: expect.any(Array),
      })
    );
    expect(Object.values(state.metrics.nutritionSearchByItem)).toEqual([
      { attempts: 1, outbound: 1 },
    ]);
    expect(Object.values(state.nutritionSearchResults)).toEqual([
      expect.objectContaining({
        requested: expect.stringMatching(/Panco Premium/u),
        matched: "Pão de Forma Panco Premium",
        sourceUrl: expect.stringMatching(/p-o-de-forma-panco-premium/u),
        sourceEvidence: expect.stringContaining("Pão de Forma Panco Premium"),
      }),
    ]);
    assertOpaqueSearchKeys([/Panco Premium/u]);
    await finishScenario("10-incompatible-cache", "registered");
  });

  it("11 — processa refeição multi-item atomicamente sem persistir irmãos antes da resolução", async () => {
    await startScenario({ catalog: defaultCatalog().slice(0, 1) });
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-11",
        timestamp: "1789557000",
        type: "text",
        text: {
          body: "100 g de arroz branco, 1 fatia de pão de forma Panco Premium, 1 fatia de pão integral Wickbold",
        },
      })
    );
    const meals = await listUserMeals(nextUserId - 1);
    expect(response.status).toBe(200);
    expect(meals).toHaveLength(1);
    expect(meals[0].items).toHaveLength(3);
    expect(meals[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          foodName: expect.stringMatching(/arroz/i),
          estimatedGrams: 100,
          unit: "g",
        }),
        expect.objectContaining({
          brand: "Panco",
          estimatedGrams: 25,
          unit: "fatia",
        }),
        expect.objectContaining({
          brand: "Wickbold",
          estimatedGrams: 25,
          unit: "fatia",
        }),
      ])
    );
    expect(state.metrics.nutritionSearchAttempts).toBe(2);
    expect(state.metrics.nutritionSearchOutbound).toBe(2);
    expect(Object.values(state.metrics.nutritionSearchByItem)).toEqual([
      { attempts: 1, outbound: 1 },
      { attempts: 1, outbound: 1 },
    ]);
    expect(Object.values(state.nutritionSearchResults)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requested: expect.stringMatching(/Panco Premium/u),
          matched: "Pão de Forma Panco Premium",
          sourceUrl: expect.stringMatching(/p-o-de-forma-panco-premium/u),
        }),
        expect.objectContaining({
          requested: expect.stringMatching(/Wickbold/u),
          matched: "Pão integral Wickbold",
          sourceUrl: expect.stringMatching(/p-o-integral-wickbold/u),
        }),
      ])
    );
    expect(state.metrics.persistedMeals).toBe(1);
    expect(state.metrics.persistedItems).toBe(3);
    assertOpaqueSearchKeys([/Panco Premium/u, /Wickbold/u]);
    await finishScenario("11-multi-item-atomic", "registered");
  });

	  it("12 — registra irmãos válidos e explica somente a pendência quantitativa", async () => {
    await startScenario({
      catalog: defaultCatalog().filter(
        food => food.name !== "Pão de Forma Panco Premium"
      ),
    });
    const inputText =
      "100 g de arroz branco cozido, 2 pedaços de bolo, 1 fatia de pão de forma Panco Premium";
    const initial = await post(
      activeUrl,
      payload({
        id: "wamid-1094-12-a",
        timestamp: "1789557060",
        type: "text",
        text: { body: inputText },
      })
    );
    expect(initial.status).toBe(200);
    expect(state.metrics.householdMeasureAttempts).toBe(1);
    expect(state.metrics.nutritionSearchAttempts).toBe(2);
    expect(state.metrics.nutritionSearchOutbound).toBe(1);
    expect(state.metrics.pendingCreated).toBe(0);
    expect(state.metrics.persistedMeals).toBe(1);
    expect(state.pendingRows.size).toBe(0);
    expect(Object.values(state.metrics.nutritionSearchByItem)).toEqual([
      { attempts: 1, outbound: 1 },
    ]);
    assertOpaqueSearchKeys([/Panco Premium/u]);
    const meals = await listUserMeals(nextUserId - 1);
    expect(meals).toHaveLength(1);
    expect(meals[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ foodName: expect.stringMatching(/arroz/i) }),
        expect.objectContaining({ brand: "Panco", estimatedGrams: 25 }),
      ])
    );
    expect(meals[0].items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ foodName: expect.stringMatching(/bolo/i) }),
      ])
    );
    expect(
      activeLifecycle.messages.some(
        message =>
          message.direction === "outbound" &&
          /Não registrei estes itens/i.test(message.text ?? "") &&
          /bolo/i.test(message.text ?? "")
      )
    ).toBe(true);

    const outboundBeforeInitialRetry = state.outboundReplies.length;
    resetCaches();
    const initialRetry = await post(
      activeUrl,
      payload({
        id: "wamid-1094-12-a",
        timestamp: "1789557060",
        type: "text",
        text: { body: inputText },
      })
    );
    expect(initialRetry.status).toBe(200);
    expect(state.metrics.householdMeasureAttempts).toBe(1);
    expect(state.metrics.pendingCreated).toBe(0);
    expect(state.metrics.persistedMeals).toBe(1);
    expect(state.metrics.nutritionSearchAttempts).toBe(2);
    expect(state.metrics.nutritionSearchOutbound).toBe(1);
    expect(state.outboundReplies).toHaveLength(outboundBeforeInitialRetry);

    const incompatible = await post(
      activeUrl,
      payload({
        id: "wamid-1094-12-b",
        timestamp: "1789557120",
        type: "interactive",
        interactive: { button_reply: { id: "not-a-real-callback" } },
      })
    );
    expect(incompatible.status).toBe(200);
    expect(state.metrics.pendingConsumed).toBe(0);
    expect(state.metrics.persistedMeals).toBe(1);
    expect(state.pendingRows.size).toBe(0);
    expect(await listUserMeals(nextUserId - 1)).toHaveLength(1);
    await finishScenario("12-mixed-partial", "registered");
  });

  it("13 — converge áudio/transcrição no mesmo contrato alimentar sem duplicar inbound", async () => {
    await startScenario({ transcript: "100 g de arroz branco" });
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-13",
        timestamp: "1789557240",
        type: "audio",
        audio: { id: "audio-1094-13", mime_type: "audio/ogg" },
      })
    );
    const meals = await listUserMeals(nextUserId - 1);
    const inbound = activeLifecycle.messages.filter(
      message => message.direction === "inbound"
    );
    expect(response.status).toBe(200);
    expect(meals).toHaveLength(1);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toEqual(
      expect.objectContaining({
        contentType: "audio",
        transcript: "100 g de arroz branco",
        mediaMimeType: "audio/ogg",
      })
    );
    expect(inbound[0].mediaStorageKey).toMatch(/^private\/media\//u);
    expect(meals[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          foodName: expect.stringMatching(/arroz/i),
          estimatedGrams: 100,
          quantity: 100,
          unit: "g",
          portionText: "100 g",
          brand: null,
        }),
      ])
    );
    await finishScenario("13-audio-convergent", "registered");
  });

  it("14 — converge imagem comercial pela mesma fronteira de identidade/resolução e mantém mídia opaca", async () => {
    await startScenario({
      catalog: [],
      visionFoodText: "2 fatias de pão de forma Panco Premium",
    });
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-14",
        timestamp: "1789557300",
        type: "image",
        image: {
          id: "image-1094-14",
          mime_type: "image/jpeg",
          caption: "2 fatias de pão de forma Panco Premium",
        },
      })
    );
    const meals = await listUserMeals(nextUserId - 1);
    const inbound = activeLifecycle.messages.filter(
      message => message.direction === "inbound"
    );
    expect(response.status).toBe(200);
    expect(meals).toHaveLength(1);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toEqual(
      expect.objectContaining({
        contentType: "image",
        captionText: "2 fatias de pão de forma Panco Premium",
        mediaMimeType: "image/jpeg",
      })
    );
    expect(state.visionRequestObserved).toBe(true);
    expect(state.metrics.nutritionSearchAttempts).toBe(1);
    expect(state.metrics.nutritionSearchOutbound).toBe(1);
    expect(Object.values(state.metrics.nutritionSearchByItem)).toEqual([
      { attempts: 1, outbound: 1 },
    ]);
    expect(inbound[0].mediaStorageKey).toMatch(/^private\/media\//u);
    expect(state.metrics.persistedMeals).toBe(1);
    expect(meals[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          foodName: expect.stringMatching(/pão de forma panco premium/i),
          estimatedGrams: 50,
          quantity: 2,
          unit: "fatia",
          portionText: "2 fatia",
          brand: "Panco",
        }),
      ])
    );
    await finishScenario("14-image-convergent", "registered");
  });

		  it("15 — mantém idempotência do lote parcial depois de reiniciar o runtime", async () => {
    const pendingStorePath = join(
      mkdtempSync(join(tmpdir(), "issue-1094-pending-")),
      "pending.json"
    );
    const inputText =
      "100 g de arroz branco cozido, 2 pedaços de bolo, 1 fatia de pão de forma Panco Premium";
    await startScenario({
      catalog: defaultCatalog().filter(
        food => food.name !== "Pão de Forma Panco Premium"
      ),
      pendingStorePath,
    });
    const initialLifecycle = activeLifecycle;
    const initial = await post(
      activeUrl,
      payload({
        id: "wamid-1094-15-a",
        timestamp: "1789557360",
        type: "text",
        text: { body: inputText },
      })
    );
    expect(initial.status).toBe(200);
    expect(state.metrics.householdMeasureAttempts).toBe(1);
    expect(state.metrics.pendingCreated).toBe(0);
    expect(state.metrics.persistedMeals).toBe(1);
    expect(state.pendingRows.size).toBe(0);
    expect(readPendingRows()).toHaveLength(0);
    expect(await listUserMeals(nextUserId - 1)).toHaveLength(1);

    await restartScenarioRuntime();
    expect(activeLifecycle).not.toBe(initialLifecycle);
    expect(state.pendingRows.size).toBe(0);
    expect(readPendingRows()).toHaveLength(0);
    const outboundBeforeDurableRetry = state.outboundReplies.length;
    const pendingCreatedBeforeDurableRetry = state.metrics.pendingCreated;
    const persistedMealsBeforeDurableRetry = state.metrics.persistedMeals;
    const searchAttemptsBeforeDurableRetry =
      state.metrics.nutritionSearchAttempts;
    const durableRetry = await post(
      activeUrl,
      payload({
        id: "wamid-1094-15-a",
        timestamp: "1789557360",
        type: "text",
        text: { body: inputText },
      })
    );
    expect(durableRetry.status).toBe(200);
    expect(state.outboundReplies).toHaveLength(outboundBeforeDurableRetry);
    expect(state.metrics.pendingCreated).toBe(pendingCreatedBeforeDurableRetry);
    expect(state.metrics.persistedMeals).toBe(persistedMealsBeforeDurableRetry);
    expect(state.metrics.nutritionSearchAttempts).toBe(
      searchAttemptsBeforeDurableRetry
    );
    expect(readPendingRows()).toHaveLength(0);
    expect(
      activeLifecycle.messages.filter(
        message => message.direction === "inbound"
      )
    ).toHaveLength(1);
    expect(state.metrics.pendingConsumed).toBe(0);
    expect(await listUserMeals(nextUserId - 1)).toHaveLength(1);
    await finishScenario("15-durable-partial-idempotency", "registered");
  });

  it("controle — falha ao persistir clarificação não emite pergunta órfã nem mutação parcial", async () => {
    await startScenario({
      catalog: [],
      searchMode: "failed",
      pendingCreateFailure: true,
    });
    const response = await post(
      activeUrl,
      payload({
        id: "wamid-1094-persistence-failure",
        timestamp: "1789557360",
        type: "text",
        text: { body: "1 fatia de pão de forma Panco Premium" },
      })
    );
    expect(response.status).toBe(200);
    expect(state.pendingRows.size).toBe(0);
    expect(state.metrics.pendingCreated).toBe(0);
    expect(state.metrics.persistedMeals).toBe(0);
    expect(state.outboundReplies).toHaveLength(1);
    expect(
      state.events.some(event => event.eventType === "whatsapp.reply_failed")
    ).toBe(false);
    assertSanitizedEvidence(activeLifecycle);
    if (activeServer) await close(activeServer);
    activeServer = null;
    activeUrl = "";
  });
});
