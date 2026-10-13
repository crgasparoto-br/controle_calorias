/**
 * Static, AST-backed Food Intelligence V2 architecture discovery (ADR §19).
 * Do not confuse a candidate with a proven behavioral violation: the wave-one
 * registry blocks NEW findings after item 25 approval; existing legacy stays visible.
 */
import ts from "typescript";
import path from "node:path";
import { FOOD_WAVE_ONE_RULES, type FoodWaveOneRuleId, type FoodWaveOneRule } from "./food-architecture-rules";

export type FoodArchitectureFile = { path: string; content: string };
export type FoodFinding = {
  ruleId: FoodWaveOneRuleId;
  file: string;
  line: number;
  symbol: string;
  failureClass: FoodWaveOneRule["failureClass"];
  fingerprint: string;
  description: string;
};

export function isProductionFoodSource(file: string): boolean {
  const p = file.replace(/\\/g, "/");
  return (p.startsWith("server/") || p.startsWith("shared/") || p.startsWith("client/src/")) &&
    /\.[cm]?tsx?$/.test(p) &&
    !/\.d\.ts$|\.(?:test|spec|fixture|fixtures|mock|stories|generated)\.[cm]?tsx?$|(?:^|\/)(?:__tests__|__fixtures__|__mocks__|fixtures|generated|__generated__|mocks|stories)(?:\/|$)/i.test(p);
}

function matches(pattern: string | undefined, value: string): boolean {
  return !pattern || new RegExp(pattern, "i").test(value);
}

function unwrap(source: ts.Expression): ts.Expression {
  if (ts.isAsExpression(source) || ts.isSatisfiesExpression(source) || ts.isParenthesizedExpression(source)) {
    return unwrap(source.expression);
  }
  if (ts.isCallExpression(source) && source.expression.getText() === "Object.freeze" &&
    source.arguments.length === 1) return unwrap(source.arguments[0]);
  return source;
}

function isLiteralCollection(expr: ts.Expression): boolean {
  const value = unwrap(expr);
  if (ts.isArrayLiteralExpression(value) || ts.isObjectLiteralExpression(value)) return true;
  if (ts.isNewExpression(value) &&
    (value.expression.getText() === "Set" || value.expression.getText() === "Map") &&
    value.arguments?.length === 1) {
    return ts.isArrayLiteralExpression(unwrap(value.arguments[0]));
  }
  return false;
}


/** A literal nutrition row is a rule even when returned without a named table. */
function isInlineFoodKnowledge(node: ts.ObjectLiteralExpression): boolean {
  const fields = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name.getText().replace(/^['"]|['"]$/g, "").toLowerCase();
    fields.set(key, unwrap(property.initializer));
  }
  const hasIdentity = ["name", "foodname", "alimento", "productname"].some(key =>
    fields.has(key) && ts.isStringLiteral(fields.get(key)!));
  const hasLiteralNutrition = ["calories", "kcal", "protein", "carbs", "fat", "grams",
    "portiongrams", "servinggrams"].some(key => {
      const value = fields.get(key);
      return value !== undefined && (ts.isNumericLiteral(value) ||
        (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)));
    });
  return hasIdentity && hasLiteralNutrition;
}

function enclosingDeclaration(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) {
      return parent.name?.getText() ?? "";
    }
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      parent.parent && ts.isVariableDeclaration(parent.parent)) {
      return parent.parent.name.getText();
    }
  }
  return "";
}

