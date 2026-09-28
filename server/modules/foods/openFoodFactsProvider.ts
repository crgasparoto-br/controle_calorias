import { createHash } from "node:crypto";

export type OpenFoodFactsLookupStatus =
  | "disabled"
  | "invalid_barcode"
  | "found"
  | "incomplete"
  | "not_found"
  | "rate_limited"
  | "unavailable";

export type OpenFoodFactsCandidate = {
  kind: "external_product_candidate";
  provider: "open_food_facts";
  providerVersion: "api-v2";
  barcode: string;
  product: {
    name: string | null;
    brand: string | null;
    variant: string | null;
    quantity: string | null;
    quantityUnit: string | null;
  };
  nutritionPer100g: {
    caloriesKcal: number | null;
    proteinGrams: number | null;
    carbsGrams: number | null;
    fatGrams: number | null;
    fiberGrams: number | null;
    sugarGrams: number | null;
    sodiumMg: number | null;
  };
  serving: {
    label: string | null;
    quantity: number | null;
    unit: string | null;
  };
  provenance: {
    provider: "open_food_facts";
    providerVersion: "api-v2";
    queriedBarcode: string;
    fetchedAt: string;
    sourceUrl: string;
    attribution: "Contains data from Open Food Facts, available under the Open Database License";
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/";
    imagePolicy: "not imported; image rights are not presumed";
    productModifiedAt: number | null;
    fieldAvailability: Record<string, boolean>;
  };
};

export type OpenFoodFactsLookupResult = {
  status: OpenFoodFactsLookupStatus;
  barcode: string;
  candidate: OpenFoodFactsCandidate | null;
  attempts: number;
  cached: boolean;
  message: string;
};

type FetchLike = typeof fetch;
type CacheEntry = { expiresAt: number; result: OpenFoodFactsLookupResult };

const cache = new Map<string, CacheEntry>();
const DEFAULT_BASE_URL = "https://world.openfoodfacts.org/api/v2";
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 4_000;
const MAX_ATTEMPTS = 2;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isOpenFoodFactsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.OPEN_FOOD_FACTS_ENABLED?.trim().toLowerCase() === "true";
}

