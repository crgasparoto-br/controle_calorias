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
  if (/from\s+["'][^"']*server\//.test(content) || /from\s+["']\.\.\/\.\.\/server/.test(content)) {
    fail(`client não deve importar server diretamente: ${file}`);
  }
}

for (const file of walk("server")) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const content = read(file);
  if (/from\s+["'][^"']*client\//.test(content)) {
    fail(`server não deve importar client: ${file}`);
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
