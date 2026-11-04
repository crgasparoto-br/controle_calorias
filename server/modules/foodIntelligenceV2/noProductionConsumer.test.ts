import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Fase D: allow only audited D1 bridges, the web-draft cleanup worker and the
 * inert preflight for unmigrated public channels.
 */
const REPOSITORY_ROOT = resolve(__dirname, "../../..");
// TiDB scripts are isolated fixtures, not productive routing consumers.
const D1_ISOLATED_TIDB_TESTS = new Set([
  resolve(REPOSITORY_ROOT, "scripts/test-food-d1-runtime-tidb.ts"),
  resolve(REPOSITORY_ROOT, "scripts/test-food-d1-restart-tidb.ts"),
]);
const MODULE_DIRECTORY = resolve(__dirname);
const PUBLIC_D1_SIMULATOR = resolve(REPOSITORY_ROOT, "server/modules/whatsapp/service.ts");
const PUBLIC_D1_MANUAL_ADD = resolve(REPOSITORY_ROOT, "server/modules/meals/service.ts");
const PUBLIC_D1_MANUAL_ADD_BRIDGE = "../foodIntelligenceV2/publicManualAddition";
const PUBLIC_D1_WEB_DRAFT_BRIDGE = "../foodIntelligenceV2/publicWebDraft";
const WEB_DRAFT_RETENTION_STARTUP = resolve(REPOSITORY_ROOT, "server/_core/index.ts");
const WEB_DRAFT_RETENTION_SCHEDULER = "../modules/foodIntelligenceV2/webDraftRetentionScheduler";
const PUBLIC_D1_EDIT = resolve(REPOSITORY_ROOT, "server/modules/meals/groupOperations.ts");
const PUBLIC_D1_EDIT_BRIDGE = "../foodIntelligenceV2/publicEdit";
const PUBLIC_D1_SIMULATOR_BRIDGE = "../foodIntelligenceV2/publicSimulator";
const PUBLIC_D1_UNMIGRATED_GUARD = "../foodIntelligenceV2/publicUnmigratedEntrypoints";
const PUBLIC_D1_WHATSAPP_REGISTER_BRIDGE = "../foodIntelligenceV2/publicWhatsAppRegistration";
const PUBLIC_D1_WHATSAPP_VISUAL_BRIDGE = "../foodIntelligenceV2/publicWhatsAppVisualRegistration";
const PUBLIC_D1_VISUAL_EXTRACTOR = "../foodIntelligenceV2/publicVisualSurfaces";
const PUBLIC_D1_LINGUISTIC_COMPREHENSION = "../foodIntelligenceV2/linguisticComprehension";
const PUBLIC_D1_PENDING_REPOSITORY = "../foodIntelligenceV2/publicWhatsAppPendingRepository";
const PUBLIC_D1_WEB_PHOTO = resolve(REPOSITORY_ROOT, "server/modules/photoAnalysis/service.ts");
const PUBLIC_D1_PUBLIC_PHOTO_ROUTER = resolve(REPOSITORY_ROOT, "server/nutritionRouter.ts");
const PUBLIC_D1_PUBLIC_PHOTO_BRIDGE = "./modules/foodIntelligenceV2/publicPhotoRoute";
const PUBLIC_D1_WHATSAPP_CONFIRMED = resolve(REPOSITORY_ROOT, "server/modules/whatsapp/confirmedMealRegistration.ts");
const PUBLIC_D1_WEBHOOK = resolve(REPOSITORY_ROOT, "server/whatsappWebhookImplementation.ts");
const PUBLIC_D1_ANNOTATED_WEBHOOK = resolve(REPOSITORY_ROOT, "server/whatsappAnnotatedImageWebhookImplementation.ts");
const PUBLIC_D1_ROOT_GUARD = "./modules/foodIntelligenceV2/publicUnmigratedEntrypoints";
const SCANNED_ROOTS = ["server", "client/src", "shared", "scripts"] as const;
const V2_MODULE_PATH = /(?:^|[/\\])foodIntelligenceV2(?:[/\\]|$)/;
const ISOLATED_TEST_FILE = /(?:^|[/\\])__tests__[/\\]|\.(?:test|spec)\.[cm]?[jt]sx?$/;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "build", "coverage", "artifacts",
]);

function isRuntimeImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return true; // Bare imports execute the target module.
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (!clause.namedBindings) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  // import {} has side effects; import { type X } is erased by TypeScript.
  return clause.namedBindings.elements.length === 0 ||
    clause.namedBindings.elements.some(element => !element.isTypeOnly);
}

function isRuntimeExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.length === 0 ||
    node.exportClause.elements.some(element => !element.isTypeOnly);
}

function runtimeV2Specifiers(file: string, content: string): string[] {
  if (!content.includes("foodIntelligenceV2")) return [];
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX
    : file.endsWith(".jsx") ? ts.ScriptKind.JSX
    : /\.(?:js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false, kind);
  const imports: string[] = [];

  const specifierText = (specifier: ts.Expression | undefined): string | null => {
    if (!specifier) return null;
    if (ts.isStringLiteralLike(specifier)) return specifier.text;
    return ts.isTemplateExpression(specifier) ? specifier.head.text : null;
  };
  const addTarget = (specifier: ts.Expression | undefined) => {
    const text = specifierText(specifier);
    if (text && V2_MODULE_PATH.test(text)) imports.push(text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isRuntimeImport(node.importClause)) {
      addTarget(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && isRuntimeExport(node)) {
      addTarget(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference)) {
      addTarget(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      addTarget(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function importsV2AtRuntime(file: string, content: string): boolean {
  return runtimeV2Specifiers(file, content).length > 0;
}

/** One exact productive import is allowed, without permission to load anything else. */
function isApprovedD1RuntimeConsumer(file: string, imports: readonly string[]): boolean {
  if (file === WEB_DRAFT_RETENTION_STARTUP) {
    return imports.length === 1 && imports[0] === WEB_DRAFT_RETENTION_SCHEDULER;
  }
  if (file === PUBLIC_D1_MANUAL_ADD) {
    return imports.length === 3 &&
      imports.includes(PUBLIC_D1_MANUAL_ADD_BRIDGE) &&
      imports.includes(PUBLIC_D1_WEB_DRAFT_BRIDGE) &&
      imports.includes(PUBLIC_D1_UNMIGRATED_GUARD);
  }
  if (file === PUBLIC_D1_WHATSAPP_CONFIRMED) {
    return imports.length === 10 &&
      [PUBLIC_D1_UNMIGRATED_GUARD, PUBLIC_D1_WHATSAPP_REGISTER_BRIDGE,
        PUBLIC_D1_WHATSAPP_VISUAL_BRIDGE, PUBLIC_D1_VISUAL_EXTRACTOR,
        PUBLIC_D1_LINGUISTIC_COMPREHENSION, PUBLIC_D1_PENDING_REPOSITORY,
        PUBLIC_D1_SIMULATOR_BRIDGE,
        "../foodIntelligenceV2/linguisticLexiconRepository",
        "../foodIntelligenceV2/repository",
        "../foodIntelligenceV2/entrypointRunner"].every(target => imports.includes(target));
  }
  return imports.length === 1 && (
    file === PUBLIC_D1_SIMULATOR && imports[0] === PUBLIC_D1_SIMULATOR_BRIDGE ||
    file === PUBLIC_D1_EDIT && imports[0] === PUBLIC_D1_EDIT_BRIDGE ||
    file === PUBLIC_D1_WEB_PHOTO && imports[0] === PUBLIC_D1_UNMIGRATED_GUARD ||
    file === PUBLIC_D1_PUBLIC_PHOTO_ROUTER && imports[0] === PUBLIC_D1_PUBLIC_PHOTO_BRIDGE ||
    (file === PUBLIC_D1_WEBHOOK || file === PUBLIC_D1_ANNOTATED_WEBHOOK) &&
      imports[0] === PUBLIC_D1_ROOT_GUARD
  );
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await collectSourceFiles(join(directory, entry.name))));
      continue;
    }
    if (SOURCE_EXTENSIONS.some(extension => entry.name.endsWith(extension))) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

describe("fronteira da Fase D", () => {
  it("permite só o consumidor de simulador autorizado e bloqueia outros imports produtivos", async () => {
    const offenders: string[] = [];
    for (const root of SCANNED_ROOTS) {
      const absoluteRoot = join(REPOSITORY_ROOT, root);
      let files: string[];
      try {
        files = await collectSourceFiles(absoluteRoot);
      } catch {
        continue;
      }
      for (const file of files) {
        if (file.startsWith(MODULE_DIRECTORY + sep)) continue;
        if (ISOLATED_TEST_FILE.test(file) || D1_ISOLATED_TIDB_TESTS.has(file)) continue;
        const content = await readFile(file, "utf8");
        const imports = runtimeV2Specifiers(file, content);
        if (imports.length > 0 && !isApprovedD1RuntimeConsumer(file, imports)) {
          offenders.push(relative(REPOSITORY_ROOT, file));
        }
      }
    }
    expect(offenders).toStrictEqual([]);
    const publicSimulator = await readFile(PUBLIC_D1_SIMULATOR, "utf8");
    expect(runtimeV2Specifiers(PUBLIC_D1_SIMULATOR, publicSimulator))
      .toEqual([PUBLIC_D1_SIMULATOR_BRIDGE]);
    const publicManual = await readFile(PUBLIC_D1_MANUAL_ADD, "utf8");
    expect(runtimeV2Specifiers(PUBLIC_D1_MANUAL_ADD, publicManual))
      .toEqual([
        PUBLIC_D1_MANUAL_ADD_BRIDGE,
        PUBLIC_D1_UNMIGRATED_GUARD,
        PUBLIC_D1_WEB_DRAFT_BRIDGE,
      ]);
    const webPhoto = await readFile(PUBLIC_D1_WEB_PHOTO, "utf8");
    expect(runtimeV2Specifiers(PUBLIC_D1_WEB_PHOTO, webPhoto))
      .toEqual([PUBLIC_D1_UNMIGRATED_GUARD]);
    const photoRouter = await readFile(PUBLIC_D1_PUBLIC_PHOTO_ROUTER, "utf8");
    expect(runtimeV2Specifiers(PUBLIC_D1_PUBLIC_PHOTO_ROUTER, photoRouter))
      .toEqual([PUBLIC_D1_PUBLIC_PHOTO_BRIDGE]);
    const confirmed = await readFile(PUBLIC_D1_WHATSAPP_CONFIRMED, "utf8");
    expect(runtimeV2Specifiers(PUBLIC_D1_WHATSAPP_CONFIRMED, confirmed))
      .toEqual([PUBLIC_D1_UNMIGRATED_GUARD, PUBLIC_D1_WHATSAPP_REGISTER_BRIDGE,
        PUBLIC_D1_WHATSAPP_VISUAL_BRIDGE, PUBLIC_D1_VISUAL_EXTRACTOR,
        PUBLIC_D1_LINGUISTIC_COMPREHENSION, PUBLIC_D1_PENDING_REPOSITORY,
        PUBLIC_D1_SIMULATOR_BRIDGE,
        "../foodIntelligenceV2/linguisticLexiconRepository",
        "../foodIntelligenceV2/repository",
        "../foodIntelligenceV2/entrypointRunner"]);
    const webhook = await readFile(PUBLIC_D1_WEBHOOK, "utf8");
    expect(runtimeV2Specifiers(PUBLIC_D1_WEBHOOK, webhook))
      .toEqual([PUBLIC_D1_ROOT_GUARD]);
    const annotatedWebhook = await readFile(PUBLIC_D1_ANNOTATED_WEBHOOK, "utf8");
    expect(runtimeV2Specifiers(PUBLIC_D1_ANNOTATED_WEBHOOK, annotatedWebhook))
      .toEqual([PUBLIC_D1_ROOT_GUARD]);
    const publicEdit = await readFile(PUBLIC_D1_EDIT, "utf8");
    expect(runtimeV2Specifiers(PUBLIC_D1_EDIT, publicEdit))
      .toEqual([PUBLIC_D1_EDIT_BRIDGE]);
  });

  it("não isenta outros handlers, imports dinâmicos nem segundos resolvers no simulador", () => {
    const good = 'import { tryRunPublicFoodD1Simulation } from "../foodIntelligenceV2/publicSimulator";';
    expect(isApprovedD1RuntimeConsumer(PUBLIC_D1_SIMULATOR,
      runtimeV2Specifiers(PUBLIC_D1_SIMULATOR, good))).toBe(true);
    const photoOnly = 'import { tryRunPublicFoodD1PhotoAnalysis } from "./modules/foodIntelligenceV2/publicPhotoRoute";';
    expect(isApprovedD1RuntimeConsumer(PUBLIC_D1_PUBLIC_PHOTO_ROUTER,
      runtimeV2Specifiers(PUBLIC_D1_PUBLIC_PHOTO_ROUTER, photoOnly))).toBe(true);
    for (const fileAndCode of [
      [resolve(REPOSITORY_ROOT, "server/modules/whatsapp/confirmedMealRegistration.ts"), good],
      [PUBLIC_D1_SIMULATOR, good + '\nimport { resolveFoodObservation } from "../foodIntelligenceV2/resolver";'],
      [PUBLIC_D1_PUBLIC_PHOTO_ROUTER, 'import { resolveFoodObservation } from "./modules/foodIntelligenceV2/resolver";'],
      [PUBLIC_D1_PUBLIC_PHOTO_ROUTER,
        'import { tryRunPublicFoodD1PhotoAnalysis } from "./modules/foodIntelligenceV2/publicPhotoRoute";' +
        '\nimport { createFoodD1RouteDbStore } from "./modules/foodIntelligenceV2/entrypointRouteRepository";'],
      [PUBLIC_D1_SIMULATOR, 'const engine = await import("../foodIntelligenceV2/entrypointRunner");'],
    ]) {
      const [file, code] = fileAndCode;
      expect(isApprovedD1RuntimeConsumer(file, runtimeV2Specifiers(file, code))).toBe(false);
    }
  });

  it("ignora strings, comentários e imports exclusivamente de tipos", () => {
    for (const code of [
      'const path = "server/modules/foodIntelligenceV2/foodArchitectureSemanticBoundaries.test.ts";',
      '// import "../modules/foodIntelligenceV2/service";',
      'import type { FoodObservation } from "../modules/foodIntelligenceV2/contracts";',
      'import { type FoodObservation } from "../modules/foodIntelligenceV2/contracts";',
      'export type { FoodObservation } from "../modules/foodIntelligenceV2/contracts";',
      'export { type FoodObservation } from "../modules/foodIntelligenceV2/contracts";',
      'import "../modules/foodIntelligenceV2-test-tools";',
    ]) {
      expect(importsV2AtRuntime("server/services/food.ts", code), code).toBe(false);
    }
    expect(ISOLATED_TEST_FILE.test("scripts/food-architecture-call-target.test.ts")).toBe(true);
    expect(ISOLATED_TEST_FILE.test("server/services/food.ts")).toBe(false);
    expect(D1_ISOLATED_TIDB_TESTS.has(resolve(REPOSITORY_ROOT,
      "scripts/test-food-d1-runtime-tidb.ts"))).toBe(true);
    expect(D1_ISOLATED_TIDB_TESTS.has(resolve(REPOSITORY_ROOT,
      "scripts/test-food-d1-restart-tidb.ts"))).toBe(true);
    expect(D1_ISOLATED_TIDB_TESTS.has(resolve(REPOSITORY_ROOT,
      "server/whatsappWebhook.ts"))).toBe(false);
  });

  it("bloqueia ESM, reexport, CommonJS e importação dinâmica reais", () => {
    for (const code of [
      'import "../modules/foodIntelligenceV2/service";',
      'import { processMeal } from "../modules/foodIntelligenceV2/service";',
      'export { processMeal } from "../modules/foodIntelligenceV2/service";',
      'export * from "../modules/foodIntelligenceV2/service";',
      'const v2 = require("../modules/foodIntelligenceV2/service");',
      'const v2 = await import("../modules/foodIntelligenceV2/service");',
      'import V2 = require("../modules/foodIntelligenceV2/service");',
    ]) {
      expect(importsV2AtRuntime("server/services/food.ts", code), code).toBe(true);
    }
  });
});
