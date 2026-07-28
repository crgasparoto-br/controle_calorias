#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="artifacts/professional-messages"
PORT="4175"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
printf 'stage=initialized\n' > "$OUTPUT_DIR/stage.log"

pnpm exec vite build --config visual-tests/professional-patient-workspace/vite.config.ts
printf 'stage=built\n' >> "$OUTPUT_DIR/stage.log"
pnpm exec vite preview \
  --config visual-tests/professional-patient-workspace/vite.config.ts \
  --host 127.0.0.1 \
  --port "$PORT" \
  > /tmp/professional-messages-visual-server.log 2>&1 &
SERVER_PID=$!
cleanup() {
  status=$?
  cp /tmp/professional-messages-visual-server.log "$OUTPUT_DIR/server.log" 2>/dev/null || true
  printf 'stage=exit status=%s\n' "$status" >> "$OUTPUT_DIR/stage.log"
  kill "$SERVER_PID" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${PORT}/professional/messages" > /dev/null; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    cat /tmp/professional-messages-visual-server.log
    exit 1
  fi
  sleep 1
done
printf 'stage=server-ready\n' >> "$OUTPUT_DIR/stage.log"

CHROME_BIN="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROME_BIN" ]; then
  echo "Chrome or Chromium was not found on the runner."
  exit 1
fi

run_chrome_until_output() {
  local output="$1"
  local completion_pattern="$2"
  local stdout_target="$3"
  shift 3
  local profile log chrome_pid status
  profile="$(mktemp -d)"
  log="${output}.chrome.log"
  : > "$output"
  "$CHROME_BIN" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --user-data-dir="$profile" \
    "$@" >"$stdout_target" 2>"$log" &
  chrome_pid=$!
  status=1
  for _ in $(seq 1 180); do
    if [ -s "$output" ] && { [ -z "$completion_pattern" ] || grep -Fq "$completion_pattern" "$output"; }; then
      sleep 0.2
      status=0
      break
    fi
    if ! kill -0 "$chrome_pid" 2>/dev/null; then
      wait "$chrome_pid" || true
      if [ -s "$output" ] && { [ -z "$completion_pattern" ] || grep -Fq "$completion_pattern" "$output"; }; then
        status=0
      fi
      break
    fi
    sleep 0.5
  done
  kill "$chrome_pid" 2>/dev/null || true
  wait "$chrome_pid" 2>/dev/null || true
  rm -rf "$profile"
  if [ "$status" -ne 0 ]; then
    cat "$log" >&2
  fi
  return "$status"
}

capture() {
  local name="$1"
  local size="$2"
  local url="$3"
  local output="$OUTPUT_DIR/$name.png"
  run_chrome_until_output \
    "$output" \
    "" \
    /dev/null \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --virtual-time-budget=2500 \
    --window-size="$size" \
    --screenshot="$output" \
    "$url"
  test -s "$output"
}

assert_dom_at_size() {
  local name="$1"
  local size="$2"
  local url="$3"
  shift 3
  local output="$OUTPUT_DIR/$name.html"
  run_chrome_until_output \
    "$output" \
    "</html>" \
    "$output" \
    --virtual-time-budget=2500 \
    --window-size="$size" \
    --dump-dom \
    "$url"
  for expected in "$@"; do
    if ! grep -Fq "$expected" "$output"; then
      echo "Expected DOM content was not rendered for $name: $expected"
      exit 1
    fi
  done
}

INBOX_URL="http://127.0.0.1:${PORT}/professional/messages"
ACTIVE_URL="http://127.0.0.1:${PORT}/professional/patients/1/messages"
ENDED_URL="${ACTIVE_URL}?state=ended"

printf 'stage=capturing\n' >> "$OUTPUT_DIR/stage.log"
capture "messages-inbox-desktop-1440x900" "1440,900" "$INBOX_URL"
capture "messages-inbox-mobile-390x1200" "390,1200" "$INBOX_URL"
capture "messages-active-desktop-1440x900" "1440,900" "$ACTIVE_URL"
capture "messages-active-mobile-390x1200" "390,1200" "$ACTIVE_URL"
capture "messages-ended-mobile-390x1200" "390,1200" "$ENDED_URL"

printf 'stage=asserting\n' >> "$OUTPUT_DIR/stage.log"
assert_dom_at_size \
  "messages-inbox-desktop" \
  "1440,900" \
  "$INBOX_URL" \
  "Caixa de mensagens" \
  "Mariana de Almeida Vasconcelos e Silva" \
  "Carlos Eduardo Ribeiro" \
  "Abrir conversa" \
  "Falhas no envio" \
  "Sugestão da IA revisada" \
  'data-visual-horizontal-overflow="false"' \
  'data-visual-messages-inbox-composer-absent="true"' \
  'data-visual-messages-inbox-conversation-links="true"' \
  'data-visual-messages-inbox-filters="true"'
assert_dom_at_size \
  "messages-inbox-mobile" \
  "390,1200" \
  "$INBOX_URL" \
  "Caixa de mensagens" \
  "Abrir conversa" \
  'data-visual-horizontal-overflow="false"' \
  'data-visual-messages-inbox-composer-absent="true"'
assert_dom_at_size \
  "messages-active-desktop" \
  "1440,900" \
  "$ACTIVE_URL" \
  "Conversa com Mariana de Almeida Vasconcelos e Silva" \
  "Nova mensagem" \
  "Mensagem do paciente" \
  "Por Nutricionista de validação" \
  "Tentar novamente" \
  "Salvar rascunho" \
  "Disponibilizar na web" \
  "Enviar por WhatsApp" \
  'data-visual-horizontal-overflow="false"' \
  'data-visual-active-message-composer-editable="true"' \
  'data-visual-active-message-retry-visible="true"' \
  'data-visual-active-message-actions-enabled="true"' \
  'data-visual-active-message-controls-contained="true"'
assert_dom_at_size \
  "messages-active-mobile" \
  "390,1200" \
  "$ACTIVE_URL" \
  "Nova mensagem" \
  "Mensagem do paciente" \
  'data-visual-horizontal-overflow="false"' \
  'data-visual-active-message-composer-editable="true"' \
  'data-visual-active-message-controls-contained="true"'
assert_dom_at_size \
  "messages-ended" \
  "390,1200" \
  "$ENDED_URL" \
  "Acompanhamento encerrado" \
  "Histórico da conversa" \
  "Mensagem registrada antes do encerramento." \
  "Resposta registrada pelo paciente." \
  "Por Nutricionista de validação" \
  "somente para consulta" \
  'data-visual-ended-message-draft-disabled="true"' \
  'data-visual-ended-message-retry-absent="true"'

printf 'stage=manifest\n' >> "$OUTPUT_DIR/stage.log"
cat > "$OUTPUT_DIR/manifest.txt" <<MANIFEST
routes=/professional/messages,/professional/patients/1/messages
head_sha=${GITHUB_HEAD_SHA:-${GITHUB_SHA:-local}}
checkout_sha=${GITHUB_SHA:-local}
scenarios=messages-inbox,messages-active,messages-ended-read-only
viewports=1440x900,390x1200
source=actual ProfessionalAreaPage, ProfessionalLayout and ProfessionalMessagesExperience with deterministic auth and tRPC transport fixtures
assertions=aggregate inbox without composer, patient conversation links and filters, active conversation with editable composer and retry, ended conversation read-only, no page-level horizontal overflow
MANIFEST

ls -lh "$OUTPUT_DIR"
