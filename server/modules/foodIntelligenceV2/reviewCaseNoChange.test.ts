import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { foodReviewCases, foodReviewEvents } from "../../../drizzle/food-intelligence-v2-schema";
import { applyAssignedFoodReview } from "./reviewCaseNoChange";

const actor = 101;
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
  action: "close_no_change",
  reason: "no_material_effect",
};
type FoodLock = Parameters<typeof applyAssignedFoodReview>[0]["lockFoodReviewGrant"];
const deniedGrant: FoodLock = async () => null;

describe("E1 sem efeito material: fronteira inativa do comando", () => {
  it.each([
    { ...command, actorUserId: actor },
    { ...command, action: "approve" },
    { ...command, action: "start_review" },
    { ...command, reason: "texto livre sintético" },
    { ...command, expectedStateVersion: 2_147_483_647 },
    { ...command, target: { ...target, contentHash: "B".repeat(64) } },
    { ...command, requestKey: " fixture:key" },
  ])("nega entrada fora do contrato antes da política ou persistência", async invalid => {
    const db = { transaction: vi.fn() };
    const lockFoodReviewGrant = vi.fn(deniedGrant);
    expect(await applyAssignedFoodReview({ db, lockFoodReviewGrant }, actor, invalid))
      .toEqual({ kind: "invalid" });
    expect(lockFoodReviewGrant).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("recusa identidade ausente ou integração sem porta Food", async () => {
    const db = { transaction: vi.fn() };
    const lockFoodReviewGrant = vi.fn(deniedGrant);
    expect(await applyAssignedFoodReview({ db, lockFoodReviewGrant }, 0, command))
      .toEqual({ kind: "invalid" });
    expect(await applyAssignedFoodReview({
      db, lockFoodReviewGrant: undefined as unknown as FoodLock,
    }, actor, command)).toEqual({ kind: "denied" });
    expect(lockFoodReviewGrant).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("recusa alvo fora do caso bloqueado sem consultar grant ou recibo", async () => {
    type Db = Parameters<typeof applyAssignedFoodReview>[0]["db"];
    type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
    const from = vi.fn((table: unknown) => {
      if (table !== foodReviewCases) throw new Error("Unexpected read in wrong-target path.");
      return { where: () => ({ limit: () => ({
        for: async () => [{
          status: "open", outcome: null, closedAt: null,
          reviewCycle: 1, stateVersion: 3, assignedReviewerId: actor,
          targetArtifactType: target.artifactType, targetArtifactId: target.artifactId,
          targetRevision: target.revision, targetContentHash: target.contentHash,
        }],
      }) }) };
    });
    const db: Db = { transaction: work => work({ select: () => ({ from }) } as unknown as Tx) };
    const lockFoodReviewGrant = vi.fn<FoodLock>(async (_read, scope) => ({
      ...scope, authority: "food_review", status: "active", policyVersion: "fixture:policy",
    }));
    expect(await applyAssignedFoodReview({ db, lockFoodReviewGrant }, actor, {
      ...command, target: { ...target, revision: target.revision + 1 },
    })).toEqual({ kind: "denied" });
    expect(from.mock.calls).toEqual([[foodReviewCases]]);
    expect(lockFoodReviewGrant).not.toHaveBeenCalled();
  });

});

// Only the dedicated GitHub Actions service can opt in. Never read the
// ordinary DATABASE_URL in this suite and never connect to a custom host.
const fixtureSetting = process.env.FOOD_V2_E1_TEST_DB;
const fixtureUri = "mysql://root@127.0.0.1:4000/ci_foodv2_upgrade";
describe.skipIf(fixtureSetting === undefined)("E1 sem efeito material: TiDB descartável", () => {
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof drizzle>;
  let reviewer: number;
  let otherReviewer: number;
  const grantTable = "ci_e1_assigned_reviewer_grants";
  const fixtureGrants = mysqlTable(grantTable, {
    actorUserId: int("actor_user_id").notNull(),
    action: varchar("action", { length: 60 }).notNull(),
    active: int("active").notNull(),
    policyVersion: varchar("policy_version", { length: 100 }).notNull(),
  });
  const lockFoodReviewGrant: FoodLock = async (read, scope) => {
    const [grant] = await read.select({
      active: fixtureGrants.active, policyVersion: fixtureGrants.policyVersion,
    }).from(fixtureGrants).where(and(
      eq(fixtureGrants.actorUserId, scope.actorUserId), eq(fixtureGrants.action, scope.action),
    )).limit(1).for("update");
    return grant?.active === 1 ? {
      ...scope, authority: "food_review", status: "active", policyVersion: grant.policyVersion,
    } : null;
  };
  type Db = Parameters<typeof applyAssignedFoodReview>[0]["db"];
  const dependencies = (storage: Db = db, authorize: FoodLock = lockFoodReviewGrant) =>
    ({ db: storage, lockFoodReviewGrant: authorize });
  const apply = (input: unknown, id = reviewer) =>
    applyAssignedFoodReview(dependencies(), id, input);
  async function expectPendingWhileLockHeld(pending: Promise<unknown>) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      expect(await Promise.race([
        pending.then(() => "settled"), new Promise(resolve => {
          timeout = setTimeout(() => resolve("waiting"), 150);
        }),
      ])).toBe("waiting");
    } finally {
      clearTimeout(timeout);
    }
  }

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
    expect((await pool.query("SHOW GLOBAL VARIABLES LIKE 'tidb_txn_mode'"))[0])
      .toEqual([{ Variable_name: "tidb_txn_mode", Value: "pessimistic" }]);
    // The authority below exists ONLY in this disposable fixture. It is not
    // application schema, permission policy, or a production grant adapter.
    await pool.query(`CREATE TABLE ${grantTable} (
      actor_user_id INT NOT NULL, action VARCHAR(60) NOT NULL,
      active TINYINT NOT NULL, policy_version VARCHAR(100) NOT NULL,
      PRIMARY KEY (actor_user_id, action))`);
    async function addReviewer(name: string) {
      const [result] = await pool.execute<import("mysql2").ResultSetHeader>(
        "INSERT INTO users (openId, name) VALUES (?, ?)", [name, name]
      );
      await pool.execute(`INSERT INTO ${grantTable}
        (actor_user_id, action, active, policy_version) VALUES
        (?, 'start_review', 1, 'fixture:policy-v1'), (?, 'close_no_change', 1, 'fixture:policy-v1')`,
        [result.insertId, result.insertId]);
      return result.insertId;
    }
    reviewer = await addReviewer("ci-e1-food-reviewer");
    otherReviewer = await addReviewer("ci-e1-other-food-reviewer");
  });

  afterAll(async () => { await pool?.end(); });

  async function seed(
    slug: string, status: "open" | "in_review" = "open", reviewTarget = target,
    assignment: number | null = reviewer
  ) {
    const [result] = await pool.execute<import("mysql2").ResultSetHeader>(
      `INSERT INTO food_review_cases
       (case_key, case_type, status, review_cycle, state_version, assigned_reviewer_id,
       target_artifact_type, target_artifact_id, target_revision, target_content_hash)
       VALUES (?, 'profile', ?, 1, 3, ?, ?, ?, ?, ?)`,
      [`ci-foodv2:e1-${slug}`, status, assignment, reviewTarget.artifactType, reviewTarget.artifactId,
        reviewTarget.revision, reviewTarget.contentHash]
    );
    return { ...command, caseId: result.insertId, target: reviewTarget };
  }

  async function read(caseId: number) {
    const [cases] = await pool.execute<import("mysql2").RowDataPacket[]>(
      `SELECT status, outcome, review_cycle AS cycle, state_version AS version,
       closed_at IS NOT NULL AS hasClosedAt, assigned_reviewer_id AS assigned,
       target_content_hash AS targetHash
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

  it("inicia revisão sem alterar designação e exige comando novo para fechar", async () => {
    const input = await seed("start");
    const toStart = { ...input, action: "start_review", reason: null };
    const [first, second] = await Promise.all([apply(toStart), apply(toStart)]);
    expect(first).toMatchObject({
      kind: "applied", receipt: { action: "start_review", reviewCycle: 1,
        stateVersion: 4, status: "in_review", outcome: null },
    });
    expect(second).toStrictEqual(first);
    expect(await read(input.caseId)).toMatchObject({
      current: { status: "in_review", outcome: null, version: 4, hasClosedAt: 0, assigned: reviewer },
      events: [{ action: "start_review", previousStatus: "open", newStatus: "in_review",
        outcome: null, reason: null, evidence: null }],
    });
    expect(await apply({ ...input, expectedStateVersion: 4 })).toEqual({ kind: "conflict" });
    expect(await apply({ ...toStart, expectedStateVersion: 4, requestKey: "fixture:start-again" }))
      .toEqual({ kind: "conflict" });
    expect(await apply({ ...input, expectedStateVersion: 4, requestKey: "fixture:close-second" }))
      .toMatchObject({ kind: "applied", receipt: { status: "closed", stateVersion: 5 } });
    expect(await apply(toStart)).toStrictEqual(first);
    expect((await read(input.caseId)).current.assigned).toBe(reviewer);
    expect((await read(input.caseId)).events).toHaveLength(2);
  });

  it("nega caso ausente, sem designação ou de outro revisor antes de consultar a porta Food", async () => {
    const input = await seed("unassigned", "open", target, null);
    const elsewhere = await seed("different-reviewer", "open", target, otherReviewer);
    const getGrant = vi.fn(lockFoodReviewGrant);
    for (const candidate of [input, elsewhere, { ...input, caseId: 2_147_483_647 }]) {
      expect(await applyAssignedFoodReview(dependencies(db, getGrant), reviewer, candidate))
        .toEqual({ kind: "denied" });
    }
    expect(getGrant).not.toHaveBeenCalled();
    for (const caseId of [input.caseId, elsewhere.caseId]) {
      expect(await read(caseId)).toMatchObject({ current: { status: "open", version: 3 }, events: [] });
    }
  });

  it("não confunde grant exato com autoridade de billing/admin, ação ou escopo trocados", async () => {
    const input = await seed("wrong-grant");
    type Grant = NonNullable<Awaited<ReturnType<FoodLock>>>;
    const mismatches: Array<(grant: Grant) => unknown> = [
      grant => ({ ...grant, authority: "billing" }),
      grant => ({ ...grant, role: "admin" }),
      grant => ({ ...grant, status: "revoked" }),
      grant => ({ ...grant, actorUserId: otherReviewer }),
      grant => ({ ...grant, action: "start_review" }),
      grant => ({ ...grant, caseId: input.caseId + 1 }),
      grant => ({ ...grant, reviewCycle: grant.reviewCycle + 1 }),
      grant => ({ ...grant, stateVersion: grant.stateVersion + 1 }),
      grant => ({ ...grant, target: { ...grant.target, revision: grant.target.revision + 1 } }),
    ];
    for (const mismatch of mismatches) {
      const getGrant: FoodLock = async (tx, scope) => {
        const grant = await lockFoodReviewGrant(tx, scope);
        if (!grant) throw new Error("Missing fixture authorization.");
        return mismatch(grant) as Grant;
      };
      expect(await applyAssignedFoodReview(dependencies(db, getGrant), reviewer, input))
        .toEqual({ kind: "denied" });
    }
    expect(await read(input.caseId)).toMatchObject({ current: { status: "open", version: 3 }, events: [] });
  });

  it("nega reentrega quando reatribuição concorrente confere o caso a outra pessoa", async () => {
    const input = await seed("assignment-race");
    const first = await apply(input);
    expect(first.kind).toBe("applied");
    const blocker = await pool.getConnection();
    try {
      await blocker.beginTransaction();
      await blocker.execute(`UPDATE food_review_cases
        SET assigned_reviewer_id=?, state_version=state_version+1 WHERE id=?`,
        [otherReviewer, input.caseId]);
      let announce!: () => void;
      const entered = new Promise<void>(resolve => { announce = resolve; });
      const gated: Db = { transaction: work => db.transaction(async tx => {
        announce();
        return work(tx);
      }) };
      const result = applyAssignedFoodReview(dependencies(gated), reviewer, input);
      await entered;
      await expectPendingWhileLockHeld(result);
      await blocker.commit();
      expect(await result).toEqual({ kind: "denied" });
      // The replacement's live grant cannot consume the former reviewer's receipt.
      expect(await apply(input, otherReviewer)).toEqual({ kind: "conflict" });
      expect(await read(input.caseId)).toMatchObject({
        current: { assigned: otherReviewer, version: 5, status: "closed" }, events: [{}],
      });
    } finally {
      await blocker.rollback();
      blocker.release();
    }
  });

  it("nega mutação e reentrega se a permissão específica revoga enquanto o caso está bloqueado", async () => {
    const previous = await seed("revoked-retry");
    const fresh = await seed("revoked-new");
    expect((await apply(previous)).kind).toBe("applied");
    const blocker = await pool.getConnection();
    try {
      await blocker.beginTransaction();
      await blocker.execute(`UPDATE ${grantTable} SET active=0
        WHERE actor_user_id=? AND action='close_no_change'`, [reviewer]);
      let announce!: () => void;
      const entered = new Promise<void>(resolve => { announce = resolve; });
      const gated: FoodLock = (tx, scope) => {
        announce();
        return lockFoodReviewGrant(tx, scope);
      };
      const pending = applyAssignedFoodReview(dependencies(db, gated), reviewer, previous);
      await entered;
      await expectPendingWhileLockHeld(pending);
      await blocker.commit();
      expect(await pending).toEqual({ kind: "denied" });
      expect(await apply(fresh)).toEqual({ kind: "denied" });
      expect(await apply({ ...fresh, action: "start_review", reason: null })).toMatchObject({
        kind: "applied", receipt: { status: "in_review", action: "start_review" },
      });
      expect((await read(previous.caseId)).events).toHaveLength(1);
      expect(await read(fresh.caseId)).toMatchObject({
        current: { status: "in_review", outcome: null, version: 4 },
        events: [{ action: "start_review" }],
      });
    } finally {
      await blocker.rollback();
      blocker.release();
      await pool.execute(`UPDATE ${grantTable} SET active=1
        WHERE actor_user_id=? AND action='close_no_change'`, [reviewer]);
    }
  });

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
    const first = await apply(input);
    expect(first).toMatchObject({
      kind: "applied", receipt: { caseId: input.caseId, reviewCycle: 1, stateVersion: 4,
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
      const reauthorized: FoodLock = async (tx, scope) => {
        const grant = await lockFoodReviewGrant(tx, scope);
        return grant && { ...grant, policyVersion: "fixture:policy-v2" };
      };
      expect(await applyAssignedFoodReview(dependencies(restartedDb, reauthorized), reviewer, input))
        .toStrictEqual(first);
      expect(await applyAssignedFoodReview(dependencies(restartedDb, deniedGrant), reviewer, input))
        .toStrictEqual({ kind: "denied" });
      expect(await applyAssignedFoodReview(dependencies(restartedDb), reviewer,
        { ...input, requestKey: "fixture:another" })).toEqual({ kind: "conflict" });
      expect(await read(input.caseId)).toMatchObject({
        current: { status: "open", outcome: null, cycle: 2, version: 5, hasClosedAt: 0 },
        events: [{ cycle: 1 }],
      });
      expect(await applyAssignedFoodReview(dependencies(restartedDb, reauthorized), reviewer,
        { ...input, reviewCycle: 2, expectedStateVersion: 5 })).toMatchObject({
          kind: "applied", receipt: { reviewCycle: 2, stateVersion: 6, policyVersion: "fixture:policy-v2" },
        });
      expect((await read(input.caseId)).events.map(event => event.cycle)).toEqual([1, 2]);
      expect(await readProfileHistory()).toStrictEqual(history);
    } finally {
      await restartedPool.end();
    }
  });

  it("serializa reentregas e rejeita reuso incompatível, versão e alvo defasados", async () => {
    const input = await seed("same-key");
    const close = (candidate = input, actorId = reviewer) => apply(candidate, actorId);
    expect(await close({ ...input, target: { ...target, revision: target.revision + 1 } }))
      .toEqual({ kind: "denied" });
    expect(await close({ ...input, expectedStateVersion: 2 })).toEqual({ kind: "conflict" });
    const [first, second] = await Promise.all([close(), close()]);
    expect(first.kind).toBe("applied");
    expect(second).toStrictEqual(first);
    expect(await close(input, otherReviewer)).toEqual({ kind: "denied" });
    expect(await close({ ...input, requestKey: input.requestKey.toUpperCase() }))
      .toEqual({ kind: "conflict" });
    expect(await close({ ...input, target: { ...target, contentHash: "d".repeat(64) } }))
      .toEqual({ kind: "denied" });
    expect(await close({ ...input, expectedStateVersion: 2 })).toEqual({ kind: "conflict" });
    expect((await read(input.caseId)).events).toHaveLength(1);
  });

  it("nega o alvo anterior identicamente com e sem recibo após mudança real do alvo", async () => {
    const original = await seed("retargeted");
    expect((await apply(original)).kind).toBe("applied");
    // Simulate a distinct, already-authorized new cycle/target as fixture
    // setup; this review seam does not perform that operation.
    await pool.execute(`UPDATE food_review_cases
      SET status='open', outcome=NULL, closed_at=NULL, review_cycle=2, state_version=5,
        target_revision=target_revision+1 WHERE id=?`, [original.caseId]);
    expect(await apply(original)).toEqual({ kind: "denied" });
    expect(await apply({ ...original, requestKey: "fixture:no-receipt-for-old-target" }))
      .toEqual({ kind: "denied" });
    expect(await read(original.caseId)).toMatchObject({
      current: { status: "open", cycle: 2, version: 5 },
      events: [{ cycle: 1, requestKey: original.requestKey }],
    });
  });

  it("entre duas chaves concorrentes só uma encerra a versão corrente", async () => {
    const input = await seed("competing-keys");
    const results = await Promise.all([
      apply(input),
      apply({
        ...input, requestKey: "fixture:other-request",
      }),
    ]);
    expect(results.map(result => result.kind).sort()).toEqual(["applied", "conflict"]);
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
    expect(await applyAssignedFoodReview(dependencies(dbWithBadEventWritableConnection), reviewer, input)).toEqual({ kind: "unavailable" });
    expect(eventAttempted).toBe(true);
    expect(await read(input.caseId)).toMatchObject({
      current: { status: "open", outcome: null, version: 3, hasClosedAt: 0 }, events: [],
    });
    expect((await apply(input)).kind).toBe("applied");
    expect((await read(input.caseId)).events).toHaveLength(1);
  });
});