function isLexicalMap(expr: ts.Expression): boolean {
  const value = unwrap(expr);
  if (ts.isObjectLiteralExpression(value)) {
    const entries = value.properties.filter(ts.isPropertyAssignment);
    return entries.length > 0 && entries.every(property =>
      ts.isStringLiteral(unwrap(property.initializer)) &&
      (ts.isStringLiteral(property.name) || ts.isIdentifier(property.name)));
  }
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.some(element => {
      const entry = unwrap(element);
      if (!ts.isObjectLiteralExpression(entry)) return false;
      const keys = entry.properties.filter(ts.isPropertyAssignment).map(p =>
        p.name.getText().replace(/^['"]|['"]$/g, "").toLowerCase());
      return keys.includes("raw") && keys.includes("normalized");
    });
  }
  return false;
}

function hasLiteralWords(expr: ts.Expression): boolean {
  const value = unwrap(expr);
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.length > 0 && value.elements.every(element =>
      ts.isStringLiteral(unwrap(element)));
  }
  return ts.isNewExpression(value) && value.expression.getText() === "Set" &&
    value.arguments?.length === 1 && hasLiteralWords(value.arguments[0]) || false;
}

function stableHash(value: string): string {
  // FNV-1a over lexer tokens, not raw source. Formatting is ignored, but
  // whitespace INSIDE string literals remains significant for new hardcodes.
  let h = 2166136261;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, value);
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const token = scanner.getTokenText();
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x1f;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function failureClass(rule: FoodWaveOneRule, symbol: string): FoodFinding["failureClass"] {
  if (rule.id !== "17") return rule.failureClass;
  if (/portion|porc|serving|macro|nutrition|nutrient/i.test(symbol)) return "C";
  if (/alias|lexic|synonym|vocab|term/i.test(symbol)) return "A";
  return "I";
}

function ruleEvidence(node: ts.Node, source: ts.SourceFile, rule: FoodWaveOneRule): {
  symbol: string; subject: string;
} | null {
  if (rule.kind === "collection" && ts.isVariableDeclaration(node) &&
    node.initializer && isLiteralCollection(node.initializer)) {
    const symbol = node.name.getText(source);
    const mappedLexicon = rule.id === "11" && isLexicalMap(node.initializer) &&
      /food|alimento|lexic|normaliz|language|vocab|synonym|alias/i.test(
        symbol + " " + enclosingDeclaration(node) + " " + source.fileName);
    if ((matches(rule.symbolPattern, symbol) || mappedLexicon ||
        (rule.contentPattern && matches(rule.contentPattern, node.initializer.getText(source)))) &&
        matches(rule.evidencePattern, symbol)) {
      return { symbol, subject: node.initializer.getText(source) };
    }
  }
  if (rule.kind === "collection" && rule.id === "17" &&
      ts.isObjectLiteralExpression(node) && isInlineFoodKnowledge(node)) {
    return { symbol: "inline-food-knowledge", subject: node.getText(source) };
  }
  if (rule.kind === "scalar" && ts.isVariableDeclaration(node) && node.initializer) {
    const symbol = node.name.getText(source);
    const value = unwrap(node.initializer);
    const numericFoodField = /portion|porc|serving|gram|calor|kcal|protein|carb|fat|macro|nutrient|nutrition|classification/i.test(symbol);
    if (matches(rule.symbolPattern, symbol) &&
        (ts.isStringLiteral(value) || (numericFoodField &&
          (ts.isNumericLiteral(value) ||
            (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)))))) {
      return { symbol, subject: node.initializer.getText(source) };
    }
  }
  if (rule.kind === "literal-membership" && ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["includes", "has", "indexOf"].includes(node.expression.name.text) &&
      node.arguments.length > 0 &&
      hasLiteralWords(node.expression.expression)) {
    const context = enclosingDeclaration(node) + " " + node.arguments[0].getText(source);
    if (matches(rule.symbolPattern, context)) {
      return { symbol: (enclosingDeclaration(node) || "expression") + ":lexical-membership",
        subject: node.getText(source) };
    }
  }
  const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
  const onlyNamedTypes = bindings && ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 && bindings.elements.every(specifier => specifier.isTypeOnly) &&
    !node.importClause?.name;
  if (rule.kind === "import" && ts.isImportDeclaration(node) &&
    !node.importClause?.isTypeOnly && !onlyNamedTypes && ts.isStringLiteral(node.moduleSpecifier)) {
    const symbol = node.moduleSpecifier.text;
    if (matches(rule.symbolPattern, symbol)) return { symbol, subject: symbol };
  }
  if (rule.kind === "function") {
    const symbol = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
      ? node.name?.getText(source)
      : ts.isVariableDeclaration(node) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
          ? node.name.getText(source) : undefined;
    if (symbol && matches(rule.symbolPattern, symbol)) {
      return { symbol, subject: node.getText(source) };
    }
  }
  if (rule.kind === "literal-branch" && ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]
      .includes(node.operatorToken.kind) &&
    (ts.isStringLiteral(node.left) || ts.isStringLiteral(node.right))) {
    let functionName = "";
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) {
        functionName = parent.name?.getText(source) ?? "";
        break;
      }
      if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
        parent.parent && ts.isVariableDeclaration(parent.parent)) {
        functionName = parent.parent.name.getText(source);
        break;
      }
    }
    const operand = ts.isStringLiteral(node.left) ? node.right.getText(source) : node.left.getText(source);
    const relevant = rule.id === "17" ? matches(rule.symbolPattern, operand)
      : matches(rule.symbolPattern, functionName) || matches(rule.symbolPattern, operand);
    if (relevant) {
      return { symbol: (functionName || "expression") + ":" + operand + ":lexical-branch",
        subject: node.getText(source) };
    }
  }
  if (rule.kind === "call" && ts.isCallExpression(node)) {
    const symbol = node.expression.getText(source);
    const argumentsText = node.arguments.map(a => a.getText(source)).join(" ");
    if (matches(rule.symbolPattern, symbol) && matches(rule.evidencePattern, argumentsText)) {
      return { symbol, subject: node.getText(source) };
    }
  }
  return null;
}

