/**
 * Script de registro do webhook do Strava
 *
 * Execute UMA VEZ após o deploy para registrar a subscription no Strava.
 * O Strava permite apenas 1 subscription ativa por aplicativo.
 *
 * Uso:
 *   STRAVA_CLIENT_ID=xxx STRAVA_CLIENT_SECRET=yyy \
 *   STRAVA_WEBHOOK_VERIFY_TOKEN=zzz \
 *   APP_URL=https://seu-app.onrender.com \
 *   node scripts/register-strava-webhook.mjs
 *
 * Para verificar a subscription existente:
 *   node scripts/register-strava-webhook.mjs --check
 *
 * Para remover a subscription existente:
 *   node scripts/register-strava-webhook.mjs --delete <subscription_id>
 */

const STRAVA_WEBHOOK_API = "https://www.strava.com/api/v3/push_subscriptions";

const clientId = process.env.STRAVA_CLIENT_ID;
const clientSecret = process.env.STRAVA_CLIENT_SECRET;
const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
const appUrl = process.env.APP_URL;

const args = process.argv.slice(2);
const isCheck = args.includes("--check");
const deleteIndex = args.indexOf("--delete");
const deleteId = deleteIndex >= 0 ? args[deleteIndex + 1] : null;

// ── Verificar subscription existente ──────────────────────────────────────────
if (isCheck) {
  if (!clientId || !clientSecret) {
    console.error("❌ STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET são obrigatórios.");
    process.exit(1);
  }

  const url = `${STRAVA_WEBHOOK_API}?client_id=${clientId}&client_secret=${clientSecret}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.error("❌ Erro ao verificar subscription:", data);
    process.exit(1);
  }

  if (Array.isArray(data) && data.length === 0) {
    console.log("ℹ️  Nenhuma subscription ativa.");
  } else {
    console.log("✅ Subscription ativa:", JSON.stringify(data, null, 2));
  }
  process.exit(0);
}

// ── Remover subscription ──────────────────────────────────────────────────────
if (deleteId) {
  if (!clientId || !clientSecret) {
    console.error("❌ STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET são obrigatórios.");
    process.exit(1);
  }

  const url = `${STRAVA_WEBHOOK_API}/${deleteId}?client_id=${clientId}&client_secret=${clientSecret}`;
  const res = await fetch(url, { method: "DELETE" });

  if (res.status === 204) {
    console.log(`✅ Subscription ${deleteId} removida com sucesso.`);
  } else {
    const data = await res.json().catch(() => ({}));
    console.error(`❌ Erro ao remover subscription ${deleteId}:`, data);
    process.exit(1);
  }
  process.exit(0);
}

// ── Registrar nova subscription ───────────────────────────────────────────────
if (!clientId || !clientSecret || !verifyToken || !appUrl) {
  console.error(`
❌ Variáveis de ambiente obrigatórias:
   STRAVA_CLIENT_ID      = ${clientId ? "✅" : "❌ ausente"}
   STRAVA_CLIENT_SECRET  = ${clientSecret ? "✅" : "❌ ausente"}
   STRAVA_WEBHOOK_VERIFY_TOKEN = ${verifyToken ? "✅" : "❌ ausente"}
   APP_URL               = ${appUrl ? "✅" : "❌ ausente"}

Exemplo:
  STRAVA_CLIENT_ID=xxx STRAVA_CLIENT_SECRET=yyy \\
  STRAVA_WEBHOOK_VERIFY_TOKEN=meu-token-secreto \\
  APP_URL=https://meu-app.onrender.com \\
  node scripts/register-strava-webhook.mjs
`);
  process.exit(1);
}

const callbackUrl = `${appUrl.replace(/\/$/, "")}/api/health-integrations/strava/webhook`;

console.log(`📡 Registrando webhook do Strava...`);
console.log(`   Callback URL: ${callbackUrl}`);

const body = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  callback_url: callbackUrl,
  verify_token: verifyToken,
});

const res = await fetch(STRAVA_WEBHOOK_API, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: body.toString(),
});

const data = await res.json();

if (res.ok) {
  console.log(`✅ Webhook registrado com sucesso!`);
  console.log(`   Subscription ID: ${data.id}`);
  console.log(`   Callback URL: ${data.callback_url}`);
  console.log(`\n💡 Guarde o Subscription ID (${data.id}) caso precise remover no futuro:`);
  console.log(`   node scripts/register-strava-webhook.mjs --delete ${data.id}`);
} else {
  console.error("❌ Erro ao registrar webhook:", JSON.stringify(data, null, 2));

  if (data.errors?.some((e) => e.resource === "PushSubscription" && e.code === "already exists")) {
    console.log("\n💡 Já existe uma subscription ativa. Verifique com:");
    console.log(`   node scripts/register-strava-webhook.mjs --check`);
  }

  process.exit(1);
}
