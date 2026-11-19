#!/usr/bin/env bash
# Execute all 24 Vitest shards at the existing bounded concurrency, with factual JUnit.
set -euo pipefail
: "${EVIDENCE_DIR:?EVIDENCE_DIR must be provided by the trusted workflow}"
shards="$EVIDENCE_DIR/junit-shards"
mkdir -p "$shards"
export SOLVERIT_JUNIT_DIR="$shards"
export VITEST_LOG_PATH="$EVIDENCE_DIR/vitest-shards.log"
export NODE_ENV=test
export PROFESSIONAL_ACCESS_RECEIPT_STORAGE=memory
node scripts/run-vitest-shards.mjs
python scripts/merge-vitest-junit.py --dir "$shards" --out "$EVIDENCE_DIR/pytest-exact-head.xml" --shards 24
