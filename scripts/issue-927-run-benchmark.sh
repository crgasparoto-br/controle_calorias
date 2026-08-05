#!/usr/bin/env bash
set -euo pipefail
node --experimental-strip-types scripts/issue-927-multi-provider-benchmark.ts "$@"
