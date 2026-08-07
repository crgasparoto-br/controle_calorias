#!/usr/bin/env bash
set -euo pipefail
exec pnpm benchmark:ai:multi-provider -- "$@"
