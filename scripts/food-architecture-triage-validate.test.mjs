import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const sha = "a".repeat(40);
const baselineSha = "b".repeat(40);
const fingerprint = "candidate-1";
const row = {
  fingerprint, file: "server/food.ts", line: 4, ruleId: "17", failureClass: "A",
  occurrenceIndex: 1, occurrenceCount: 1,
  evidence: {lineSha256: "d".repeat(64)},
};
const inventory = { sourceSha: sha, enforcementBaselineSha: baselineSha, triage: { pending: [row] } };
const decision = { ...row, lineSha256: row.evidence.lineSha256, disposition: "confirmed_non_violation", evidence: "Reviewed source and observed runtime non-food decision", reviewer: "independent-reviewer", reviewedAt: "2026-10-16T00:00:00Z", canonicalOwnerComparison: "No food resolution performed" };
const base = { sourceSha: sha, baselineSha, inventoryDigest: "sha256:" + createHash("sha256").update(JSON.stringify(inventory)).digest("hex"), reviews: [decision] };
function run(decisions, currentInventory = inventory) {
  const dir = mkdtempSync(join(tmpdir(), "food-architecture-triage-"));
  try {
    const inv = join(dir, "inventory.json");
    const dec = join(dir, "decisions.json");
    writeFileSync(inv, JSON.stringify(currentInventory));
    writeFileSync(dec, JSON.stringify(decisions));
    return spawnSync(process.execPath, ["scripts/food-architecture-triage-validate.mjs", inv, dec], { encoding: "utf8" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("accepts individually evidenced, fully covered exact-SHA decision", () => {
  const result = run(base);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test("rejects missing disposition, duplicate, and stale SHA", () => {
  for (const decisions of [
    { ...base, reviews: [] },
    { ...base, reviews: [decision, decision] },
    { ...base, sourceSha: "d".repeat(40) },
  ]) assert.notEqual(run(decisions).status, 0);
});
test("never certifies unresolved candidates even when tracked", () => {
  const result = run({ ...base, reviews: [{ ...decision, disposition: "unresolved", followUpIssue: 1300 }] });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Unresolved candidate cannot be certified/);
});
test("requires evidence and artifact identity", () => {
  assert.notEqual(run({ ...base, inventoryDigest: undefined }).status, 0);
  assert.notEqual(run({ ...base, reviews: [{ ...decision, evidence: "" }] }).status, 0);
});

test("rejects a well-formed but incorrect inventory digest", () => {
  const result = run({ ...base, inventoryDigest: "sha256:" + "d".repeat(64) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Inventory SHA-256 mismatch/);
});

test("refuses to double-certify two occurrences with the same source line and fingerprint", () => {
  const first = { ...row, occurrenceCount: 2 };
  const second = { ...row, occurrenceIndex: 2, occurrenceCount: 2 };
  const currentInventory = { ...inventory, triage: { pending: [first, second] } };
  const currentDigest = "sha256:" + createHash("sha256").update(JSON.stringify(currentInventory)).digest("hex");
  const firstReview = { ...decision, occurrenceCount: 2 };
  const revisedBase = { ...base, inventoryDigest: currentDigest };
  assert.notEqual(run({ ...revisedBase, reviews: [firstReview, firstReview] }, currentInventory).status, 0);
  assert.notEqual(run({ ...revisedBase, reviews: [firstReview] }, currentInventory).status, 0);
  const result = run({ ...revisedBase, reviews: [firstReview, { ...firstReview, occurrenceIndex: 2 }] }, currentInventory);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("requires exact line evidence and a complete occurrence sequence", () => {
  const incorrectLine = run({ ...base, reviews: [{ ...decision, lineSha256: "f".repeat(64) }] });
  assert.notEqual(incorrectLine.status, 0);
  assert.match(incorrectLine.stdout, /Source line SHA-256 mismatch/);
  const invalidInventory = { ...inventory, triage: { pending: [{ ...row, occurrenceIndex: 2 }] } };
  const badDigest = "sha256:" + createHash("sha256").update(JSON.stringify(invalidInventory)).digest("hex");
  const result = run({ ...base, inventoryDigest: badDigest, reviews: [{ ...decision, occurrenceIndex: 2 }] }, invalidInventory);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Invalid occurrence sequence in inventory/);
});
