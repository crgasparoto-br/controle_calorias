import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyDeliveryV2Ci } from "./delivery-v2-ci-classifier.mjs";

test("generated classifier package is intact and pinned to the orchestrator source", () => {
  const verify = spawnSync(process.execPath, [fileURLToPath(new URL("../.delivery-v2/verify.mjs", import.meta.url))], { encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr);
  const lock = JSON.parse(readFileSync(new URL("../.delivery-v2/lock.json", import.meta.url), "utf8"));
  assert.equal(lock.source.commit, "1d6185de16e3a30378a810132bb4e3cf9483f98c");
  assert.equal(lock.target.repository, "crgasparoto-br/controle_calorias");
});

test("isolated client component with colocated test stays FAST", () => {
  const plan = classifyDeliveryV2Ci({ changedPaths: ["client/src/components/DateFilter.tsx", "client/src/components/DateFilter.test.tsx"] });
  assert.equal(plan.riskProfile, "fast");
  assert.equal(plan.codeChanged, true);
  assert.equal(plan.docsRequired, false);
});

test("sensitive WhatsApp path is CRITICAL", () => {
  assert.equal(classifyDeliveryV2Ci({ changedPaths: ["server/modules/whatsapp/webhookTextCommands.ts"] }).riskProfile, "critical");
});

test("database migration is CRITICAL and marks database validation", () => {
  const plan = classifyDeliveryV2Ci({ changedPaths: ["drizzle/0042_add_index.sql"] });
  assert.equal(plan.riskProfile, "critical");
  assert.equal(plan.databaseRequired, true);
});

test("explicit FAST never downgrades observed CRITICAL risk", () => {
  const plan = classifyDeliveryV2Ci({ requested: "fast", changedPaths: [".github/workflows/agent-check.yml"] });
  assert.equal(plan.riskProfile, "critical");
  assert.equal(plan.promoted, true);
});

test("ordinary backend path is STANDARD", () => {
  assert.equal(classifyDeliveryV2Ci({ changedPaths: ["server/modules/profile/service.ts"] }).riskProfile, "standard");
});

test("common documentation can be FAST while still requiring docs validation", () => {
  const plan = classifyDeliveryV2Ci({ changedPaths: ["docs/testing/example.md"] });
  assert.equal(plan.riskProfile, "fast");
  assert.equal(plan.docsRequired, true);
  assert.equal(plan.codeChanged, false);
});

test("unknown path fails closed to CRITICAL", () => {
  const plan = classifyDeliveryV2Ci({ changedPaths: ["new-surface/custom.file"] });
  assert.equal(plan.riskProfile, "critical");
  assert.match(plan.reasons.join(" "), /unknown-path/);
});

test("empty changed-path evidence fails closed to CRITICAL even when FAST was requested", () => {
  assert.equal(classifyDeliveryV2Ci({ changedPaths: [] }).riskProfile, "critical");
  const requestedFast = classifyDeliveryV2Ci({ requested: "fast", changedPaths: [] });
  assert.equal(requestedFast.riskProfile, "critical");
  assert.equal(requestedFast.promoted, true);
});
