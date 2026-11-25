import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { foodReviewEvents } from "../../../drizzle/food-intelligence-v2-schema";
import { applyFoodReviewNoChange } from "./reviewCaseNoChange";

const actor = "fixture:actor-a";
const target = {
  artifactType: "nutrition_profile",
  artifactId: "fixture:artifact",
  revision: 3,
  contentHash: "b".repeat(64),
};
const command = {
  caseId: 1,
  reviewCycle: 1,
  expectedStateVersion: 3,
  requestKey: "fixture:command-a",
  target,
  reason: "no_material_effect",
};
const permit = async () => ({ policyVersion: "fixture:policy-v1" });

describe("E1 sem efeito material: fronteira inativa do comando", () => {
  it.each([
    { ...command, actorId: actor },
    { ...command, reason: "texto livre sintético" },
    { ...command, expectedStateVersion: 2_147_483_647 },
    { ...command, target: { ...target, contentHash: "B".repeat(64) } },
    { ...command, requestKey: " fixture:key" },
  ])("nega entrada fora do contrato antes da política ou persistência", async invalid => {
    const db = { transaction: vi.fn() };
    const authorize = vi.fn(permit);
    expect(await applyFoodReviewNoChange({ db, authorize }, actor, invalid))
      .toEqual({ kind: "invalid" });
    expect(authorize).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("não consulta armazenamento quando a autorização exata falta ou falha", async () => {
    const db = { transaction: vi.fn() };
    const denied = vi.fn(async () => null);
    const failed = vi.fn(async () => { throw new Error("erro interno sintético"); });
    expect(await applyFoodReviewNoChange({ db, authorize: denied }, actor, command))
      .toEqual({ kind: "denied" });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(denied).toHaveBeenCalledWith({
      actorId: actor, action: "close_no_change", command,
    });
    expect(await applyFoodReviewNoChange({ db, authorize: failed }, actor, command))
      .toEqual({ kind: "unavailable" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

// Only the dedicated GitHub Actions service can opt in. Never read the
// ordinary DATABASE_URL in this suite and never connect to a custom host.
const fixtureSetting = process.env.FOOD_V2_E1_TEST_DB;
const fixtureUri = "mysql://root@127.0.0.1:4000/ci_foodv2_upgrade";
describe.skipIf(fixtureSetting === undefined)("E1 sem efeito material: TiDB descartável", () => {
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    if (fixtureSetting !== fixtureUri || process.env.FOOD_V2_TEST_DB_ISOLATED !== "1" ||
        process.env.FOOD_V2_TEST_MODE !== "upgrade" || process.env.GITHUB_ACTIONS !== "true") {
      throw new Error("Refusing a database outside the dedicated Food V2 CI fixture.");
    }
    pool = createPool({ uri: fixtureUri, connectionLimit: 4 });
    db = drizzle(pool);
    expect((await pool.query("SELECT DATABASE() AS db"))[0]).toEqual([{ db: "ci_foodv2_upgrade" }]);
    expect((await pool.query("SHOW GLOBAL VARIABLES LIKE 'tidb_enable_check_constraint'"))[0])
      .toEqual([{ Variable_name: "tidb_enable_check_constraint", Value: "ON" }]);
  });

  afterAll(async () => { await pool?.end(); });

  async function seed(slug: string, status: "open" | "in_review" = "open", reviewTarget = target) {
    const [result] = await pool.execute<import("mysql2").ResultSetHeader>(
      `INSERT INTO food_review_cases
       (case_key, case_type, status, review_cycle, state_version,
       target_artifact_type, target_artifact_id, target_revision, target_content_hash)
       VALUES (?, 'profile', ?, 1, 3, ?, ?, ?, ?)`,
      [`ci-foodv2:e1-${slug}`, status, reviewTarget.artifactType, reviewTarget.artifactId,
        reviewTarget.revision, reviewTarget.contentHash]
    );
    return { ...command, caseId: result.insertId, target: reviewTarget };
  }

  async function read(caseId: number) {
    const [cases] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT status, outcome, review_cycle AS cycle, state_version AS version,
       closed_at IS NOT NULL AS hasClosedAt, target_content_hash AS targetHash
       FROM food_review_cases WHERE id=?`, [caseId]
    );
    const [events] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT id, review_cycle AS cycle, request_key AS requestKey, action, reason,
       previous_status AS previousStatus, new_status AS newStatus, outcome,
       evidence_ids_json AS evidence, target_content_hash AS targetHash, policy_version AS policyVersion
       FROM food_review_events WHERE case_id=? ORDER BY id`, [caseId]
    );
    return { current: cases[0], events };
  }

  it("commita caso e evento juntos e recupera o mesmo recibo com outra conexão após reabrir", async () => {
    // The migration workflow has a real revoked nutrition profile. Closing a
    // case about it must neither publish it nor rewrite its nutritional data.
    const readProfileHistory = async () => (await pool.execute<import("mysql2").RowDataPacket[]>(
      "SELECT * FROM food_nutrition_profiles WHERE profile_key=? ORDER BY version",
      ["ci-foodv2:profile"]
    ))[0];
    const history = await readProfileHistory();
    expect(history).toHaveLength(2);
    expect(history[0].status).toBe("revoked");
    const input = await seed("restart", "in_review", {
      ...target, artifactId: String(history[0].id),
      revision: Number(history[0].version), contentHash: history[0].content_hash,
    });
    const first = await applyFoodReviewNoChange({ db, authorize: permit }, actor, input);
    expect(first).toMatchObject({
      kind: "closed", receipt: { caseId: input.caseId, reviewCycle: 1, stateVersion: 4,
        status: "closed", outcome: "no_change", policyVersion: "fixture:policy-v1" },
    });
    expect(await read(input.caseId)).toMatchObject({
      current: { status: "closed", outcome: "no_change", version: 4, hasClosedAt: 1,
        targetHash: input.target.contentHash },
      events: [{ action: "close_no_change", previousStatus: "in_review", newStatus: "closed",
        outcome: "no_change", evidence: null, reason: input.reason, targetHash: input.target.contentHash }],
    });

    // Simulate a subsequent, already-authorized reopen as fixture setup only.
    // This PR does not implement the reopen action.
    await pool.execute(`UPDATE food_review_cases SET review_cycle=2, state_version=5,
      status='open', outcome=NULL, closed_at=NULL WHERE id=?`, [input.caseId]);
    const restartedPool = createPool(fixtureUri);
    const restartedDb = drizzle(restartedPool);
    try {
      const reauthorized = async () => ({ policyVersion: "fixture:policy-v2" });
      expect(await applyFoodReviewNoChange({ db: restartedDb, authorize: reauthorized }, actor, input))
        .toStrictEqual(first);
      expect(await applyFoodReviewNoChange({ db: restartedDb, authorize: async () => null }, actor, input))
        .toStrictEqual({ kind: "denied" });
      expect(await applyFoodReviewNoChange({ db: restartedDb, authorize: permit }, actor,
        { ...input, requestKey: "fixture:another" })).toEqual({ kind: "conflict" });
      expect(await read(input.caseId)).toMatchObject({
        current: { status: "open", outcome: null, cycle: 2, version: 5, hasClosedAt: 0 },
        events: [{ cycle: 1 }],
      });
      expect(await applyFoodReviewNoChange({ db: restartedDb, authorize: reauthorized }, actor,
        { ...input, reviewCycle: 2, expectedStateVersion: 5 })).toMatchObject({
          kind: "closed", receipt: { reviewCycle: 2, stateVersion: 6, policyVersion: "fixture:policy-v2" },
        });
      expect((await read(input.caseId)).events.map(event => event.cycle)).toEqual([1, 2]);
      expect(await readProfileHistory()).toStrictEqual(history);
    } finally {
      await restartedPool.end();
    }
  });

  it("serializa reentregas e rejeita reuso incompatível, versão e alvo defasados", async () => {
    const input = await seed("same-key");
    const close = (candidate = input, actorId = actor) =>
      applyFoodReviewNoChange({ db, authorize: permit }, actorId, candidate);
    expect(await close({ ...input, target: { ...target, revision: target.revision + 1 } }))
      .toEqual({ kind: "conflict" });
    expect(await close({ ...input, expectedStateVersion: 2 })).toEqual({ kind: "conflict" });
    const [first, second] = await Promise.all([close(), close()]);
    expect(first.kind).toBe("closed");
    expect(second).toStrictEqual(first);
    expect(await close(input, "fixture:actor-b")).toEqual({ kind: "conflict" });
    expect(await close({ ...input, requestKey: input.requestKey.toUpperCase() }))
      .toEqual({ kind: "conflict" });
    expect(await close({ ...input, target: { ...target, contentHash: "d".repeat(64) } }))
      .toEqual({ kind: "conflict" });
    expect((await read(input.caseId)).events).toHaveLength(1);
  });

  it("entre duas chaves concorrentes só uma encerra a versão corrente", async () => {
    const input = await seed("competing-keys");
    const results = await Promise.all([
      applyFoodReviewNoChange({ db, authorize: permit }, actor, input),
      applyFoodReviewNoChange({ db, authorize: permit }, actor, {
        ...input, requestKey: "fixture:other-request",
      }),
    ]);
    expect(results.map(result => result.kind).sort()).toEqual(["closed", "conflict"]);
    expect(await read(input.caseId)).toMatchObject({
      current: { version: 4, outcome: "no_change" }, events: [{}],
    });
  });

  it("rollback no TiDB quando a etapa de evento falha após o CAS", async () => {
    const input = await seed("rollback-event");
    let eventAttempted = false;
    const dbWithBadEventWritableConnection: Pick<typeof db, "transaction"> = {
      transaction: work => db.transaction(tx => work(new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop === "insert") return (table: typeof foodReviewEvents) => ({
            values: async (values: typeof foodReviewEvents.$inferInsert) => {
              expect(table).toBe(foodReviewEvents);
              eventAttempted = true;
              return tx.insert(table).values({ ...values, reviewCycle: 0 });
            },
          });
          const member = Reflect.get(target, prop, receiver);
          return typeof member === "function" ? member.bind(target) : member;
        },
      }))),
    };
    expect(await applyFoodReviewNoChange({ db: dbWithBadEventWritableConnection, authorize: permit },
      actor, input)).toEqual({ kind: "unavailable" });
    expect(eventAttempted).toBe(true);
    expect(await read(input.caseId)).toMatchObject({
      current: { status: "open", outcome: null, version: 3, hasClosedAt: 0 }, events: [],
    });
    expect((await applyFoodReviewNoChange({ db, authorize: permit }, actor, input)).kind).toBe("closed");
    expect((await read(input.caseId)).events).toHaveLength(1);
  });
});
