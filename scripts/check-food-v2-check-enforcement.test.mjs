import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyTiDbCheckEnforcement } from "./check-food-v2-check-enforcement.mjs";

test("Food V2 TiDB CHECK preflight accepts ON only", () => {
  assert.equal(verifyTiDbCheckEnforcement([{ Variable_name: "tidb_enable_check_constraint", Value: "ON" }]), true);
  assert.throws(() => verifyTiDbCheckEnforcement([{ Variable_name: "tidb_enable_check_constraint", Value: "OFF" }]), /OFF/);
  assert.throws(() => verifyTiDbCheckEnforcement([]), /unavailable/);
});
