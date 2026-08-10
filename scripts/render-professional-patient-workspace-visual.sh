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
  local profile
  profile="$(mktemp -d)"
  if ! timeout --signal=TERM --kill-after=5s 90s "$CHROME_BIN" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --user-data-dir="$profile" \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --virtual-time-budget=2500 \
    --window-size="$size" \
    --screenshot="$OUTPUT_DIR/$name.png" \
    "$url"; then
    rm -rf "$profile"
    return 1
  fi
  rm -rf "$profile"
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
  local profile
  profile="$(mktemp -d)"
  if ! timeout --signal=TERM --kill-after=5s 90s "$CHROME_BIN" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --user-data-dir="$profile" \
    --virtual-time-budget=2500 \
    --window-size="$size" \
    --dump-dom \
    "$url" > "$output"; then
    rm -rf "$profile"
    return 1
  fi
  rm -rf "$profile"
  for expected in "$@"; do
    if ! grep -Fq "$expected" "$output"; then
      echo "Expected DOM content was not rendered for $name: $expected"
      exit 1
    fi
  done
}

BASE_URL="http://127.0.0.1:${PORT}/professional/patients/1"
ASSESSMENT_URL="${BASE_URL}/assessment"
GOALS_URL="${BASE_URL}/goals"
GOALS_PAUSED_URL="${GOALS_URL}?goal-transition=paused"
GUIDANCE_URL="${BASE_URL}/guidance"
NOTES_URL="${BASE_URL}/notes"
HISTORY_URL="${BASE_URL}/history"
REPORTS_URL="${BASE_URL}/reports"
DRAFT_BACK_CANCEL_URL="${ASSESSMENT_URL}?draft-history=back-cancel"
DRAFT_BACK_ACCEPT_URL="${ASSESSMENT_URL}?draft-history=back-accept"
DRAFT_FORWARD_CANCEL_URL="${ASSESSMENT_URL}?draft-history=forward-cancel"
DRAFT_FORWARD_ACCEPT_URL="${ASSESSMENT_URL}?draft-history=forward-accept"

capture "summary-desktop-1440x900" "1440,900" "$BASE_URL"
capture "summary-notebook-1366x768" "1366,768" "$BASE_URL"
capture "summary-tablet-1024x768" "1024,768" "$BASE_URL"
capture "summary-mobile-390x844" "390,844" "$BASE_URL"
capture "assessment-desktop-1440x900" "1440,900" "$ASSESSMENT_URL"
capture "guidance-notebook-1366x768" "1366,768" "$GUIDANCE_URL"
capture "notes-mobile-390x1200" "390,1200" "$NOTES_URL"
capture "history-desktop-1366x768" "1366,768" "$HISTORY_URL"
capture "reports-desktop-1440x900" "1440,900" "$REPORTS_URL"
capture "reports-notebook-1366x768" "1366,768" "$REPORTS_URL"
capture "reports-tablet-1024x768" "1024,768" "$REPORTS_URL"
capture "reports-mobile-390x1200" "390,1200" "$REPORTS_URL"
capture "paused-assessment-1366x768" "1366,768" "$ASSESSMENT_URL?state=paused"
capture "ended-history-390x1200" "390,1200" "$HISTORY_URL?state=ended"
capture "loading-tablet-1024x768" "1024,768" "$BASE_URL?state=patient-loading"
capture "error-desktop-1366x768" "1366,768" "$BASE_URL?state=patient-error"

GOAL_VIEWPORTS=(
  "desktop-1440x900|1440,900"
  "notebook-1366x768|1366,768"
  "tablet-1024x768|1024,768"
  "mobile-390x844|390,844"
)
for spec in "${GOAL_VIEWPORTS[@]}"; do
  IFS='|' read -r label size <<< "$spec"
  capture "goals-active-${label}" "$size" "$GOALS_URL"
  capture "goals-paused-${label}" "$size" "$GOALS_PAUSED_URL"
done

assert_dom \
  "summary" \
  "$BASE_URL" \
  "Workspace do paciente" \
  "Mariana de Almeida Vasconcelos e Silva" \
  "Orientação ao paciente registrada" \
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
  "goals-active" \
  "$GOALS_URL" \
  "Meta profissional oficial" \
  "Versão 3 ativa" \
  "Histórico de metas oficiais" \
  "Nutricionista de validação" \
  "Origem: Profissional" \
  "Substitui a versão 2" \
  "Segunda-feira · 2 semanas" \
  "2450 kcal · 192 g proteínas · 315 g carboidratos · 82 g gorduras" \
  "O paciente solicitou revisão desta meta." \
  "Exceções por dia" \
  "Dia da exceção 1" \
  "Duração da exceção 1" \
  "Remover exceção 1" \
  "Ativar nova versão" \
  "Notificação pendente (2 tentativa(s))."
assert_dom \
  "goals-paused" \
  "$GOALS_PAUSED_URL" \
  "Acompanhamento pausado" \
  "Meta profissional oficial" \
  "Exceções por dia" \
  "Dia da exceção 1" \
  "Ativar nova versão" \
  "Notificação pendente (2 tentativa(s))."
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
  "Orientação ao paciente registrada" \
  "Nova versão da avaliação registrada" \
  "Acompanhamento iniciado" \
  "Página 1"
assert_dom \
  "reports-individual" \
  "$REPORTS_URL" \
  "Relatório individual" \
  "Análise de Mariana de Almeida Vasconcelos e Silva" \
  "Diagnóstico nutricional do período" \
  "Pendências operacionais" \
  "Assistência por IA" \
  "Período analisado" \
  "A IA não envia mensagens nem altera dados automaticamente"
