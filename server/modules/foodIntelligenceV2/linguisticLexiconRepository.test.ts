import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  foodLexiconEntries,
  userFoodLexiconEntries,
} from "../../../drizzle/food-intelligence-v2-schema";
import { getDb } from "../../db";
import { readGovernedLinguisticLexicon } from "./linguisticLexiconRepository";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

type LexiconRow = typeof foodLexiconEntries.$inferSelect;
type PersonalLexiconRow = typeof userFoodLexiconEntries.$inferSelect;
const now = new Date("2026-11-01T12:00:00.000Z");

function row(override: Partial<LexiconRow> = {}): LexiconRow {
  return {
    id: 1,
    term: "ovos",
    normalizedTerm: "ovos",
    kind: "alias_surface",
    targetType: "canonical_term",
    targetRef: "ovo",
    scope: "global",
    locale: "pt-BR",
    sourceId: null,
    evidenceId: null,
    confidence: 0.9,
    requiresClarification: 0,
    status: "verified",
    currentSlot: 1,
    supersedesId: null,
    validFrom: null,
    validTo: null,
    createdAt: now,
    updatedAt: now,
    ...override,
  };
}

function personalRow(
  override: Partial<PersonalLexiconRow> = {}
): PersonalLexiconRow {
  return {
    id: 10,
    userId: 5,
    term: "ovos",
    normalizedTerm: "ovos",
    kind: "alias_surface",
    targetType: "canonical_term",
    targetRef: "ovo",
    locale: "pt-BR",
    source: "user_confirmed",
    confidence: 0.9,
    status: "active",
    currentSlot: 1,
    confirmedAt: now,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...override,
  };
}

function databaseWith(
  globalRows: LexiconRow[],
  personalRows: PersonalLexiconRow[] = []
) {
  const results: unknown[][] = [globalRows, personalRows];
  const select = vi.fn(() => {
    const query: any = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.limit.mockImplementation(async () => results.shift() ?? []);
    return query;
  });
  return { select };
}

async function read(
  globalRows: LexiconRow[],
  ownerUserId: number | null = null,
  personalRows: PersonalLexiconRow[] = []
) {
  vi.mocked(getDb).mockResolvedValue(
    databaseWith(globalRows, personalRows) as never
  );
  return readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId, now });
}

describe("readGovernedLinguisticLexicon validity window", () => {
  beforeEach(() => vi.mocked(getDb).mockReset());

  it.each([
    ["validFrom", { validFrom: new Date("invalid") }],
    ["validTo", { validTo: new Date("invalid") }],
  ] as const)(
    "omits an entry with invalid %s before hashing its revision",
    async (_field, dates) => {
      const result = await read([row(dates)]);

      expect(result.entries).toEqual([]);
      expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
    }
  );

  it.each([
    ["null bounds", { validFrom: null, validTo: null }],
    [
      "inclusive current start and future end",
      {
        validFrom: now,
        validTo: new Date(now.getTime() + 1),
      },
    ],
  ] as const)("retains an active entry with %s", async (_case, dates) => {
    const result = await read([row(dates)]);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe(1);
  });

  it.each([
    [
      "a future start",
      { validFrom: new Date(now.getTime() + 1), validTo: null },
    ],
    ["an end exactly at now", { validFrom: null, validTo: now }],
  ] as const)("omits an inactive entry with %s", async (_case, dates) => {
    const result = await read([row(dates)]);

    expect(result.entries).toEqual([]);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it("omits a personal row with invalid confirmedAt before hashing its revision", async () => {
    const result = await read([], 5, [
      personalRow({ confirmedAt: new Date("invalid") }),
    ]);

    expect(result.entries).toEqual([]);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["confirmedAt at now", now, 1],
    ["confirmedAt in the future", new Date(now.getTime() + 1), 0],
  ] as const)(
    "applies the validity boundary to %s",
    async (_case, confirmedAt, expectedEntries) => {
      const result = await read([], 5, [personalRow({ confirmedAt })]);

      expect(result.entries).toHaveLength(expectedEntries);
    }
  );
});
