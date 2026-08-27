#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="artifacts/billing-admin"
PORT="4182"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

pnpm exec vite build --config visual-tests/billing-admin/vite.config.ts
pnpm exec vite preview \
  --config visual-tests/billing-admin/vite.config.ts \
  --host 127.0.0.1 \
  --port "$PORT" \
  > /tmp/billing-admin-visual-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${PORT}/admin/billing" > /dev/null; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    cat /tmp/billing-admin-visual-server.log
    exit 1
  fi
  sleep 1
done

CHROME_BIN="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROME_BIN" ]; then
  echo "Chrome or Chromium was not found on the runner."
  exit 1
fi
export CHROME_BIN

capture() {
  local name="$1"
  local size="$2"
  local output="$OUTPUT_DIR/$name.png"
  local profile_dir
  profile_dir="$(mktemp -d)"
  "$CHROME_BIN" \
    --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=2200 \
    --window-size="$size" --user-data-dir="$profile_dir" \
    --screenshot="$output" "http://127.0.0.1:${PORT}/admin/billing" \
    > "$OUTPUT_DIR/$name.chrome.log" 2>&1
  rm -rf "$profile_dir" "$OUTPUT_DIR/$name.chrome.log"
  test -s "$output"
}

capture "desktop-1440x900" "1440,900"
capture "tablet-1024x768" "1024,768"
capture "mobile-390x844" "390,844"

node scripts/check-billing-admin-browser-evidence.mjs \
  "http://127.0.0.1:${PORT}/admin/billing" \
  "$OUTPUT_DIR/browser-evidence.json"

{
  echo "route=/admin/billing"
  echo "commit=${GITHUB_SHA:-local}"
  echo "viewports=1440x900,1024x768,390x844"
  echo "source=actual AdminBillingPage with deterministic authenticated-admin tRPC fixture"
  echo "controls=desktop/tablet/mobile root overflow, keyboard tab sequence, accessibility tree, 200 percent zoom observation"
  sha256sum "$OUTPUT_DIR"/*.png "$OUTPUT_DIR/browser-evidence.json"
} | tee "$OUTPUT_DIR/manifest.txt"

ls -lh "$OUTPUT_DIR"
