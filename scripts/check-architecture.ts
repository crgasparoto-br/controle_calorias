import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findWhatsAppResponseArchitectureViolations } from "./whatsapp-response-architecture";
import { findTimeZoneArchitectureViolations } from "./timezone-architecture";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { assessFoodDebt, assessFoodDebtRenewal, type FoodDebt } from "./food-architecture-debt";
import { FOOD_WAVE_ONE_RULES } from "./food-architecture-rules";

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

const whatsappArchitectureFiles = walk("server")
  .filter(file => /\.ts$/.test(file))
  .map(file => ({ path: file, content: read(file) }));
for (const violation of findWhatsAppResponseArchitectureViolations(whatsappArchitectureFiles)) {
  fail(violation);
}

const timeZoneArchitectureFiles = ["client/src", "server", "shared"]
  .flatMap(directory => walk(directory))
  .filter(file => /\.[cm]?[jt]sx?$/.test(file))
  .map(file => ({ path: file, content: read(file) }));
for (const violation of findTimeZoneArchitectureViolations(timeZoneArchitectureFiles)) {
  fail(violation);
}


/**
 * ADR Food Intelligence V2 §19: report wave-one candidates without silently
 * promoting OPEN scope decisions (§25 items 25 and 26) to a blocking gate.
 * Ledger violations are independently blocking (expired, orphaned, malformed).
 */
const foodArchitectureFiles = walk("server")
  .filter(file => /\.[cm]?tsx?$/.test(file))
  .map(file => ({ path: file, content: read(file) }));
const foodFindings = findFoodStaticCandidates(foodArchitectureFiles);
const debtPath = "architecture-debt.json";
if (!existsSync(path.join(root, debtPath))) {
  fail("Food architecture debt ledger missing: " + debtPath);
} else {
  try {
    const ledger: unknown = JSON.parse(read(debtPath));
    if (!ledger || typeof ledger !== "object" || !("entries" in ledger) ||
        !Array.isArray((ledger as { entries: unknown }).entries)) {
      fail("Invalid food architecture debt ledger: entries array required");
    } else {
      const result = assessFoodDebt(foodFindings, (ledger as { entries: FoodDebt[] }).entries, new Date());
      const baseRef = process.env.GITHUB_BASE_REF || (process.env.GITHUB_REF_NAME === "main" ? "main" : "develop");
      if (/^[a-zA-Z0-9._/-]+$/.test(baseRef)) {
        try {
          execFileSync("git", ["rev-parse", "--verify", "origin/" + baseRef], { stdio: "ignore" });
          let previous: { entries: FoodDebt[] } = { entries: [] };
          try {
            previous = JSON.parse(execFileSync("git", ["show", "origin/" + baseRef + ":architecture-debt.json"], {
              encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
            }));
          } catch {
            // No architecture debt book in the baseline: introducing a book is allowed.
          }
          if (!Array.isArray(previous.entries)) fail("Invalid baseline architecture debt book");
          else for (const renewal of assessFoodDebtRenewal(previous.entries, (ledger as { entries: FoodDebt[] }).entries)) {
            fail("Food architecture debt: " + renewal);
          }
        } catch {
          if (process.env.GITHUB_ACTIONS === "true") fail("Cannot verify architecture debt renewal against origin/" + baseRef);
          else console.warn("[food-architecture] base unavailable; debt immutability comparison not run");
        }
      } else {
        fail("Invalid base ref for food architecture debt comparison");
      }
      for (const error of result.errors.filter(item => !item.startsWith("Uncovered architecture violation: "))) {
        fail("Food architecture debt: " + error);
      }
      for (const warning of result.warnings) console.warn("[food-architecture] " + warning);
      console.log(
        "[food-architecture] wave-one preview: " + new Set(FOOD_WAVE_ONE_RULES.map(rule => rule.id)).size +
        " rules, " + foodFindings.length + " findings, " + result.uncovered.length +
        " uncovered; blocking promotion awaits ADR §25 items 25/26",
      );
    }
  } catch (error) {
    fail("Food architecture ledger unreadable: " + String(error));
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
