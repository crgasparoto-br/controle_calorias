#!/usr/bin/env bash
# Collect 24 Vitest, local Python, node:test and pinned official session suites.
# All inputs are executed test cases; no synthetic or previously cached results.
set -euo pipefail
: "${HANDOFF_TOOLING:?HANDOFF_TOOLING must be the trusted Skill checkout}"
# Reject incomplete or redirected upstream sources *before* moving the Python
# JUnit or starting the expensive Vitest suite. The checkout itself is pinned
# by the trusted reusable workflow; this checks what it will actually execute.
if [[ -L "$HANDOFF_TOOLING" || -L "$HANDOFF_TOOLING/tests" || ! -d "$HANDOFF_TOOLING/tests" ]]; then
  echo "BLOCK: unsafe or missing pinned official test directory" >&2
  exit 2
fi
for suite in \
  test_session_review.py \
  test_session_review_dossier.py \
  test_session_review_runner.py \
  test_session_review_workflows.py \
  test_session_certificate_event.py \
  test_plan_session_ruleset_m2.py; do
  source="$HANDOFF_TOOLING/tests/$suite"
  if [[ -L "$source" || ! -f "$source" || ! -s "$source" ]]; then
    echo "BLOCK: missing or unsafe pinned official suite: $suite" >&2
    exit 2
  fi
done
: "${EVIDENCE_DIR:?EVIDENCE_DIR must be provided by the trusted workflow}"
shards="$EVIDENCE_DIR/junit-shards"
mkdir -p "$shards"
# The trusted workflow runs the Python governance tests first.
test -s "$EVIDENCE_DIR/pytest-exact-head.xml"
mv -- "$EVIDENCE_DIR/pytest-exact-head.xml" "$shards/shard-25.xml"
export SOLVERIT_JUNIT_DIR="$shards"
export VITEST_LOG_PATH="$EVIDENCE_DIR/vitest-shards.log"
export NODE_ENV=test
export PROFESSIONAL_ACCESS_RECEIPT_STORAGE=memory
node scripts/run-vitest-shards.mjs
# node:test emits testcase directly beneath testsuites. Normalize real events.
node --test --test-reporter=junit \
  scripts/ci-classifier.test.mjs \
  scripts/merge-vitest-junit.test.mjs \
  scripts/run-vitest-shards.test.mjs > "$EVIDENCE_DIR/node-test-raw-junit.xml"
python scripts/wrap-node-junit.py --input "$EVIDENCE_DIR/node-test-raw-junit.xml" \
  --out "$shards/shard-26.xml"
# Review-policy, comment, SHA, identity and ruleset adversarial tests must be
# represented by executed JUnit too, not only by a separate green preflight.
# Run the same six suites as the pinned preflight, from the immutable official
# Skill checkout, under the already installed hashed tooling dependencies.
(
  cd -- "$HANDOFF_TOOLING"
  export PYTHONPATH="$PWD/scripts:$PWD/entregar-issue/scripts:$PWD/auditar-issue/scripts${PYTHONPATH:+:$PYTHONPATH}"
  python -m pytest -q \
    tests/test_session_review.py \
    tests/test_session_review_dossier.py \
    tests/test_session_review_runner.py \
    tests/test_session_review_workflows.py \
    tests/test_session_certificate_event.py \
    tests/test_plan_session_ruleset_m2.py \
    --junitxml="$shards/shard-27.xml"
)
# A missing/failed/empty shard blocks publication, and skipped cases stay skips.
python scripts/merge-vitest-junit.py --dir "$shards" \
  --out "$EVIDENCE_DIR/pytest-exact-head.xml" --shards 27
