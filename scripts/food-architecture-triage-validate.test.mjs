import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sha = "a".repeat(40);
const baselineSha = "b".repeat(40);
const fingerprint = "candidate-1";
const row = {
  fingerprint, file: "server/food.ts", line: 4, ruleId: "17", failureClass: "A",
};
const inventory = { sourceSha: sha, enforcementBaselineSha: baselineSha, triage: { pending: [row] } };
const decision = { ...row, disposition: "confirmed_non_violation", evidence: "Reviewed source and observed runtime non-food decision", reviewer: "independent-reviewer", reviewedAt: "2026-10-16T00:00:00Z", canonicalOwnerComparison: "No food resolution performed" };
const base = { sourceSha: sha, baselineSha, inventoryDigest: "sha256:" + "c".repeat(64), reviews: [decision] };
function run(decisions) {
  const dir = mkdtempSync(join(tmpdir(), "food-architecture-triage-"));
  try {
    const inv = join(dir, "inventory.json");
    const dec = join(dir, "decisions.json");
    writeFileSync(inv, JSON.stringify(inventory));
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
