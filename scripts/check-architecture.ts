import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function walk(dir: string): string[] {
  const absolute = path.join(root, dir);
  if (!existsSync(absolute)) return [];

  return readdirSync(absolute).flatMap(entry => {
    const full = path.join(absolute, entry);
    const relative = path.relative(root, full);
    if (statSync(full).isDirectory()) {
      if (["node_modules", ".git", "dist"].includes(entry)) return [];
      return walk(relative);
    }
    return [relative];
  });
}

function pointsToProjectServer(source: string) {
  return (
    source === "server" ||
    source.startsWith("server/") ||
    source.startsWith("@/server/") ||
    source.includes("../server") ||
    source.includes("../../server") ||
    source.includes("../../../server")
  );
}

function hasRuntimeServerImport(content: string) {
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("import ")) continue;
    if (trimmed.startsWith("import type ")) continue;

    const fromMatch = trimmed.match(/\sfrom\s+["']([^"']+)["']/);
    if (fromMatch && pointsToProjectServer(fromMatch[1])) {
      return true;
    }

    const sideEffectMatch = trimmed.match(/^import\s+["']([^"']+)["']/);
    if (sideEffectMatch && pointsToProjectServer(sideEffectMatch[1])) {
      return true;
    }
  }

  const dynamicImports = content.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g);
  for (const match of dynamicImports) {
    if (pointsToProjectServer(match[1])) {
      return true;
    }
  }

  return false;
}

const requiredModuleFiles = [
  "server/modules/meals/service.ts",
  "server/modules/meals/schemas.ts",
  "server/modules/whatsapp/service.ts",
  "server/modules/whatsapp/schemas.ts",
  "server/modules/goals/service.ts",
  "server/modules/goals/schemas.ts",
  "server/modules/professionals/service.ts",
  "server/modules/professionals/schemas.ts",
];

for (const file of requiredModuleFiles) {
  if (!existsSync(path.join(root, file))) {
    fail(`Arquivo obrigatório ausente: ${file}`);
  }
}

for (const file of walk("shared")) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const content = read(file);
  if (content.includes("../server") || content.includes("server/")) {
    fail(`shared não deve depender de server: ${file}`);
  }
  if (content.includes("../client") || content.includes("client/")) {
    fail(`shared não deve depender de client: ${file}`);
  }
}

for (const file of walk("client")) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const content = read(file);
  if (hasRuntimeServerImport(content)) {
    fail(`client não deve importar server em runtime: ${file}`);
  }
}

for (const file of walk("server")) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const content = read(file);
  if (/from\s+["'][^"']*client\//.test(content)) {
    fail(`server não deve importar client: ${file}`);
  }
}

const whatsappTransportAllowlist = new Set([
  "server/modules/whatsapp/webhookUtils.ts",
  "server/modules/whatsapp/replyTransport.ts",
  "server/modules/whatsapp/processingAcknowledgementDelivery.ts",
]);
const directWhatsAppSendPattern = /\b(?:sendWhatsAppTextMessage|sendWhatsAppImageMessage|sendWhatsAppImageBufferMessage|sendWhatsAppInteractiveUrlButtonMessage|sendWhatsAppInteractiveButtonsMessage|sendWhatsAppInteractiveListMessage)\b/;

for (const file of walk("server")) {
  if (!/\.ts$/.test(file) || /(?:\.test|\.spec)\.ts$/.test(file)) continue;
  const content = read(file);

  if (!whatsappTransportAllowlist.has(file) && directWhatsAppSendPattern.test(content)) {
    fail(`Envio funcional direto do WhatsApp fora do transporte central: ${file}`);
  }
  if (!whatsappTransportAllowlist.has(file) && /graph\.facebook\.com\/[^\s"'`]*\/messages/.test(content)) {
    fail(`Chamada direta ao endpoint /messages do WhatsApp fora do transporte central: ${file}`);
  }
  if (file.includes("whatsapp") && /Meta (?:estimada|ajustada)/.test(content)) {
    fail(`Terminologia legada de meta encontrada no fluxo WhatsApp: ${file}`);
  }
  if (file.includes("whatsapp") && /\bcalculateAdjustedGoalCalories\b/.test(content)) {
    fail(`Regra paralela de meta ajustada encontrada no fluxo WhatsApp: ${file}`);
  }
}

const routerPath = "server/nutritionRouter.ts";
if (existsSync(path.join(root, routerPath))) {
  const router = read(routerPath);
  const expectedGroups = [
    "privacy",
    "assistant",
    "foodPhotoAnalysis",
    "healthIntegrations",
    "professionals",
    "onboarding",
    "dashboard",
    "goals",
    "gamification",
    "foods",
    "meals",
    "exercises",
    "water",
    "reports",
    "admin",
    "whatsapp",
  ];

  for (const group of expectedGroups) {
    if (!new RegExp(`\\b${group}:\\s*router\\(`).test(router)) {
      fail(`Grupo tRPC esperado não encontrado em ${routerPath}: ${group}`);
    }
  }
}

if (failures.length > 0) {
  console.error("\nFalhas de arquitetura encontradas:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Arquitetura validada com sucesso.");
