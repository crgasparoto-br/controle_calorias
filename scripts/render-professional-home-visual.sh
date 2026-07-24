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
  if curl --fail --silent "http://127.0.0.1:${PORT}" > /dev/null; then
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
    --virtual-time-budget=1500 \
    --window-size="$size" \
    --screenshot="$OUTPUT_DIR/$name.png" \
    "$url"
  test -s "$OUTPUT_DIR/$name.png"
}

BASE_URL="http://127.0.0.1:${PORT}"
capture "main-desktop-1366x768" "1366,768" "$BASE_URL/"
capture "main-mobile-390x844" "390,844" "$BASE_URL/"
capture "empty-desktop-1366x768" "1366,768" "$BASE_URL/?state=empty"
capture "priority-error-desktop-1366x768" "1366,768" "$BASE_URL/?state=priority-error"
capture "portfolio-error-mobile-390x844" "390,844" "$BASE_URL/?state=portfolio-error"

cat > "$OUTPUT_DIR/manifest.txt" <<EOF
route=/professional
commit=${GITHUB_SHA:-local}
scenarios=main,empty,priority-error,portfolio-error
viewports=1366x768,390x844
source=actual ProfessionalHome component with deterministic tRPC fixtures
EOF

ls -lh "$OUTPUT_DIR"
