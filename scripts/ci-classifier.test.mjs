import test from "node:test";
import assert from "node:assert/strict";
import { classifyCiRisk } from "./ci-classifier.mjs";

test("isolated client component with colocated test stays FAST", () => {
  const plan = classifyCiRisk({ changedPaths: ["client/src/components/DateFilter.tsx", "client/src/components/DateFilter.test.tsx"] });
  assert.equal(plan.riskProfile, "fast");
  assert.equal(plan.codeChanged, true);
  assert.equal(plan.docsRequired, false);
});

test("sensitive WhatsApp path is CRITICAL", () => {
  assert.equal(classifyCiRisk({ changedPaths: ["server/modules/whatsapp/webhookTextCommands.ts"] }).riskProfile, "critical");
});

test("database migration is CRITICAL and marks database validation", () => {
  const plan = classifyCiRisk({ changedPaths: ["drizzle/0042_add_index.sql"] });
  assert.equal(plan.riskProfile, "critical");
  assert.equal(plan.databaseRequired, true);
});

test("explicit FAST never downgrades observed CRITICAL risk", () => {
  const plan = classifyCiRisk({ requested: "fast", changedPaths: [".github/workflows/agent-check.yml"] });
  assert.equal(plan.riskProfile, "critical");
  assert.equal(plan.promoted, true);
});

test("ordinary backend path is STANDARD", () => {
  assert.equal(classifyCiRisk({ changedPaths: ["server/modules/profile/service.ts"] }).riskProfile, "standard");
});

test("common documentation can be FAST while still requiring docs validation", () => {
  const plan = classifyCiRisk({ changedPaths: ["docs/testing/example.md"] });
  assert.equal(plan.riskProfile, "fast");
  assert.equal(plan.docsRequired, true);
  assert.equal(plan.codeChanged, false);
});

test("unknown path fails closed to CRITICAL", () => {
  const plan = classifyCiRisk({ changedPaths: ["new-surface/custom.file"] });
  assert.equal(plan.riskProfile, "critical");
  assert.match(plan.reasons.join(" "), /unknown-path/);
});

test("empty changed-path evidence fails closed to CRITICAL even when FAST was requested", () => {
  assert.equal(classifyCiRisk({ changedPaths: [] }).riskProfile, "critical");
  const requestedFast = classifyCiRisk({ requested: "fast", changedPaths: [] });
  assert.equal(requestedFast.riskProfile, "critical");
  assert.equal(requestedFast.promoted, true);
});

test("invalid requested risk is rejected rather than assumed safe", () => {
  assert.throws(() => classifyCiRisk({ requested: "unknown", changedPaths: ["docs/a.md"] }), /CI_RISK_PROFILE/);
});

test("empty and unexpected paths cannot be downgraded to FAST", () => {
  for (const changedPaths of [[], ["unclassified/new-entry.bin"], [".ci/policy.json"], ["scripts/ci-classifier.mjs"]]) {
    const plan = classifyCiRisk({ requested: "fast", changedPaths });
    assert.equal(plan.riskProfile, "critical");
    assert.equal(plan.promoted, true);
  }
});

test("sensitive changes override benign files in mixed diffs", () => {
  const plan = classifyCiRisk({ changedPaths: ["docs/readme.md", "server/modules/whatsapp/webhook.ts"] });
  assert.equal(plan.riskProfile, "critical");
  assert.equal(plan.docsRequired, true);
  assert.equal(plan.codeChanged, true);
});
