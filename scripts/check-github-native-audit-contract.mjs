import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const contract = JSON.parse(readFileSync(new URL("../docs/audit/github-native-contract.json", import.meta.url), "utf8"));
const workflow = readFileSync(new URL("../.github/workflows/agent-check.yml", import.meta.url), "utf8");

function validateContract(value) {
  assert.equal(value.schema_version, 1);
  assert.equal(value.repository, "crgasparoto-br/controle_calorias");
  assert.equal(value.canonical, true);
  assert.equal(value.audit_mode, "native-github");
  assert.ok(["not-required", "forbidden"].includes(value.legacy_handoff_policy));
  for (const key of ["github_native_identity", "exact_sha_evidence", "independent_review", "remote_ci_evidence"]) {
    assert.equal(value[key], true, key);
  }
  assert.equal(value.trusted_anchor, "pull_request.base.sha");
  assert.equal(value.required_check, "Agent-first gate");
  assert.match(value.audit_contract_version, /^\d{4}-\d{2}-\d{2}\.\d+$/);
}

// Verify the actual job/step structure, not incidental strings elsewhere in YAML.
// Both the checkout and self-test must be unconditional within the required job.
function validateWorkflow(source) {
  const jobMatch = source.match(/^  agent-check:\s*\n([\s\S]*?)(?=^  [\w-]+:\s*$|(?![\s\S]))/m);
  assert.ok(jobMatch, "agent-check job must exist");
  const job = jobMatch[1];
  assert.match(job, /^    name: Agent-first gate\s*$/m);
  assert.match(job, /^      VERIFICATION_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\s*$/m);
  assert.match(job, /exact-head gate executed/);

  const stepsSection = job.split(/^    steps:\s*$/m);
  assert.equal(stepsSection.length, 2, "job must declare exactly one steps section");
  const steps = stepsSection[1].split(/(?=^      - name: )/m).filter((part) => /^      - name: /m.test(part));
  const checkoutIndex = steps.findIndex((step) => /^      - name: Checkout repository\s*$/m.test(step));
  const testIndex = steps.findIndex((step) => /^      - name: GitHub-native audit contract self-test\s*$/m.test(step));
  assert.ok(checkoutIndex >= 0, "checkout step missing");
  assert.ok(testIndex > checkoutIndex, "contract self-test must run after checkout");
  assert.match(steps[checkoutIndex], /^        uses: actions\/checkout@v4\s*$/m);
  assert.match(steps[checkoutIndex], /^          ref: \$\{\{ env\.VERIFICATION_HEAD_SHA \}\}\s*$/m);
  assert.doesNotMatch(steps[checkoutIndex], /^        if:/m);
  assert.match(steps[testIndex], /^        run: node scripts\/check-github-native-audit-contract\.mjs\s*$/m);
  assert.doesNotMatch(steps[testIndex], /^        if:/m);
}

validateContract(contract);
validateWorkflow(workflow);

for (const key of Object.keys(contract)) {
  const invalid = { ...contract };
  delete invalid[key];
  assert.throws(() => validateContract(invalid), undefined, `missing ${key} must fail`);
}
for (const key of ["canonical", "github_native_identity", "exact_sha_evidence", "independent_review", "remote_ci_evidence"]) {
  assert.throws(() => validateContract({ ...contract, [key]: false }), { name: "AssertionError" });
}
for (const [key, value] of [
  ["schema_version", 2],
  ["repository", "other/repo"],
  ["audit_mode", "certified-handoff"],
  ["legacy_handoff_policy", "optional"],
  ["required_check", "nonexistent"],
  ["trusted_anchor", "pull_request.head.sha"],
  ["audit_contract_version", "invalid"],
]) {
  assert.throws(() => validateContract({ ...contract, [key]: value }), { name: "AssertionError" }, key);
}

const removedStep = workflow.replace(/^      - name: GitHub-native audit contract self-test\s*\n        run: node scripts\/check-github-native-audit-contract\.mjs\s*\n/m, "");
assert.notEqual(removedStep, workflow, "test fixture must remove the real step");
assert.throws(() => validateWorkflow(removedStep), { name: "AssertionError" });

const skippedStep = workflow.replace(
  /^      - name: GitHub-native audit contract self-test\s*\n/m,
  "      - name: GitHub-native audit contract self-test\n        if: false\n",
);
assert.notEqual(skippedStep, workflow, "test fixture must modify the real step");
assert.throws(() => validateWorkflow(skippedStep), { name: "AssertionError" });

const wrongCommand = workflow.replace(
  "run: node scripts/check-github-native-audit-contract.mjs",
  "run: echo skipped",
);
assert.notEqual(wrongCommand, workflow, "test fixture must modify the real command");
assert.throws(() => validateWorkflow(wrongCommand), { name: "AssertionError" });

console.log("GitHub-native audit contract passed positive and negative checks.");
