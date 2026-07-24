#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="artifacts/professional-home"
PORT="4174"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

pnpm exec vite build --config visual-tests/professional-home/vite.config.ts
pnpm exec vite preview \
  --config visual-tests/professional-home/vite.config.ts \
  --host 127.0.0.1 \
  --port "$PORT" \
  > /tmp/professional-home-visual-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${PORT}/professional" > /dev/null; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    cat /tmp/professional-home-visual-server.log
    exit 1
  fi
  sleep 1
done

CHROME_BIN="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROME_BIN" ]; then
  echo "Chrome or Chromium was not found on the runner."
  exit 1
fi

capture() {
  local name="$1"
  local size="$2"
  local url="$3"
  "$CHROME_BIN" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --virtual-time-budget=1800 \
    --window-size="$size" \
    --screenshot="$OUTPUT_DIR/$name.png" \
    "$url"
  test -s "$OUTPUT_DIR/$name.png"
}

BASE_URL="http://127.0.0.1:${PORT}/professional"
capture "main-desktop-1440x900" "1440,900" "$BASE_URL"
capture "main-notebook-1366x768" "1366,768" "$BASE_URL"
capture "main-tablet-1024x768" "1024,768" "$BASE_URL"
capture "main-mobile-390x844" "390,844" "$BASE_URL"
capture "sidebar-collapsed-1366x768" "1366,768" "$BASE_URL?sidebar=collapsed"
capture "complete-page-3-1366x768" "1366,768" "$BASE_URL?priorities=all&page=3"
capture "loading-tablet-1024x768" "1024,768" "$BASE_URL?state=loading"
capture "empty-desktop-1366x768" "1366,768" "$BASE_URL?state=empty"
capture "priority-error-desktop-1366x768" "1366,768" "$BASE_URL?state=priority-error"
capture "portfolio-error-mobile-390x844" "390,844" "$BASE_URL?state=portfolio-error"
capture "portfolio-error-mobile-390x1200" "390,1200" "$BASE_URL?state=portfolio-error"

cat > "$OUTPUT_DIR/manifest.txt" <<EOF
route=/professional
commit=${GITHUB_SHA:-local}
scenarios=main,complete-page-3,loading,empty,priority-error,portfolio-error,sidebar-collapsed
viewports=1440x900,1366x768,1024x768,390x844,390x1200
source=actual ProfessionalAreaPage and ProfessionalLayout with deterministic tRPC and auth fixtures
interaction=sidebar collapsed through the actual sidebar trigger
EOF

ls -lh "$OUTPUT_DIR"
