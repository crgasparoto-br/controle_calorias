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

assert_dom() {
  local name="$1"
  local url="$2"
  shift 2
  assert_dom_at_size "$name" "1366,768" "$url" "$@"
}

assert_dom_at_size() {
  local name="$1"
  local size="$2"
  local url="$3"
  shift 3
  local output="$OUTPUT_DIR/$name.html"
  "$CHROME_BIN" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --virtual-time-budget=1800 \
    --window-size="$size" \
    --dump-dom \
    "$url" > "$output"
  for expected in "$@"; do
    if ! grep -Fq "$expected" "$output"; then
      echo "Expected DOM content was not rendered for $name: $expected"
      exit 1
    fi
  done
}

BASE_URL="http://127.0.0.1:${PORT}/professional"
PATIENTS_URL="http://127.0.0.1:${PORT}/professional/patients"
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

capture "patients-desktop-1440x900" "1440,900" "$PATIENTS_URL"
capture "patients-notebook-1366x768" "1366,768" "$PATIENTS_URL"
capture "patients-tablet-1024x768" "1024,768" "$PATIENTS_URL"
capture "patients-mobile-390x844" "390,844" "$PATIENTS_URL"
capture "patients-empty-mobile-390x844" "390,844" "$PATIENTS_URL?state=empty"
capture "patients-error-desktop-1366x768" "1366,768" "$PATIENTS_URL?state=portfolio-error"

assert_dom \
  "complete-page-3" \
  "$BASE_URL?priorities=all&page=3" \
  "Todas as prioridades" \
  "Página 3" \
  "Paciente com nome extenso para validação visual número 101"
assert_dom \
  "sidebar-collapsed" \
  "$BASE_URL?sidebar=collapsed" \
  'data-state="collapsed"' \
  'data-collapsible="icon"'
assert_dom \
  "patients-privacy" \
  "$PATIENTS_URL" \
  "Solicitar acesso" \
  "Mariana de Almeida Vasconcelos e Silva" \
  "Aguardando autorização" \
  "Solicitação recusada" \
  "Acesso revogado" \
  "Dados pessoais e clínicos disponíveis após autorização"
assert_dom_at_size \
  "patients-tablet-layout" \
  "1024,768" \
  "$PATIENTS_URL" \
  'data-visual-horizontal-overflow="false"' \
  'data-visual-patient-cards-contained="true"' \
  'data-visual-primary-action-visible="true"'
assert_dom_at_size \
  "patients-mobile-layout" \
  "390,844" \
  "$PATIENTS_URL" \
  'data-visual-horizontal-overflow="false"' \
  'data-visual-patient-cards-contained="true"'

cat > "$OUTPUT_DIR/manifest.txt" <<MANIFEST
routes=/professional,/professional/patients
commit=${GITHUB_SHA:-local}
scenarios=main,complete-page-3,loading,empty,priority-error,portfolio-error,sidebar-collapsed,patients-main,patients-empty,patients-error
viewports=1440x900,1366x768,1024x768,390x844,390x1200
source=actual ProfessionalAreaPage, ProfessionalLayout and ProfessionalPatients with deterministic tRPC and auth fixtures
interaction=sidebar collapsed through the actual sidebar trigger
assertions=complete page 3 content, collapsed sidebar DOM state, patient authorization actions, privacy copy, no horizontal overflow and visible patient action at tablet width
MANIFEST

ls -lh "$OUTPUT_DIR"
