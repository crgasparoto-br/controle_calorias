import test from "node:test";
import assert from "node:assert/strict";
import { classifyDeliveryV2Ci } from "./delivery-v2-ci-classifier.mjs";

test("isolated client component with colocated test stays FAST", () => {
  const plan = classifyDeliveryV2Ci({
    changedPaths: [
      "client/src/components/DateFilter.tsx",
      "client/src/components/DateFilter.test.tsx"
    ]
  });
  assert.equal(plan.riskProfile, "fast");
  assert.equal(plan.codeChanged, true);
  assert.equal(plan.docsRequired, false);
});

test("sensitive WhatsApp path is CRITICAL", () => {
  const plan = classifyDeliveryV2Ci({ changedPaths: ["server/modules/whatsapp/webhookTextCommands.ts"] });
  assert.equal(plan.riskProfile, "critical");
});

test("database migration is CRITICAL and marks database validation", () => {
  const plan = classifyDeliveryV2Ci({ changedPaths: ["drizzle/0042_add_index.sql"] });
  assert.equal(plan.riskProfile, "critical");
  assert.equal(plan.databaseRequired, true);
});

test("explicit FAST never downgrades observed CRITICAL risk", () => {
  const plan = classifyDeliveryV2Ci({
    requested: "fast",
    changedPaths: [".github/workflows/agent-check.yml"]
  });
  assert.equal(plan.riskProfile, "critical");
  assert.equal(plan.promoted, true);
});

test("ordinary backend path is STANDARD", () => {
  const plan = classifyDeliveryV2Ci({ changedPaths: ["server/modules/profile/service.ts"] });
  assert.equal(plan.riskProfile, "standard");
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

test("empty changed-path evidence never becomes FAST", () => {
  assert.notEqual(classifyDeliveryV2Ci({ changedPaths: [] }).riskProfile, "fast");
  assert.equal(classifyDeliveryV2Ci({ requested: "fast", changedPaths: [] }).riskProfile, "standard");
});