export function normalizeOpenFoodFactsBarcode(value: string) {
  const barcode = value.trim();
  return /^[0-9]{8,14}$/.test(barcode) ? barcode : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sourceUrl(barcode: string, baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/product/${encodeURIComponent(barcode)}`;
}

function candidateFromProduct(
  barcode: string,
  product: Record<string, unknown>,
  fetchedAt: string,
  baseUrl: string
): OpenFoodFactsCandidate {
  const nutriments =
    product.nutriments && typeof product.nutriments === "object"
      ? (product.nutriments as Record<string, unknown>)
      : {};
  const value = (key: string) => numberOrNull(nutriments[`${key}_100g`]);
  const name =
    stringOrNull(product.product_name_pt) ?? stringOrNull(product.product_name);
  const brand = stringOrNull(product.brands);
  const variant = stringOrNull(product.generic_name);
  const quantity = stringOrNull(product.quantity);
  const quantityUnit = stringOrNull(product.product_quantity_unit);
  const servingQuantity = numberOrNull(product.serving_quantity);
  const servingUnit = stringOrNull(product.serving_quantity_unit);
  const servingLabel = stringOrNull(product.serving_size);
  const source = sourceUrl(barcode, baseUrl);
  const availability = {
    name: Boolean(name),
    brand: Boolean(brand),
    barcode: true,
    caloriesKcal: value("energy-kcal") != null,
    proteinGrams: value("proteins") != null,
    carbsGrams: value("carbohydrates") != null,
    fatGrams: value("fat") != null,
    fiberGrams: value("fiber") != null,
    sugarGrams: value("sugars") != null,
    sodiumMg: value("sodium") != null,
    serving: Boolean(servingQuantity && servingUnit),
  };
  return {
    kind: "external_product_candidate",
    provider: "open_food_facts",
    providerVersion: "api-v2",
    barcode,
    product: { name, brand, variant, quantity, quantityUnit },
    nutritionPer100g: {
      caloriesKcal: value("energy-kcal"),
      proteinGrams: value("proteins"),
      carbsGrams: value("carbohydrates"),
      fatGrams: value("fat"),
      fiberGrams: value("fiber"),
      sugarGrams: value("sugars"),
      sodiumMg: value("sodium"),
    },
    serving: {
      label: servingLabel,
      quantity: servingQuantity,
      unit: servingUnit,
    },
    provenance: {
      provider: "open_food_facts",
      providerVersion: "api-v2",
      queriedBarcode: barcode,
      fetchedAt,
      sourceUrl: source,
      attribution:
        "Contains data from Open Food Facts, available under the Open Database License",
      licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      imagePolicy: "not imported; image rights are not presumed",
      productModifiedAt: numberOrNull(product.last_modified_t),
      fieldAvailability: availability,
    },
  };
}

function incomplete(candidate: OpenFoodFactsCandidate) {
  const nutrition = candidate.nutritionPer100g;
  return (
    !candidate.product.name ||
    nutrition.caloriesKcal == null ||
    nutrition.proteinGrams == null ||
    nutrition.carbsGrams == null ||
    nutrition.fatGrams == null
  );
}

function disabledResult(barcode: string): OpenFoodFactsLookupResult {
  return {
    status: "disabled",
    barcode,
    candidate: null,
    attempts: 0,
    cached: false,
    message: "Consulta externa desativada; o catálogo local continua disponível.",
  };
}

export function clearOpenFoodFactsCacheForTests() {
  cache.clear();
}

export async function lookupOpenFoodFactsProduct(input: {
  barcode: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onMetric?: (event: {
    provider: "open_food_facts";
    status: OpenFoodFactsLookupStatus;
    attempts: number;
    durationMs: number;
  }) => void;
}): Promise<OpenFoodFactsLookupResult> {
  const normalizedBarcode = normalizeOpenFoodFactsBarcode(input.barcode);
  if (!normalizedBarcode) {
    return {
      status: "invalid_barcode",
      barcode: input.barcode.trim(),
      candidate: null,
      attempts: 0,
      cached: false,
      message: "Informe um código de barras numérico com 8 a 14 dígitos.",
    };
  }
  if (!isOpenFoodFactsEnabled(input.env)) return disabledResult(normalizedBarcode);
  const baseUrl = input.env?.OPEN_FOOD_FACTS_API_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const cacheKey = `${baseUrl.replace(/\/$/, "")}:${normalizedBarcode}`;
  const now = input.now ?? Date.now;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now()) {
    return { ...cached.result, cached: true };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const userAgent =
    input.env?.OPEN_FOOD_FACTS_USER_AGENT?.trim() ||
    "ControleCalorias/1.0 (server-side barcode lookup)";
  const startedAt = now();
  let attempts = 0;
  let lastStatus: number | null = null;
  let sawRateLimit = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(
        `${sourceUrl(normalizedBarcode, baseUrl)}?fields=code,product_name,product_name_pt,generic_name,brands,quantity,product_quantity_unit,serving_size,serving_quantity,serving_quantity_unit,nutriments,categories,last_modified_t`,
        {
          method: "GET",
          headers: { Accept: "application/json", "User-Agent": userAgent },
          signal: controller.signal,
        }
      );
      lastStatus = response.status;
      sawRateLimit ||= response.status === 429;
      if (response.status === 404) {
        const result: OpenFoodFactsLookupResult = {
          status: "not_found",
          barcode: normalizedBarcode,
          candidate: null,
          attempts,
          cached: false,
          message: "Produto não encontrado no Open Food Facts.",
        };
        cache.set(cacheKey, {
          expiresAt: now() + CACHE_TTL_MS,
          result,
        });
        input.onMetric?.({ provider: "open_food_facts", status: result.status, attempts, durationMs: now() - startedAt });
        return result;
      }
      if (response.ok) {
        const body = (await response.json()) as {
          status?: number;
          product?: Record<string, unknown>;
        };
        if (body.status !== 1 || !body.product) {
          const result: OpenFoodFactsLookupResult = {
            status: "not_found",
            barcode: normalizedBarcode,
            candidate: null,
            attempts,
            cached: false,
            message: "Produto não encontrado no Open Food Facts.",
          };
          cache.set(cacheKey, {
            expiresAt: now() + CACHE_TTL_MS,
            result,
          });
          input.onMetric?.({ provider: "open_food_facts", status: result.status, attempts, durationMs: now() - startedAt });
          return result;
        }
        const candidate = candidateFromProduct(
          normalizedBarcode,
          body.product,
          new Date(now()).toISOString(),
          baseUrl
        );
        const result: OpenFoodFactsLookupResult = {
          status: incomplete(candidate) ? "incomplete" : "found",
          barcode: normalizedBarcode,
          candidate,
          attempts,
          cached: false,
          message: incomplete(candidate)
            ? "Produto encontrado, mas faltam campos nutricionais obrigatórios; revisão manual necessária."
            : "Produto encontrado como candidato externo; publicação manual continua obrigatória.",
        };
        cache.set(cacheKey, { expiresAt: now() + CACHE_TTL_MS, result });
        input.onMetric?.({ provider: "open_food_facts", status: result.status, attempts, durationMs: now() - startedAt });
        return result;
      }
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) break;
      await (input.sleep ?? (async (ms: number) => new Promise(resolve => setTimeout(resolve, ms))))(attempt * 250);
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        const result: OpenFoodFactsLookupResult = {
          status: "unavailable",
          barcode: normalizedBarcode,
          candidate: null,
          attempts,
          cached: false,
          message:
            error instanceof DOMException && error.name === "AbortError"
              ? "Open Food Facts excedeu o timeout; tente novamente ou use o catálogo local."
              : "Open Food Facts está indisponível; tente novamente ou use o catálogo local.",
        };
        input.onMetric?.({ provider: "open_food_facts", status: result.status, attempts, durationMs: now() - startedAt });
        return result;
      }
      await (input.sleep ?? (async (ms: number) => new Promise(resolve => setTimeout(resolve, ms))))(attempt * 250);
    } finally {
      clearTimeout(timer);
    }
  }
  const result: OpenFoodFactsLookupResult = {
    status: sawRateLimit || lastStatus === 429 ? "rate_limited" : "unavailable",
    barcode: normalizedBarcode,
    candidate: null,
    attempts,
    cached: false,
    message:
      sawRateLimit || lastStatus === 429
        ? "Open Food Facts limitou a consulta; tente novamente mais tarde."
        : "Open Food Facts não respondeu de forma disponível; o catálogo local não foi alterado.",
  };
  input.onMetric?.({ provider: "open_food_facts", status: result.status, attempts, durationMs: now() - startedAt });
  return result;
}

export function openFoodFactsCandidateFingerprint(candidate: OpenFoodFactsCandidate) {
  return createHash("sha256")
    .update(JSON.stringify(candidate))
    .digest("hex");
}
