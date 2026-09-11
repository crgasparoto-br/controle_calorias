import { splitFoodTextSegments } from "../../mealTextParsing";
import {
  COUNTABLE_QUANTITY_PATTERN,
  UNIT_WORDS,
  parseCountableQuantity,
} from "./quantityUnitVocabulary";

const UNIT_PATTERN = Object.values(UNIT_WORDS).join("|");
const LEADING_PORTION_PATTERN = new RegExp(
  `^(${COUNTABLE_QUANTITY_PATTERN})\\s*(${UNIT_PATTERN})(?:\\s+de)?(?:\\s+(.+))?$`,
  "iu",
);
const IDENTITY_STOP_WORDS = new Set(["de", "do", "da", "dos", "das"]);

type ParsedPortionIdentity = {
  quantity: number;
  unit: string;
  identity: string | null;
  prefix: string;
};

export type IdentityReplyAnalysis =
  | { kind: "compatible"; identityDetails: string }
  | { kind: "quantity_conflict" }
  | { kind: "invalid" }
  | { kind: "incompatible" };

function normalizeIdentity(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUnit(value: string) {
  const normalized = normalizeIdentity(value);
  for (const [key, pattern] of Object.entries(UNIT_WORDS)) {
    if (new RegExp(`^(?:${pattern})$`, "iu").test(value.trim())) return key;
    if (new RegExp(`^(?:${pattern})$`, "iu").test(normalized)) return key;
  }
  return normalized;
}

function parsePortionIdentity(text: string): ParsedPortionIdentity | null {
  const raw = text.trim();
  const match = raw.match(LEADING_PORTION_PATTERN);
  if (!match) return null;
  const quantity = parseCountableQuantity(match[1]);
  if (!quantity) return null;
  const identity = match[3]?.trim() || null;
  const prefix = identity
    ? raw.slice(0, raw.length - identity.length).trimEnd()
    : raw;
  return {
    quantity,
    unit: normalizeUnit(match[2]),
    identity,
    prefix,
  };
}

function identityTerms(value: string) {
  return normalizeIdentity(value)
    .split(" ")
    .filter(Boolean)
    .filter((term) => !IDENTITY_STOP_WORDS.has(term));
}

function isCompatibleIdentityExtension(baseIdentity: string, candidate: string) {
  const baseTerms = identityTerms(baseIdentity);
  const candidateTerms = new Set(identityTerms(candidate));
  return baseTerms.length > 0 && baseTerms.every((term) => candidateTerms.has(term));
}

export function analyzeRegistrationDetailsIdentityReply(input: {
  text?: string | null;
  baseIdentity: string;
  expectedQuantity?: number | null;
  expectedUnit?: string | null;
  isCompleteCommand: boolean;
}): IdentityReplyAnalysis {
  const raw = input.text?.trim() ?? "";
  if (!raw || splitFoodTextSegments(raw).length !== 1) return { kind: "invalid" };

  const portion = parsePortionIdentity(raw);
  const identityDetails = portion?.identity ?? raw;

  // A complete command for another food must remain able to supersede the
  // pending identity clarification even when it also carries quantity/unit.
  // Only after proving identity compatibility should quantity changes be
  // interpreted as conflicts with the current pending item.
  if (
    input.isCompleteCommand &&
    portion?.identity &&
    !isCompatibleIdentityExtension(input.baseIdentity, identityDetails)
  ) {
    return { kind: "incompatible" };
  }

  if (portion) {
    if (!portion.identity) return { kind: "quantity_conflict" };
    if (
      input.expectedQuantity == null ||
      !input.expectedUnit ||
      portion.quantity !== input.expectedQuantity ||
      portion.unit !== normalizeUnit(input.expectedUnit)
    ) {
      return { kind: "quantity_conflict" };
    }
  }

  if (
    input.isCompleteCommand &&
    !isCompatibleIdentityExtension(input.baseIdentity, identityDetails)
  ) {
    return { kind: "incompatible" };
  }

  return { kind: "compatible", identityDetails };
}

export function parsePendingIdentityContext(input: {
  segment?: string | null;
  fallbackIdentity?: string | null;
  fallbackQuantity?: number | null;
  fallbackUnit?: string | null;
}) {
  const parsed = input.segment ? parsePortionIdentity(input.segment) : null;
  return {
    baseIdentity:
      parsed?.identity?.trim() || input.fallbackIdentity?.trim() || input.segment?.trim() || "",
    expectedQuantity: parsed?.quantity ?? input.fallbackQuantity ?? null,
    expectedUnit: parsed?.unit ?? (input.fallbackUnit ? normalizeUnit(input.fallbackUnit) : null),
  };
}

export function mergePendingIdentity(baseIdentity: string, details: string) {
  const incoming = parsePortionIdentity(details.trim());
  const identityDetails = incoming?.identity ?? details.trim();
  if (!identityDetails) return baseIdentity.trim();

  const baseTokens = new Set(
    normalizeIdentity(baseIdentity).split(" ").filter(Boolean),
  );
  const additions = identityDetails
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const normalized = normalizeIdentity(token);
      return Boolean(normalized) && !baseTokens.has(normalized);
    });
  return [baseIdentity.trim(), ...additions].filter(Boolean).join(" ").trim();
}

export function mergePendingCountableSegment(segment: string, details: string) {
  const parsed = parsePortionIdentity(segment);
  if (!parsed?.identity) return mergePendingIdentity(segment, details);
  return `${parsed.prefix} ${mergePendingIdentity(parsed.identity, details)}`.trim();
}
