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

CHROME_COMMON_ARGS=(
  --headless=new
  --no-sandbox
  --disable-gpu
  --disable-dev-shm-usage
)

print_chrome_diagnostics() {
  local name="$1"
  local attempt="$2"
  local log_file="$3"
  echo "Chrome attempt ${attempt} failed for ${name}." >&2
  if [ -s "$log_file" ]; then
    tail -n 80 "$log_file" >&2
  fi
}

capture() {
  local name="$1"
  local size="$2"
  local url="$3"
  local output="$OUTPUT_DIR/$name.png"
  local log_file="$OUTPUT_DIR/$name.chrome.log"

  for attempt in 1 2 3; do
    local profile_dir
    profile_dir="$(mktemp -d)"
    rm -f "$output" "$log_file"
    if "$CHROME_BIN" \
      "${CHROME_COMMON_ARGS[@]}" \
      --hide-scrollbars \
      --force-device-scale-factor=1 \
      --virtual-time-budget=1800 \
      --window-size="$size" \
      --user-data-dir="$profile_dir" \
      --screenshot="$output" \
      "$url" > "$log_file" 2>&1 && test -s "$output"; then
      rm -rf "$profile_dir" "$log_file"
      return 0
    fi
    rm -rf "$profile_dir"
    print_chrome_diagnostics "$name" "$attempt" "$log_file"
    sleep "$attempt"
  done

  echo "Chrome could not capture $name after 3 attempts." >&2
  exit 1
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
  local temporary_output="$output.tmp"
  local log_file="$OUTPUT_DIR/$name.chrome.log"

  for attempt in 1 2 3; do
    local profile_dir
    profile_dir="$(mktemp -d)"
    rm -f "$output" "$temporary_output" "$log_file"
    if "$CHROME_BIN" \
      "${CHROME_COMMON_ARGS[@]}" \
      --virtual-time-budget=1800 \
      --window-size="$size" \
      --user-data-dir="$profile_dir" \
      --dump-dom \
      "$url" > "$temporary_output" 2> "$log_file" && test -s "$temporary_output"; then
      mv "$temporary_output" "$output"
      rm -rf "$profile_dir" "$log_file"
      break
    fi
    rm -rf "$profile_dir"
    print_chrome_diagnostics "$name" "$attempt" "$log_file"
    if [ "$attempt" -eq 3 ]; then
      echo "Chrome could not render DOM for $name after 3 attempts." >&2
      exit 1
    fi
    sleep "$attempt"
  done

  for expected in "$@"; do
    if ! grep -Fq "$expected" "$output"; then
      echo "Expected DOM content was not rendered for $name: $expected"
      exit 1
    fi
  done
}

assert_dom_not_contains() {
  local name="$1"
  shift
  local output="$OUTPUT_DIR/$name.html"
  test -s "$output"
  for unexpected in "$@"; do
    if grep -Fq "$unexpected" "$output"; then
      echo "Protected DOM content was rendered for $name: $unexpected"
      exit 1
    fi
  done
}

BASE_URL="http://127.0.0.1:${PORT}/professional"
PATIENTS_URL="http://127.0.0.1:${PORT}/professional/patients"
REPORTS_URL="http://127.0.0.1:${PORT}/professional/reports"
SETTINGS_URL="http://127.0.0.1:${PORT}/professional/settings"
ACCESS_REQUESTS_URL="http://127.0.0.1:${PORT}/settings/professional-access-requests"
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
capture "reports-desktop-1440x900" "1440,900" "$REPORTS_URL"
capture "reports-notebook-1366x768" "1366,768" "$REPORTS_URL"
capture "reports-tablet-1024x768" "1024,768" "$REPORTS_URL"
capture "reports-mobile-390x844" "390,844" "$REPORTS_URL"
capture "settings-desktop-1440x900" "1440,900" "$SETTINGS_URL"
capture "settings-tablet-1024x768" "1024,768" "$SETTINGS_URL"
capture "settings-mobile-390x844" "390,844" "$SETTINGS_URL"
capture "access-requests-error-desktop-1366x768" "1366,768" "$ACCESS_REQUESTS_URL?state=access-error"
capture "access-requests-error-mobile-390x844" "390,844" "$ACCESS_REQUESTS_URL?state=access-error"

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
  "Solicitação aguardando confirmação" \
  "Aguardando autorização" \
  "Solicitação recusada" \
  "Acesso revogado" \
  "Dados pessoais e clínicos disponíveis após autorização"
assert_dom_not_contains \
  "patients-privacy" \
  "João Pereira" \
  "Beatriz Fernandes" \
  "Carlos Henrique"
assert_dom \
  "reports-aggregate" \
  "$REPORTS_URL" \
  "Relatórios da carteira" \
  "Ativos com registros no período" \
  "Sem registros no período" \
  "Revisões pendentes" \
  "Pesagens pendentes" \
  "Distribuição do acompanhamento" \
  "Acompanhamentos ativos com ao menos uma refeição confirmada" \
  "Autorizações aprovadas sem refeição confirmada"
assert_dom_at_size \
  "reports-mobile-layout" \
  "390,844" \
  "$REPORTS_URL" \
  'data-visual-horizontal-overflow="false"'
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
assert_dom \
  "settings-product-labels" \
  "$SETTINGS_URL" \
  "Configurações profissionais" \
  "Painel profissional" \
  "Carteira de pacientes" \
  "Prontuário e acompanhamento" \
  "Metas profissionais" \
  "Pendências operacionais" \
  "Mensagens profissionais" \
  "Relatórios profissionais" \
  "Assistência por IA" \
  "Configurações profissionais"
assert_dom_not_contains \
  "settings-product-labels" \
  "professional_" \
  "contabilizado pelo billing" \
  "provider" \
  "Não informado"
assert_dom_at_size \
  "settings-mobile-layout" \
  "390,844" \
  "$SETTINGS_URL" \
  'data-visual-horizontal-overflow="false"'
assert_dom_at_size \
  "access-requests-error-mobile-layout" \
  "390,844" \
  "$ACCESS_REQUESTS_URL?state=access-error" \
  'role="alert"' \
  "Tentar novamente" \
  "O restante das configurações permanece disponível" \
  'data-visual-horizontal-overflow="false"'

cat > "$OUTPUT_DIR/manifest.txt" <<MANIFEST
routes=/professional,/professional/patients,/professional/reports,/professional/settings,/settings/professional-access-requests
commit=${GITHUB_SHA:-local}
scenarios=main,complete-page-3,loading,empty,priority-error,portfolio-error,sidebar-collapsed,patients-main,patients-empty,patients-error,reports-aggregate,settings-product-labels,settings-responsive,access-requests-error-retry
viewports=1440x900,1366x768,1024x768,390x844,390x1200
source=actual ProfessionalAreaPage, ProfessionalLayout, ProfessionalPatients, ProfessionalSettingsPage and PatientAccessRequestsCard with deterministic tRPC and auth fixtures
interaction=sidebar collapsed through the actual sidebar trigger
assertions=complete page 3 content, collapsed sidebar DOM state, patient authorization actions, privacy-neutral non-approved identities, aggregate report definitions, complete entitlement product labels, recoverable settings error with retry and no horizontal overflow
MANIFEST

ls -lh "$OUTPUT_DIR"
