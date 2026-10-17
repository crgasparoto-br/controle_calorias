import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findWhatsAppResponseArchitectureViolations } from "./whatsapp-response-architecture";
import { findTimeZoneArchitectureViolations } from "./timezone-architecture";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { compareFoodArchitectureFindings, readFoodFilesAtGitRef, readFoodWorkingFiles } from "./food-architecture-baseline";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";
import { assessFoodDebtRenewal, type FoodDebt, type ReviewedFoodDebtSeed } from "./food-architecture-debt";
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
 * ADR §25 item 25 (DECIDIDO): freeze the legacy baseline and FAIL additions.
 * It is never acceptable to add a new finding to architecture-debt.json as
 * part of the same change to bypass the gate.
 */
const foodArchitectureFiles = readFoodWorkingFiles(root);
const foodFindings = findFoodStaticCandidates(foodArchitectureFiles);
const debtPath = "architecture-debt.json";
const inventoryPath = "docs/design-docs/food-architecture-owners-1300.json";
if (!existsSync(path.join(root, debtPath)) || !existsSync(path.join(root, inventoryPath))) {
  fail("Food architecture debt book or pinned owners inventory missing");
} else {
  try {
    const ledger: unknown = JSON.parse(read(debtPath));
    const inventory: unknown = JSON.parse(read(inventoryPath));
    if (!ledger || typeof ledger !== "object" || !("entries" in ledger) ||
        !Array.isArray((ledger as { entries: unknown }).entries)) {
      fail("Invalid food architecture debt ledger: entries array required");
    } else if (!inventory || typeof inventory !== "object" || !("baseSha" in inventory) ||
        !/^[0-9a-f]{40}$/.test(String((inventory as { baseSha: unknown }).baseSha))) {
      fail("Invalid food architecture baseline SHA");
    } else {
      const entries = (ledger as { entries: FoodDebt[] }).entries;
      // R1300-01: retirement has a distinct work item from the gate-creation issue.
      // Keep existing owner, issue, original expiry and fingerprint untouched.
      for (const entry of entries) {
        if (!Number.isInteger(entry.migrationIssue) || (entry.migrationIssue ?? 0) <= 0 ||
            !Number.isInteger(entry.retirementIssue) || (entry.retirementIssue ?? 0) <= 0 ||
            entry.retirementIssue === entry.issue) {
          fail("Food architecture debt missing migration/retirement issue: " + entry.fingerprint);
        }
      }
      const baseSha = (inventory as { baseSha: string }).baseSha;
      // The SHA authorized before implementation #1300 cannot drift merely by
      // changing the inventory; future rebaselines require a reviewed migration.
      if (baseSha !== "0040adffc989d0b4d47e7cdc640ab9878e82c993") {
        fail("Unapproved food architecture baseline SHA change: " + baseSha);
      }
      try {
        const baseline = findFoodStaticCandidates(readFoodFilesAtGitRef(baseSha, root));
        // Source-reviewed, baseline-anchored violations require nominal debt.
        // Unconfirmed pre-existing AST candidates must stay in warning/triage.
        const reviewedSeeds = (inventory as { observations?: ReviewedFoodDebtSeed[] }).observations;
        if (!Array.isArray(reviewedSeeds)) fail("Missing reviewed source-anchored food debt inventory");
        const result = evaluateFoodArchitectureGate(
          foodFindings, baseline, entries, new Date(), Array.isArray(reviewedSeeds) ? reviewedSeeds : [],
        );
        for (const error of result.errors) fail("Food architecture: " + error);
        for (const warning of result.assessment.warnings) console.warn("[food-architecture] " + warning);
        console.log("[food-architecture] wave 1 enforced: " +
          new Set(FOOD_WAVE_ONE_RULES.map(rule => rule.id)).size + " gates; current=" + foodFindings.length +
          " legacy=" + result.delta.retained.length + " added=" + result.delta.added.length +
          " removed=" + result.delta.removed.length +
          " legacy awaiting review=" + result.legacyUncovered.length +
          " source baseline=" + baseSha);
        if (result.legacyUncovered.length) {
          console.warn("[food-architecture] pre-existing candidates require owner/debt triage; no auto-approval");
        }
      } catch (error) {
        fail("Cannot verify food architecture baseline: " + String(error));
      }
      const baseRef = process.env.GITHUB_BASE_REF ||
        (process.env.GITHUB_REF_NAME === "main" ? "main" : "develop");
      if (!/^[a-zA-Z0-9._/-]+$/.test(baseRef)) {
        fail("Invalid base ref for debt immutability comparison");
      } else {
        try {
          execFileSync("git", ["rev-parse", "--verify", "origin/" + baseRef], { stdio: "ignore" });
          let previous: { entries: FoodDebt[] } = { entries: [] };
          try {
            previous = JSON.parse(execFileSync("git", ["show", "origin/" + baseRef + ":architecture-debt.json"], {
              encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
            }));
          } catch {
            // Initial baseline may legitimately predate architecture-debt.json.
          }
          if (!Array.isArray(previous.entries)) fail("Invalid baseline architecture debt book");
          else for (const error of assessFoodDebtRenewal(previous.entries, entries, foodFindings)) fail("Food architecture debt: " + error);
          // A legacy fingerprint removed on develop must never become silently
          // eligible again merely because it existed in the immutable seed.
          const currentDevelopFindings = findFoodStaticCandidates(readFoodFilesAtGitRef("origin/" + baseRef, root));
          const reintroduced = compareFoodArchitectureFindings(foodFindings, currentDevelopFindings).added;
          for (const finding of reintroduced) {
            fail("Food architecture violation added since " + baseRef + ": " + finding.fingerprint);
          }
        } catch {
          if (process.env.GITHUB_ACTIONS === "true") fail("Cannot compare debt renewals with origin/" + baseRef);
          else console.warn("[food-architecture] debt immutability comparison needs fetched origin/" + baseRef);
        }
      }
    }
  } catch (error) {
    fail("Food architecture configuration unreadable: " + String(error));
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