export function findFoodStaticCandidates(files: FoodArchitectureFile[]): FoodFinding[] {
  const results: FoodFinding[] = [];
  // Preserve multiplicity: adding an identical rule in another scope is still new.
  // A fixture or generated TS module imported by production must not escape
  // the gate solely because it lives under a normally excluded folder.
  const indexed = new Map(files.map(file => [file.path.replace(/\\/g, "/"), file]));
  const runtime = new Set(files.filter(file => isProductionFoodSource(file.path))
    .map(file => file.path.replace(/\\/g, "/")));
  const queue = [...runtime];
  for (let i = 0; i < queue.length; i++) {
    const file = indexed.get(queue[i]);
    if (!file) continue;
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    const addDependency = (specifier: string): void => {
      let base: string;
      if (specifier.startsWith(".")) {
        base = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), specifier));
      } else if (specifier.startsWith("@/")) {
        base = "client/src/" + specifier.slice(2);
      } else if (specifier.startsWith("@shared/")) {
        base = "shared/" + specifier.slice("@shared/".length);
      } else if (/^(?:server|shared|client\/src)\//.test(specifier)) {
        base = specifier;
      } else {
        return;
      }
      const candidates = [base, base + ".ts", base + ".tsx", base + ".mts",
        base + ".cts", base + "/index.ts", base + "/index.tsx",
        base + "/index.mts", base + "/index.cts"];
      for (const candidate of candidates) {
        if (indexed.has(candidate) && !runtime.has(candidate)) {
          runtime.add(candidate);
          queue.push(candidate);
        }
      }
    };
    const follow = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
          !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        const namedTypesOnly = bindings && ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 && bindings.elements.every(e => e.isTypeOnly) &&
          !node.importClause?.name;
        if (!namedTypesOnly) addDependency(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
        const clause = node.exportClause;
        const typesOnly = clause && ts.isNamedExports(clause) &&
          clause.elements.length > 0 && clause.elements.every(e => e.isTypeOnly);
        if (!typesOnly) addDependency(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && node.arguments.length > 0 &&
          ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        addDependency(node.arguments[0].text);
      }
      ts.forEachChild(node, follow);
    };
    ts.forEachChild(source, follow);
  }
  for (const file of files) {
    if (!runtime.has(file.path.replace(/\\/g, "/"))) continue;
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      for (const rule of FOOD_WAVE_ONE_RULES) {
        if (!matches(rule.pathPattern, file.path)) continue;
        const finding = ruleEvidence(node, source, rule);
        if (!finding) continue;
        const fingerprint = rule.id + ":" + file.path + ":" + finding.symbol + ":" + stableHash(finding.subject);
        results.push({
          ruleId: rule.id,
          file: file.path,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          symbol: finding.symbol,
          fingerprint,
          failureClass: failureClass(rule, finding.symbol),
          description: rule.description,
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return results.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}

export function findCompetingOwnerInventory(files: FoodArchitectureFile[]) {
  return findFoodStaticCandidates(files).map(finding => ({
    ...finding,
    suspectedChannelOwner: /whatsapp|image|audio|ocr|vision|handler|router/i.test(finding.file),
    status: "requires-review" as const,
  }));
}

/** The non-lexicon, non-materiality wave-one detectors. */
export function findFoodIntelligenceViolations(files: FoodArchitectureFile[]) {
  return findFoodStaticCandidates(files).filter(finding => finding.ruleId !== "11" && finding.ruleId !== "18");
}
