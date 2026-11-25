import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { foodEvidence, userFoodAliases } from "../../../drizzle/food-intelligence-v2-schema";
import { getDb } from "../../db";
import { buildFoodObservationFixture } from "./fixtures";
import {
  createPersonalAliasRevocation, personalAliasConfirmationSubject, personalAliasRevision,
} from "./personalAliasRevocation";
import { createFoodV2KnowledgeRepository } from "./repository";
import { resolveFoodObservation } from "./resolver";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

type Dependencies = Parameters<typeof createPersonalAliasRevocation>[0];
const sample = { aliasId: 1, variantId: 2, aliasRevision: "a".repeat(64), confirmationId: 3,
  confirmationHash: "b".repeat(64), requestKey: "fixture_request_001" };
const denied = { kind: "denied" };

describe("E1 revogação do alias pessoal: fronteira inativa", () => {
  it.each([{ ...sample, userId: 17 }, { ...sample, sourceFeedbackId: 51 },
    { ...sample, confirmationHash: "C".repeat(64) }, { ...sample, requestKey: "too short" },
  ])("recusa entrada sem acionar autenticação ou persistência", async input => {
    const authenticateHolder = vi.fn(async () => 17);
    const db = { transaction: vi.fn() };
    const revoke = createPersonalAliasRevocation({ db, authenticateHolder, lockConfirmationAuthority: async () => null });
    await expect(revoke(input)).resolves.toEqual(denied);
    expect(authenticateHolder).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("recusa sessão ausente ou inválida antes de ler alias", async () => {
    const db = { transaction: vi.fn() };
    for (const user of [null, 0, 2_147_483_648]) {
      const revoke = createPersonalAliasRevocation({ db, authenticateHolder: async () => user,
        lockConfirmationAuthority: async () => null });
      await expect(revoke(sample)).resolves.toEqual(denied);
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("faz CAS só com testemunho exato e não leva conteúdo de evidência para o recibo", async () => {
    type Tx = Parameters<Parameters<Dependencies["db"]["transaction"]>[0]>[0];
    const confirmedAt = new Date(Date.now() - 60_000);
    const row = { id: 1, userId: 17, foodVariantId: 2, source: "user_confirmed" as const,
      alias: "apelido fixture", normalizedAlias: "apelido fixture", confidence: null, status: "active" as const,
      confirmedAt, createdAt: confirmedAt, updatedAt: confirmedAt, revokedAt: null, currentSlot: 1,
      revocationRequestHash: null };
    const aliasRevision = personalAliasRevision(row)!;
    const payloadJson = JSON.stringify({ purpose: "personal_alias_confirmation", schemaVersion: 1,
      aliasId: row.id, userId: row.userId, variantId: row.foodVariantId, aliasRevision });
    const confirmationHash = createHash("sha256").update(payloadJson).digest("hex");
    const input = { ...sample, aliasRevision, confirmationHash };
    const contents = [{ ...row }, { capturedAt: confirmedAt, retentionUntil: new Date(Date.now() + 60_000),
      payloadJson, contentHash: confirmationHash }, { revokedAt: confirmedAt }];
    const reads = vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => {
      const value = contents.shift();
      return Object.assign(Promise.resolve([value]), { for: async () => [value] });
    } }) }) }));
    const set = vi.fn(() => ({ where: async () => [{ affectedRows: 1 }] }));
    const stubDb: Dependencies["db"] = { transaction: work => work({ select: reads, update: () => ({ set }) } as unknown as Tx) };
    const lockConfirmationAuthority = vi.fn<Dependencies["lockConfirmationAuthority"]>(async (_read, scope) => ({
      ...scope, authority: "personal_alias_confirmation",
    }));
    const revoke = createPersonalAliasRevocation({
      db: stubDb, authenticateHolder: async () => row.userId, lockConfirmationAuthority,
    });
    expect(await revoke(input)).toEqual({ kind: "revoked", revokedAt: confirmedAt.toISOString() });
    expect(lockConfirmationAuthority.mock.calls[0][1]).toEqual({
      aliasId: row.id, userId: row.userId, variantId: row.foodVariantId, aliasRevision,
      confirmationId: input.confirmationId, confirmationHash,
    });
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ status: "revoked", currentSlot: null,
      revokedAt: expect.anything(), revocationRequestHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(reads).toHaveBeenCalledTimes(3);
  });
});

const rawUrl = process.env.FOOD_V2_REVOCATION_TEST_DB;
function isolatedUrl() {
  if (!rawUrl) return undefined;
  const parsed = new URL(rawUrl);
  if (process.env.FOOD_V2_TEST_DB_ISOLATED !== "1" || process.env.FOOD_V2_TEST_MODE !== "upgrade" ||
      parsed.protocol !== "mysql:" || parsed.hostname !== "127.0.0.1" ||
      parsed.port !== "4000" || parsed.username !== "root" || parsed.password ||
      parsed.pathname !== "/ci_foodv2_upgrade" || parsed.search || parsed.hash) {
    throw new Error("Refusing to touch a non-isolated personal-alias fixture.");
  }
  return rawUrl;
}
const databaseUrl = isolatedUrl();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

