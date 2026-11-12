import { and, eq, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  foodLexiconEntries,
  userFoodLexiconEntries,
} from "../../../drizzle/food-intelligence-v2-schema";
import { foodSources } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { governedLinguisticLexiconStore, readGovernedLinguisticLexicon } from "./linguisticLexiconRepository";
import type { FoodSourceGrant } from "./sourceGrants";

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


/**
 * Execute fixture queries against the actual compiled Drizzle predicates.
 * A deleted userId, status, source or locale condition makes rows leak into
 * the result instead of being hidden by the mock itself.
 * Only equality predicates used by this repository are modeled.
 */
function databaseRespectingPredicates(
  globalRows: LexiconRow[],
  personalRows: PersonalLexiconRow[] = [],
  external?: { id: number; version: string; grant: FoodSourceGrant },
) {
  const dialect = new MySqlDialect();
  const queries: Array<{ table: string; sql: string; params: unknown[] }> = [];
  const select = vi.fn(() => {
    let table: unknown;
    let condition: SQL | undefined;
    const query: any = {
      from: vi.fn((value: unknown) => { table = value; return query; }),
      innerJoin: vi.fn(() => query),
      where: vi.fn((value: SQL) => { condition = value; return query; }),
      limit: vi.fn(async () => {
        if (!condition) throw new Error("missing lexicon where predicate");
        const compiled = dialect.sqlToQuery(condition);
        const columns = [...compiled.sql.matchAll(/\x60([a-z_]+)\x60\s*=\s*\?/g)]
          .map(match => match[1]);
        if (columns.length !== compiled.params.length) {
          throw new Error("fixture cannot evaluate lexicon query: " + compiled.sql);
        }
        const filters = new Map(columns.map((column, index) => [column, compiled.params[index]]));
        const matches = (column: string, value: unknown) =>
          !filters.has(column) || filters.get(column) === value;
        if (table === foodLexiconEntries) {
          queries.push({ table: "global", ...compiled });
          return globalRows.filter(item =>
            matches("locale", item.locale) &&
            matches("current_slot", item.currentSlot) &&
            matches("status", item.status));
        }
        if (table === userFoodLexiconEntries) {
          queries.push({ table: "personal", ...compiled });
          return personalRows.filter(item =>
            matches("user_id", item.userId) &&
            matches("locale", item.locale) &&
            matches("current_slot", item.currentSlot) &&
            matches("status", item.status) &&
            matches("source", item.source));
        }
        if (table === foodSources) {
          queries.push({ table: "source", ...compiled });
          return external && matches("id", external.id)
            ? [{ source: { version: external.version }, grant: external.grant }]
            : [];
        }
        throw new Error("unexpected lexicon query table");
      }),
    };
    return query;
  });
  return { select, queries };
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

  it("isolates SQL results by owner and rejects revoked, unconfirmed and wrong-locale rows", async () => {
    const db = databaseRespectingPredicates([], [
      personalRow({ id: 21, userId: 5, targetRef: "café sem açúcar" }),
      personalRow({ id: 22, userId: 7, targetRef: "café com açúcar" }),
      personalRow({ id: 23, userId: 5, source: "imported" }),
      personalRow({ id: 24, userId: 5, status: "revoked", currentSlot: null, revokedAt: now }),
      personalRow({ id: 25, userId: 5, revokedAt: now }),
      personalRow({ id: 26, userId: 5, locale: "en-US" }),
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const forFive = await readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId: 5, now });
    const forSeven = await readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId: 7, now });
    const globalOnly = await readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId: null, now });

    expect(forFive.entries.map(item => item.id)).toEqual([21]);
    expect(forSeven.entries.map(item => item.id)).toEqual([22]);
    expect(globalOnly.entries).toEqual([]);
    expect(db.queries.filter(query => query.table === "personal")).toHaveLength(2);
    expect(db.queries.filter(query => query.table === "personal").every(query =>
      query.sql.includes("user_id") && query.params.some(value => value === 5 || value === 7)
    )).toBe(true);

    // Negative control: remove just the owner predicate; the same fixture leaks both owners.
    const unscopedRows = await db.select().from(userFoodLexiconEntries).where(and(
      eq(userFoodLexiconEntries.locale, "pt-BR"),
      eq(userFoodLexiconEntries.currentSlot, 1),
      eq(userFoodLexiconEntries.status, "active"),
      eq(userFoodLexiconEntries.source, "user_confirmed"),
    )).limit(5001);
    expect(unscopedRows.map((item: PersonalLexiconRow) => item.userId).sort()).toEqual([5, 7]);
  });

  it("binds even identical global-only snapshots to the requesting owner", async () => {
    const db = databaseRespectingPredicates([row()]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const ownerFive = await readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId: 5, now });
    const ownerSeven = await readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId: 7, now });
    expect(ownerFive.entries).toEqual(ownerSeven.entries);
    expect(ownerFive.revision).not.toBe(ownerSeven.revision);
    await expect(governedLinguisticLexiconStore.load({
      locale: "pt-BR", ownerUserId: 7, now, revision: ownerFive.revision,
    })).rejects.toThrow("stale-governed-lexicon-revision");
  });

  it("invalidates the pinned snapshot after personal revocation and allows only its new revision", async () => {
    const personalRows = [personalRow({ id: 31, userId: 5 })];
    const db = databaseRespectingPredicates([row()], personalRows);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const before = await readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId: 5, now });
    expect(before.entries.map(item => item.id)).toEqual([1, 31]);
    await expect(governedLinguisticLexiconStore.load({
      locale: "pt-BR", ownerUserId: 5, now, revision: before.revision,
    })).resolves.toEqual(before.entries);

    personalRows[0] = { ...personalRows[0], status: "revoked", currentSlot: null, revokedAt: now };
    const after = await readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId: 5, now });
    expect(after.entries.map(item => item.id)).toEqual([1]);
    expect(after.revision).not.toBe(before.revision);
    await expect(governedLinguisticLexiconStore.load({
      locale: "pt-BR", ownerUserId: 5, now, revision: before.revision,
    })).rejects.toThrow("stale-governed-lexicon-revision");
    await expect(governedLinguisticLexiconStore.load({
      locale: "pt-BR", ownerUserId: 5, now, revision: after.revision,
    })).resolves.toEqual(after.entries);
  });

  it("revisions change with source version and revoked grants remove global authority", async () => {
    const source: { id: number; version: string; grant: FoodSourceGrant } = {
      id: 77,
      version: "v1",
      grant: {
        sourceVersion: "v1", status: "approved", allowRead: 1,
        allowPersistEvidence: 0, allowGlobalPublication: 1,
        licenseReference: "license", approvalReference: "approval",
        approvedAt: new Date(now.getTime() - 1), validUntil: null,
        revokedAt: null, retentionDays: null,
      },
    };
    const db = databaseRespectingPredicates([row({ id: 41, sourceId: 77 })], [], source);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const first = await readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId: null, now });
    expect(first.entries.map(item => item.id)).toEqual([41]);
    source.version = "v2";
    source.grant = { ...source.grant, sourceVersion: "v2" };
    const updated = await readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId: null, now });
    expect(updated.entries).toEqual(first.entries);
    expect(updated.revision).not.toBe(first.revision);

    source.grant = { ...source.grant, status: "revoked", revokedAt: now };
    const revoked = await readGovernedLinguisticLexicon({ locale: "pt-BR", ownerUserId: null, now });
    expect(revoked.entries).toEqual([]);
    expect(revoked.revision).not.toBe(updated.revision);
    await expect(governedLinguisticLexiconStore.load({
      locale: "pt-BR", ownerUserId: null, now, revision: updated.revision,
    })).rejects.toThrow("stale-governed-lexicon-revision");
    // Negative control: the row stays verified; only the source authorization changed.
    expect(db.queries.some(query => query.table === "source" && query.params.includes(77))).toBe(true);
  });

  it.each([
    ["invalid Date", new Date("invalid")],
    ["non-Date timestamp", "2026-11-01T12:00:00Z" as unknown as Date],
  ] as const)("rejects %s before querying the database", async (_case, invalidNow) => {
    await expect(readGovernedLinguisticLexicon({
      locale: "pt-BR", ownerUserId: 5, now: invalidNow,
    })).rejects.toThrow("invalid-lexicon-scope");
    expect(getDb).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid owner %s before querying the database",
    async invalidOwner => {
      await expect(readGovernedLinguisticLexicon({
        locale: "pt-BR", ownerUserId: invalidOwner, now,
      })).rejects.toThrow("invalid-lexicon-scope");
      expect(getDb).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["textual validFrom", { validFrom: "2026-11-01" as unknown as Date }],
    ["undefined validTo", { validTo: undefined as unknown as Date }],
  ] as const)("does not silently accept a malformed %s bound", async (_case, dates) => {
    const result = await read([row(dates)]);
    expect(result.entries).toEqual([]);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  });
});
