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

capture() {
  local name="$1"
  local size="$2"
  local url="$3"
  local width="${size%,*}"
  local height="${size#*,}"
  local output="$OUTPUT_DIR/$name.png"
  node scripts/capture-chrome-cdp.mjs \
    --mode screenshot \
    --url "$url" \
    --output "$output" \
    --width "$width" \
    --height "$height" \
    --wait-expression "document.documentElement.dataset.visualHorizontalOverflow === 'false'"
  test -s "$output"
}

assert_dom_at_size() {
  local name="$1"
  local size="$2"
  local url="$3"
  shift 3
  local width="${size%,*}"
  local height="${size#*,}"
  local output="$OUTPUT_DIR/$name.html"
  node scripts/capture-chrome-cdp.mjs \
    --mode dom \
    --url "$url" \
    --output "$output" \
    --width "$width" \
    --height "$height" \
    --wait-expression "document.documentElement.dataset.visualHorizontalOverflow === 'false'"
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
  'data-visual-active-message-controls-contained="true"' \
  'data-visual-before-unload-suppressed="true"' \
  'data-visual-revocation-stream-disabled="true"'
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
source=actual ProfessionalAreaPage, ProfessionalLayout and ProfessionalMessagesExperience with deterministic auth and tRPC transport fixtures; the isolated visual harness disables the long-lived revocation EventSource and suppresses beforeunload browser-exit prompts while functional tests cover both production behaviors
assertions=aggregate inbox without composer, patient conversation links and filters, active conversation with editable composer and retry, ended conversation read-only, no page-level horizontal overflow
MANIFEST

ls -lh "$OUTPUT_DIR"
