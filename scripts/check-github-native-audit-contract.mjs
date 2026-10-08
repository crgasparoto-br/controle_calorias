import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const contract = JSON.parse(readFileSync(new URL("../docs/audit/github-native-contract.json", import.meta.url), "utf8"));
const workflow = readFileSync(new URL("../.github/workflows/agent-check.yml", import.meta.url), "utf8");

function validate(value) {
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
  assert.match(workflow, /name: Agent-first gate/);
  assert.match(workflow, /VERIFICATION_HEAD_SHA:/);
  assert.match(workflow, /exact-head gate executed/);
}

validate(contract);
for (const key of ["canonical", "github_native_identity", "exact_sha_evidence", "independent_review", "remote_ci_evidence"]) {
  assert.throws(() => validate({ ...contract, [key]: false }), { name: "AssertionError" });
}
assert.throws(() => validate({ ...contract, required_check: "nonexistent" }), { name: "AssertionError" });
assert.throws(() => validate({ ...contract, trusted_anchor: "pull_request.head.sha" }), { name: "AssertionError" });
console.log("GitHub-native audit contract passed positive and negative checks.");