for spec in "desktop-1440x900|1440,900" "notebook-1366x768|1366,768"; do
  IFS='|' read -r label size <<< "$spec"
  assert_dom_at_size \
    "reports-individual-title-layout-${label}" \
    "$size" \
    "$REPORTS_URL" \
    'data-visual-report-title-contained="true"' \
    'data-visual-report-title-not-overlapped="true"' \
    'data-visual-report-selector-contained="true"'
done
assert_dom_at_size \
  "reports-individual-mobile-layout" \
  "390,1200" \
  "$REPORTS_URL" \
  'data-visual-horizontal-overflow="false"' \
  'data-visual-patient-subnav-contained="true"'
assert_dom \
  "paused" \
  "$ASSESSMENT_URL?state=paused" \
  "Novas avaliações ficam bloqueadas enquanto o acompanhamento não estiver ativo."
assert_dom \
  "ended" \
  "$HISTORY_URL?state=ended" \
  "Acompanhamento encerrado" \
  "Encerrado" \
  "Linha do tempo profissional" \
  "Histórico"
for forbidden in "Ativo" "Paciente em acompanhamento" "Ciclo de acompanhamento" "Salvar nova versão" "Nova orientação ao paciente" "Nova anotação privada"; do
  if grep -Fq "$forbidden" "$OUTPUT_DIR/ended.html"; then
    echo "Ended tracking exposed a non-audit surface: $forbidden"
    exit 1
  fi
done
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

for spec in "${GOAL_VIEWPORTS[@]}"; do
  IFS='|' read -r label size <<< "$spec"
  assert_dom_at_size \
    "goals-active-layout-${label}" \
    "$size" \
    "$GOALS_URL" \
    'data-visual-horizontal-overflow="false"' \
    'data-visual-goals-card-contained="true"' \
    'data-visual-goals-controls-contained="true"' \
    'data-visual-goals-fields-labeled="true"' \
    'data-visual-goals-exception-visible="true"' \
    'data-visual-goals-primary-action-disabled="false"' \
    'data-visual-goals-all-mutations-disabled="false"' \
    'data-visual-goals-tracking-state="active"'
  assert_dom_at_size \
    "goals-paused-layout-${label}" \
    "$size" \
    "$GOALS_PAUSED_URL" \
    'data-visual-horizontal-overflow="false"' \
    'data-visual-goals-card-contained="true"' \
    'data-visual-goals-controls-contained="true"' \
    'data-visual-goals-fields-labeled="true"' \
    'data-visual-goals-exception-visible="true"' \
    'data-visual-goals-primary-action-disabled="true"' \
    'data-visual-goals-all-mutations-disabled="true"' \
    'data-visual-goals-tracking-state="paused"'
done

assert_dom_at_size \
  "draft-history-back-cancel" \
  "1366,768" \
  "$DRAFT_BACK_CANCEL_URL" \
  'data-visual-draft-history-scenario="back-cancel"' \
  'data-visual-draft-history-confirmations="1"' \
  'data-visual-draft-history-path="/professional/patients/1/assessment"' \
  'data-visual-draft-history-preserved="true"'
assert_dom_at_size \
  "draft-history-back-accept" \
  "1366,768" \
  "$DRAFT_BACK_ACCEPT_URL" \
  'data-visual-draft-history-scenario="back-accept"' \
  'data-visual-draft-history-confirmations="1"' \
  'data-visual-draft-history-path="/professional/patients/1"' \
  'data-visual-draft-history-preserved="false"'
assert_dom_at_size \
  "draft-history-forward-cancel" \
  "1366,768" \
  "$DRAFT_FORWARD_CANCEL_URL" \
  'data-visual-draft-history-scenario="forward-cancel"' \
  'data-visual-draft-history-confirmations="1"' \
  'data-visual-draft-history-path="/professional/patients/1/assessment"' \
  'data-visual-draft-history-preserved="true"'
assert_dom_at_size \
  "draft-history-forward-accept" \
  "1366,768" \
  "$DRAFT_FORWARD_ACCEPT_URL" \
  'data-visual-draft-history-scenario="forward-accept"' \
  'data-visual-draft-history-confirmations="1"' \
  'data-visual-draft-history-path="/professional/patients/1/notes"' \
  'data-visual-draft-history-preserved="false"'

cat > "$OUTPUT_DIR/manifest.txt" <<MANIFEST
routes=/professional/patients/1,/professional/patients/1/assessment,/professional/patients/1/goals,/professional/patients/1/guidance,/professional/patients/1/notes,/professional/patients/1/history,/professional/patients/1/reports
head_sha=${GITHUB_HEAD_SHA:-${GITHUB_SHA:-local}}
checkout_sha=${GITHUB_SHA:-local}
scenarios=summary,assessment,goals-active,goals-paused-with-seeded-exception,guidance,notes,history,reports-individual,paused,ended,loading,error,draft-history-back-cancel,draft-history-back-accept,draft-history-forward-cancel,draft-history-forward-accept
viewports=1440x900,1366x768,1024x768,390x844,390x1200
source=actual ProfessionalAreaPage, ProfessionalLayout, ProfessionalPatientWorkspace and ProfessionalReportsWorkspace with deterministic auth and tRPC transport fixtures
interaction=canonical patient deep links, internal workspace composition, individual report and AI context, goal exception creation and active-to-paused transition
assertions=patient identity, summarized last activity and internal areas, operational alert, versioned assessment, active and paused official goal layout with labeled exception controls and complete mutation blocking, guidance and private note separation, stable history pagination, individual report patient and period context with AI panel, paused restrictions, ended history routing, loading and recoverable error states, real Chromium back and forward navigation preserving cancelled drafts and discarding accepted drafts, contained horizontal subnavigation, mobile subnav scrolling and no page-level horizontal overflow
MANIFEST

ls -lh "$OUTPUT_DIR"
