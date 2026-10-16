/** Issue #1300: validate independently reviewed dispositions against exact-head inventory.
 * Usage: node scripts/food-architecture-triage-validate.mjs inventory.json decisions.json
 * This tool never certifies runtime behavior by itself.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const [inventoryFile, decisionsFile] = process.argv.slice(2);
if (!inventoryFile || !decisionsFile) {
  console.error("Usage: node scripts/food-architecture-triage-validate.mjs inventory.json decisions.json");
  process.exit(2);
}
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const inventoryBytes = readFileSync(inventoryFile);
const actualInventoryDigest = "sha256:" + createHash("sha256").update(inventoryBytes).digest("hex");
const inventory = JSON.parse(inventoryBytes.toString("utf8"));
const decisions = read(decisionsFile);
const pending = inventory.triage?.pending;
if (!Array.isArray(pending) || !Array.isArray(decisions.reviews)) {
  throw new Error("Expected inventory.triage.pending and decisions.reviews arrays");
}
const sha = inventory.sourceSha;
const baselineSha = inventory.enforcementBaselineSha;
if (!/^[a-f0-9]{40}$/.test(sha ?? "") || !/^[a-f0-9]{40}$/.test(baselineSha ?? "")) {
  throw new Error("Inventory missing exact source and baseline SHA");
}
if (!/^sha256:[a-f0-9]{64}$/.test(decisions.inventoryDigest ?? "")) {
  throw new Error("Decisions require a SHA-256 digest of the exact inventory JSON bytes");
}
if (decisions.inventoryDigest !== actualInventoryDigest) {
  throw new Error("Inventory SHA-256 mismatch: supplied review does not bind to these inventory JSON bytes");
}
if (decisions.sourceSha !== sha || decisions.baselineSha !== baselineSha) {
  throw new Error("Stale or mismatched source/baseline SHA in decisions");
}
const errors = [];
const key = (r) => [r.fingerprint, r.file, r.line, r.ruleId, r.failureClass].join("\0");
const queue = new Map();
for (const row of pending) {
  const k = key(row);
  queue.set(k, (queue.get(k) ?? 0) + 1);
}
const reviewed = new Map();
for (const row of decisions.reviews) {
  const k = key(row);
  const available = queue.get(k) ?? 0;
  const used = reviewed.get(k) ?? 0;
  if (used >= available) errors.push("Unknown or duplicate candidate: " + k.replaceAll("\0", " | "));
  reviewed.set(k, used + 1);
  if (!["confirmed_violation", "confirmed_non_violation", "unresolved"].includes(row.disposition)) {
    errors.push("Invalid disposition: " + k);
  }
  if (!row.evidence || typeof row.evidence !== "string" || !row.evidence.trim() ||
      !row.reviewer || !row.reviewedAt || !row.canonicalOwnerComparison) {
    errors.push("Missing reviewer, evidence or canonical owner comparison: " + k);
  }
  if (row.disposition === "confirmed_violation" &&
      (!Number.isInteger(row.debtIssue) || !row.debtExpiresAt) &&
      !row.correctionReference) {
    errors.push("Confirmed violation requires correction or nominal debt: " + k);
  }
  if (row.disposition === "unresolved") {
    errors.push("Unresolved candidate cannot be certified: " + k);
  }
  if (row.disposition === "unresolved" && !row.followUpIssue) {
    errors.push("Unresolved candidate lacks follow-up issue: " + k);
  }
}
const unreviewed = [...queue].reduce((sum, [k, amount]) => sum + Math.max(0, amount - (reviewed.get(k) ?? 0)), 0);
if (unreviewed) errors.push(unreviewed + " candidate occurrences lack a reviewed decision");
const summary = {
  sourceSha: sha, baselineSha, pending: pending.length,
  reviewed: decisions.reviews.length, unreviewed,
  dispositions: Object.fromEntries(["confirmed_violation", "confirmed_non_violation", "unresolved"]
    .map(status => [status, decisions.reviews.filter(r => r.disposition === status).length])),
  valid: errors.length === 0, errors: errors.slice(0, 50),
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length) process.exitCode = 1;
