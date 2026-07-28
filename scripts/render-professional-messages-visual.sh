#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="artifacts/professional-messages"
PORT="4176"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

pnpm exec vite build --config visual-tests/professional-patient-workspace/vite.config.ts
pnpm exec vite preview \
  --config visual-tests/professional-patient-workspace/vite.config.ts \
  --host 127.0.0.1 \
  --port "$PORT" \
  > /tmp/professional-messages-visual-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

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

CHROME_BIN="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROME_BIN" ]; then
  echo "Chrome or Chromium was not found on the runner."
  exit 1
fi

run_chrome() {
  local profile
  profile="$(mktemp -d)"
  if ! timeout --signal=TERM --kill-after=5s 90s "$CHROME_BIN" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --user-data-dir="$profile" \
    "$@"; then
    rm -rf "$profile"
    return 1
  fi
  rm -rf "$profile"
}

capture() {
  local name="$1"
  local size="$2"
  local url="$3"
  run_chrome \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --virtual-time-budget=2500 \
    --window-size="$size" \
    --screenshot="$OUTPUT_DIR/$name.png" \
    "$url"
  test -s "$OUTPUT_DIR/$name.png"
}

assert_dom_at_size() {
  local name="$1"
  local size="$2"
  local url="$3"
  shift 3
  local output="$OUTPUT_DIR/$name.html"
  run_chrome \
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

INBOX_URL="http://127.0.0.1:${PORT}/professional/messages"
ACTIVE_URL="http://127.0.0.1:${PORT}/professional/patients/1/messages"
ENDED_URL="${ACTIVE_URL}?state=ended"

capture "messages-inbox-desktop-1440x900" "1440,900" "$INBOX_URL"
capture "messages-inbox-mobile-390x1200" "390,1200" "$INBOX_URL"
capture "messages-active-desktop-1440x900" "1440,900" "$ACTIVE_URL"
capture "messages-active-mobile-390x1200" "390,1200" "$ACTIVE_URL"
capture "messages-ended-mobile-390x1200" "390,1200" "$ENDED_URL"

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
