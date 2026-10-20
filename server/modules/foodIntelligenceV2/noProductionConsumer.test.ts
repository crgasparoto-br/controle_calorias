import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Fase A1 (§21.1, item 1): nenhum entrypoint produtivo é migrado nesta entrega.
 *
 * Este controle trava imports/carregamentos reais do módulo V2 por código
 * produtivo sem confundir strings, comentários e ferramentas de auditoria
 * com consumidores do domínio alimentar.
 */
const REPOSITORY_ROOT = resolve(__dirname, "../../..");
const MODULE_DIRECTORY = resolve(__dirname);
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

function importsV2AtRuntime(file: string, content: string): boolean {
  if (!content.includes("foodIntelligenceV2")) return false;
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX
    : file.endsWith(".jsx") ? ts.ScriptKind.JSX
    : /\.(?:js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false, kind);
  let found = false;

  const targetsV2 = (specifier: ts.Expression | undefined): boolean => {
    if (!specifier) return false;
    if (ts.isStringLiteralLike(specifier)) return V2_MODULE_PATH.test(specifier.text);
    // A known directory in a dynamic template still loads V2 at runtime.
    return ts.isTemplateExpression(specifier) && V2_MODULE_PATH.test(specifier.head.text);
  };

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isImportDeclaration(node) &&
        isRuntimeImport(node.importClause) && targetsV2(node.moduleSpecifier)) {
      found = true;
    } else if (ts.isExportDeclaration(node) &&
        isRuntimeExport(node) && targetsV2(node.moduleSpecifier)) {
      found = true;
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference) &&
        targetsV2(node.moduleReference.expression)) {
      found = true;
    } else if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        targetsV2(node.arguments[0])) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
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

describe("fronteira da Fase A1", () => {
  it("não tem consumidor produtivo fora do próprio módulo", async () => {
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
        if (ISOLATED_TEST_FILE.test(file)) continue;
        const content = await readFile(file, "utf8");
        if (importsV2AtRuntime(file, content)) {
          offenders.push(relative(REPOSITORY_ROOT, file));
        }
      }
    }
    expect(offenders).toStrictEqual([]);
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
