#!/usr/bin/env bash
# Collect 24 Vitest, one Python preflight and one node:test JUnit shard; no synthetic passes.
set -euo pipefail
: "${EVIDENCE_DIR:?EVIDENCE_DIR must be provided by the trusted workflow}"
shards="$EVIDENCE_DIR/junit-shards"
mkdir -p "$shards"
# The trusted workflow runs the Python governance tests first. Keep their
# original JUnit as shard 25, then add the actual Node adversarial controls.
test -s "$EVIDENCE_DIR/pytest-exact-head.xml"
mv -- "$EVIDENCE_DIR/pytest-exact-head.xml" "$shards/shard-25.xml"
export SOLVERIT_JUNIT_DIR="$shards"
export VITEST_LOG_PATH="$EVIDENCE_DIR/vitest-shards.log"
export NODE_ENV=test
export PROFESSIONAL_ACCESS_RECEIPT_STORAGE=memory
node scripts/run-vitest-shards.mjs
# node:test emits testcase directly beneath testsuites; normalize its actual
# JUnit structure without inventing case outcomes or weakening the merger.
node --test --test-reporter=junit \
  scripts/ci-classifier.test.mjs \
  scripts/merge-vitest-junit.test.mjs \
  scripts/run-vitest-shards.test.mjs > "$EVIDENCE_DIR/node-test-raw-junit.xml"
python scripts/wrap-node-junit.py --input "$EVIDENCE_DIR/node-test-raw-junit.xml" \
  --out "$shards/shard-26.xml"
python scripts/merge-vitest-junit.py --dir "$shards" --out "$EVIDENCE_DIR/pytest-exact-head.xml" --shards 26