describe.runIf(Boolean(databaseUrl))("TiDB descartável: revogação explícita, atomicidade e leitura canônica", () => {
  const pool = databaseUrl ? createPool({ uri: databaseUrl, connectionLimit: 8, timezone: "Z" }) : undefined!;
  const db = databaseUrl ? drizzle(pool) : undefined!;
  let owner: number;
  let other: number;

  async function insert(query: string, values: unknown[] = []) {
    return (await pool.execute<ResultSetHeader>(query, values))[0].insertId;
  }

  beforeAll(async () => {
    vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
    for (const suffix of ["owner", "other"]) {
      const id = await insert("INSERT INTO users (openId, name) VALUES (?, 'Fixture revocation')", [`revocation:${suffix}`]);
      if (suffix === "owner") owner = id;
      else other = id;
    }
  });
  afterAll(async () => { await pool.end(); });

  type Problem = "legacy" | "wrong_owner" | "wrong_variant" | "wrong_alias" | "expired" | "inherited";
  async function seed(label: string, problem?: Problem) {
    const name = `revocation fixture ${label}`;
    const normalizedAlias = `alias fixture ${label}`;
    const foodId = await insert(`INSERT INTO foods
      (name, normalized_name, canonical_key, canonical_name, scope, owner_user_id,
       calories_kcal_per_100g, protein_grams_per_100g, carbs_grams_per_100g, fat_grams_per_100g)
      VALUES (?, ?, ?, ?, 'user', ?, 100, 1, 2, 3)`, [name, name, `ci:revoke:food:${label}`, name, owner]);
    const variantId = await insert(`INSERT INTO food_variants
      (food_id, variant_type, display_name, normalized_name, identity_key, status, governance_status)
      VALUES (?, 'generic', ?, ?, ?, 'active', 'verified')`, [foodId, name, name, `ci:revoke:variant:${label}`]);
    const sourceId = await insert(`INSERT INTO food_sources (slug, name, version, source_url)
      VALUES (?, ?, 'v1', 'https://food-revocation.example.invalid/source')`, [`ci-revoke-${label}`, name]);
    await insert(`INSERT INTO food_source_read_grants
      (source_id, source_version, status, allow_read, license_reference, approval_reference, approved_at)
      VALUES (?, 'v1', 'approved', 1, 'https://food-revocation.example.invalid/license', 'fixture', NOW())`, [sourceId]);
    await insert(`INSERT INTO food_nutrition_profiles (food_variant_id, source_id, source_version, profile_key,
      version, status, basis_quantity, basis_unit, calories_kcal, protein_g, carb_g, fat_g, content_hash, current_slot)
      VALUES (?, ?, 'v1', ?, 1, 'verified', 100, 'g', 100, 1, 2, 3, ?, 1)`,
    [variantId, sourceId, `ci:revoke:profile:${label}`, digest(label)]);

    const confirmedAt = new Date(Math.floor(Date.now() / 1000 - 60) * 1000);
    const [alias] = await db.insert(userFoodAliases).values({
      userId: owner, foodVariantId: variantId, alias: normalizedAlias, normalizedAlias, source: "user_confirmed", confirmedAt,
    });
    const aliasId = alias.insertId;
    const readAlias = async () => (await db.select().from(userFoodAliases).where(eq(userFoodAliases.id, aliasId)))[0];
    const aliasRevision = personalAliasRevision(await readAlias())!;
    const payloadJson = problem === "inherited" ? JSON.stringify({ sourceHistoryId: 21, sourceFeedbackId: 51 }) :
      JSON.stringify({ purpose: "personal_alias_confirmation", schemaVersion: 1,
        aliasId: problem === "wrong_alias" ? aliasId + 1 : aliasId, userId: owner, variantId, aliasRevision });
    const confirmationHash = digest(payloadJson);
    const [proof] = problem === "legacy" ? [{ insertId: 2147483647 }] : await db.insert(foodEvidence).values({
      subjectKey: personalAliasConfirmationSubject(aliasId), foodVariantId: problem === "wrong_variant" ? null : variantId,
      ownerUserId: problem === "wrong_owner" ? other : owner, evidenceType: "user_correction", contentHash: confirmationHash,
      payloadJson, capturedAt: confirmedAt, retentionUntil: new Date(Date.now() + (problem === "expired" ? -1000 : 2 * 60 * 60 * 1000)),
    });
    const input = { aliasId, variantId, aliasRevision, confirmationId: proof.insertId, confirmationHash,
      requestKey: "fixture_revocation_request_01" };
    const issuer: Dependencies["lockConfirmationAuthority"] = async (_read, bound) => (
      bound.userId === owner && bound.aliasId === aliasId && bound.variantId === variantId &&
      bound.aliasRevision === aliasRevision && bound.confirmationId === proof.insertId && bound.confirmationHash === confirmationHash
    ) ? { ...bound, authority: "personal_alias_confirmation" } : null;
    const revoke = (holder = owner, lockConfirmationAuthority = issuer, txDb: Dependencies["db"] = db) =>
      createPersonalAliasRevocation({ db: txDb, authenticateHolder: async () => holder, lockConfirmationAuthority });
    const readProof = async () => (await db.select().from(foodEvidence).where(eq(foodEvidence.id, proof.insertId)))[0];
    const observe = (userId: number) => createFoodV2KnowledgeRepository().readLocal({
      normalizedName: normalizedAlias, userId, policyVersion: "fixture:policy", resolverVersion: "fixture:resolver",
    });
    return { input, normalizedAlias, revoke, readAlias, readProof, observe, issuer, foodId };
  }

  it("revoga uma vez, perde elegibilidade B2 após reinício e preserva evidência/refeição", async () => {
    const f = await seed("lifecycle");
    const latestRead = await f.observe(owner);
    expect(latestRead).toMatchObject({ kind: "match", matchingEvidence: "personal_alias", variantId: f.input.variantId });
    expect((await f.observe(other)).kind).toBe("miss");
    const meal = await insert("INSERT INTO meals (userId, mealLabel) VALUES (?, 'Fixture histórica')", [owner]);
    const snapshot = JSON.stringify({ foodId: f.foodId, calories: 33, source: "synthetic_history" });
    const item = await insert(`INSERT INTO mealItems
      (mealId, foodId, itemType, foodName, canonicalName, portionText, calories, protein, carbs, fat, foodSnapshotJson)
      VALUES (?, ?, 'food', 'Histórico', 'Histórico', '33 g', 33, 1, 2, 3, ?)`, [meal, f.foodId, snapshot]);
    const proof = await f.readProof();
    const resolverContext = { userId: owner, traceId: "fixture:revoke", knowledgeRevision: "original-revision",
      policyVersion: "fixture:policy", resolverVersion: "fixture:resolver" };
    const first = buildFoodObservationFixture({ identityHints: { foodName: f.normalizedAlias },
      quantityHints: { value: 100, unit: "g" }, evidence: [] });
    const originally = await resolveFoodObservation(first, resolverContext, createFoodV2KnowledgeRepository());
    expect(originally.nextAction).toBe("propose");
    const frozenSnapshot = JSON.stringify(originally);
    const result = await f.revoke()(f.input);
    expect(result).toMatchObject({ kind: "revoked" });
    expect(await f.readAlias()).toMatchObject({ status: "revoked", currentSlot: null });
    expect(await f.revoke()(f.input)).toEqual(result); // fresh service object, exact durable request
    expect(await f.revoke(other)(f.input)).toEqual(denied);
    expect(await f.revoke()({ ...f.input, requestKey: "different_request_key" })).toEqual(denied);
    expect((await f.observe(owner)).kind).toBe("miss");
    expect((await f.observe(other)).kind).toBe("miss");
    const reply = buildFoodObservationFixture({ identityHints: { foodName: null },
      quantityHints: { value: null, unit: null, servingText: null }, evidence: [] });
    const after = await resolveFoodObservation(reply, { ...resolverContext, previousDecision: JSON.parse(frozenSnapshot) },
      createFoodV2KnowledgeRepository());
    expect(after.nextAction).not.toBe("propose");
    expect(after.nutrition.consumed).toBeNull();
    expect(await f.readProof()).toEqual(proof);
    expect(JSON.stringify(originally)).toBe(frozenSnapshot);
    const [[history]] = await pool.execute<RowDataPacket[]>("SELECT foodSnapshotJson FROM mealItems WHERE id=?", [item]);
    expect(history.foodSnapshotJson).toBe(snapshot);
  });

  it.each(["legacy", "wrong_owner", "wrong_variant", "wrong_alias", "expired", "inherited"] as const)(
    "não infere nem altera alias com vínculo %s", async problem => {
      const f = await seed(problem, problem);
      const before = await f.readAlias();
      const authority = vi.fn(f.issuer);
      expect(await f.revoke(owner, authority)(f.input)).toEqual(denied);
      expect(authority).not.toHaveBeenCalled();
      expect(await f.readAlias()).toEqual(before);
    },
  );

  it("nega falso titular, hash/alvo obsoleto e autoridade ausente ou divergente", async () => {
    const f = await seed("authority");
    const before = await f.readAlias();
    const verify = vi.fn(f.issuer);
    expect(await f.revoke(other, verify)(f.input)).toEqual(denied);
    expect(await f.revoke(owner, verify)({ ...f.input, variantId: f.input.variantId + 1 })).toEqual(denied);
    expect(await f.revoke(owner, verify)({ ...f.input, aliasRevision: "a".repeat(64) })).toEqual(denied);
    expect(await f.revoke(owner, verify)({ ...f.input, confirmationHash: "a".repeat(64) })).toEqual(denied);
    expect(verify).not.toHaveBeenCalled();
    expect(await f.revoke(owner, async () => null)(f.input)).toEqual(denied);
    expect(await f.revoke(owner, async (_read, scope) => ({
      ...scope, variantId: scope.variantId + 1, authority: "personal_alias_confirmation",
    }))(f.input)).toEqual(denied);
    expect(await f.readAlias()).toEqual(before);
  });

  it("serializa duas entregas do mesmo comando, disputa conflitante e outra conta", async () => {
    const f = await seed("same-command");
    const duplicated = await Promise.all([f.revoke()(f.input), f.revoke()(f.input), f.revoke(other)(f.input)]);
    expect(duplicated[0]).toMatchObject({ kind: "revoked" });
    expect(duplicated[1]).toEqual(duplicated[0]);
    expect(duplicated[2]).toEqual(denied);
    const g = await seed("competing");
    const race = await Promise.all([g.revoke()(g.input), g.revoke()({ ...g.input, requestKey: "fixture_alt_command_02" })]);
    expect(race.map(entry => entry.kind).sort()).toEqual(["denied", "revoked"]);
    expect(await g.readAlias()).toMatchObject({ status: "revoked", currentSlot: null });
  });

  it("CAS de outra proposta de vínculo não altera a linha após o titular revogar", async () => {
    const f = await seed("rebind-base");
    const g = await seed("rebind-other-target");
    let lockObserved!: () => void;
    let release!: () => void;
    const locked = new Promise<void>(ready => { lockObserved = ready; });
    const resume = new Promise<void>(ready => { release = ready; });
    const pending = f.revoke(owner, async (read, scope) => {
      lockObserved();
      await resume;
      return f.issuer(read, scope);
    })(f.input);
    const gate = await Promise.race([locked.then(() => "locked"), pending.then(() => "completed")]);
    expect(gate).toBe("locked");
    const otherBinding = db.update(userFoodAliases).set({ foodVariantId: g.input.variantId })
      .where(and(eq(userFoodAliases.id, f.input.aliasId), eq(userFoodAliases.userId, owner),
        eq(userFoodAliases.foodVariantId, f.input.variantId), eq(userFoodAliases.status, "active"),
        eq(userFoodAliases.currentSlot, 1))).execute();
    release();
    const [revoked, [rebind]] = await Promise.all([pending, otherBinding]);
    expect(revoked).toMatchObject({ kind: "revoked" });
    expect(rebind.affectedRows).toBe(0);
    expect(await f.readAlias()).toMatchObject({ foodVariantId: f.input.variantId, status: "revoked" });
    expect(await f.revoke()({ ...f.input, variantId: g.input.variantId })).toEqual(denied);
  });

  it("reentrega antiga nunca alcança o sucessor nem reativa a linha anterior", async () => {
    const f = await seed("redefinition");
    const receipt = await f.revoke()(f.input);
    const [newRow] = await db.insert(userFoodAliases).values({
      alias: f.normalizedAlias, normalizedAlias: f.normalizedAlias, userId: owner,
      foodVariantId: f.input.variantId, source: "user_confirmed", confirmedAt: new Date(),
    });
    expect(await f.revoke()(f.input)).toEqual(receipt);
    expect(await f.revoke()({ ...f.input, aliasId: newRow.insertId })).toEqual(denied);
    expect((await f.observe(owner)).kind).toBe("match");
    expect(await f.readAlias()).toMatchObject({ status: "revoked", currentSlot: null });
  });

  it("erro SQL após o CAS desfaz status, slot e recibo juntos", async () => {
    const f = await seed("rollback");
    const row = await f.readAlias();
    const conflictingTx: Dependencies["db"] = {
      transaction: (work, config) => db.transaction(async tx => {
        const result = await work(tx);
        expect(result).toMatchObject({ kind: "revoked" });
        await tx.execute(sql`UPDATE user_food_aliases SET revoked_at=NULL WHERE id=${f.input.aliasId}`);
        return result;
      }, config),
    };
    await expect(f.revoke(owner, f.issuer, conflictingTx)(f.input)).rejects.toThrow(/constraint|violate/i);
    expect(await f.readAlias()).toEqual(row);
    expect((await f.observe(owner)).kind).toBe("match");
    expect(await f.revoke()(f.input)).toMatchObject({ kind: "revoked" });
  });
});
