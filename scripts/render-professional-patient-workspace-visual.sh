#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="artifacts/professional-patient-workspace"
PORT="4175"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

pnpm exec vite build --config visual-tests/professional-patient-workspace/vite.config.ts
pnpm exec vite preview \
  --config visual-tests/professional-patient-workspace/vite.config.ts \
  --host 127.0.0.1 \
  --port "$PORT" \
  > /tmp/professional-patient-workspace-visual-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${PORT}/professional/patients/1" > /dev/null; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    cat /tmp/professional-patient-workspace-visual-server.log
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
    --virtual-time-budget=2500 \
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
    --virtual-time-budget=2500 \
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

BASE_URL="http://127.0.0.1:${PORT}/professional/patients/1"
ASSESSMENT_URL="${BASE_URL}/assessment"
GUIDANCE_URL="${BASE_URL}/guidance"
NOTES_URL="${BASE_URL}/notes"
HISTORY_URL="${BASE_URL}/history"

capture "summary-desktop-1440x900" "1440,900" "$BASE_URL"
capture "summary-notebook-1366x768" "1366,768" "$BASE_URL"
capture "summary-tablet-1024x768" "1024,768" "$BASE_URL"
capture "summary-mobile-390x844" "390,844" "$BASE_URL"
capture "assessment-desktop-1440x900" "1440,900" "$ASSESSMENT_URL"
capture "guidance-notebook-1366x768" "1366,768" "$GUIDANCE_URL"
capture "notes-mobile-390x1200" "390,1200" "$NOTES_URL"
capture "history-desktop-1366x768" "1366,768" "$HISTORY_URL"
capture "paused-assessment-1366x768" "1366,768" "$ASSESSMENT_URL?state=paused"
capture "ended-summary-390x1200" "390,1200" "$BASE_URL?state=ended"
capture "loading-tablet-1024x768" "1024,768" "$BASE_URL?state=patient-loading"
capture "error-desktop-1366x768" "1366,768" "$BASE_URL?state=patient-error"

assert_dom \
  "summary" \
  "$BASE_URL" \
  "Workspace do paciente" \
  "Mariana de Almeida Vasconcelos e Silva" \
  "Próximas ações" \
  "Pendências operacionais" \
  "Registro que exige revisão" \
  "Resumo" \
  "Avaliação" \
  "Metas" \
  "Orientações" \
  "Anotações" \
  "Relatórios" \
  "Mensagens" \
  "Histórico"
assert_dom \
  "assessment" \
  "$ASSESSMENT_URL" \
  "Nova versão da avaliação" \
  "Versões anteriores" \
  "Versão 2" \
  "Salvar nova versão"
assert_dom \
  "guidance" \
  "$GUIDANCE_URL" \
  "Nova orientação ao paciente" \
  "Orientações registradas" \
  "Nutricionista de validação"
assert_dom \
  "notes" \
  "$NOTES_URL" \
  "Nova anotação privada" \
  "Anotações anteriores" \
  "Paciente relatou boa adesão"
assert_dom \
  "history" \
  "$HISTORY_URL" \
  "Linha do tempo profissional" \
  "Orientação registrada para o paciente" \
  "Página 1"
assert_dom \
  "paused" \
  "$ASSESSMENT_URL?state=paused" \
  "Novas avaliações ficam bloqueadas enquanto o acompanhamento não estiver ativo."
assert_dom \
  "ended" \
  "$BASE_URL?state=ended" \
  "O acompanhamento foi encerrado. O histórico permanece disponível para auditoria."
assert_dom \
  "loading" \
  "$BASE_URL?state=patient-loading" \
  "Carregando prontuário e contexto do paciente..."
assert_dom \
  "error" \
  "$BASE_URL?state=patient-error" \
  "Não foi possível carregar o prontuário" \
  "Tentar novamente"
assert_dom_at_size \
  "tablet-layout" \
  "1024,768" \
  "$BASE_URL" \
  'data-visual-horizontal-overflow="false"' \
  'data-visual-patient-subnav-contained="true"' \
  'data-visual-patient-header-visible="true"'
assert_dom_at_size \
  "mobile-layout" \
  "390,844" \
  "$BASE_URL" \
  'data-visual-horizontal-overflow="false"' \
  'data-visual-patient-subnav-contained="true"' \
  'data-visual-patient-subnav-scrollable="true"' \
  'data-visual-patient-header-visible="true"'

cat > "$OUTPUT_DIR/manifest.txt" <<MANIFEST
routes=/professional/patients/1,/professional/patients/1/assessment,/professional/patients/1/guidance,/professional/patients/1/notes,/professional/patients/1/history
head_sha=${GITHUB_HEAD_SHA:-${GITHUB_SHA:-local}}
checkout_sha=${GITHUB_SHA:-local}
scenarios=summary,assessment,guidance,notes,history,paused,ended,loading,error
viewports=1440x900,1366x768,1024x768,390x844,390x1200
source=actual ProfessionalAreaPage, ProfessionalLayout and ProfessionalPatientWorkspace with deterministic auth and tRPC transport fixtures
interaction=canonical patient deep links and internal workspace composition
assertions=patient identity and internal areas, operational alert, versioned assessment, guidance and private note separation, stable history, paused and ended restrictions, loading and recoverable error states, contained horizontal subnavigation, mobile subnav scrolling and no page-level horizontal overflow
MANIFEST

ls -lh "$OUTPUT_DIR"
