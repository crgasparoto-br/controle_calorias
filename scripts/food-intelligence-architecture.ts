/**
 * Static, AST-backed Food Intelligence V2 architecture discovery (ADR §19).
 * Do not confuse a candidate with a proven behavioral violation: the wave-one
 * registry remains preview until ADR §25 item 25 defines the final scope.
 */
import ts from "typescript";
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
  return p.startsWith("server/") &&
    /\.[cm]?tsx?$/.test(p) &&
    !/\.d\.ts$|\.(?:test|spec)\.[cm]?tsx?$|(?:^|\/)(?:__tests__|__fixtures__|fixtures|generated)(?:\/|$)/i.test(p);
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

function stableHash(value: string): string {
  // FNV-1a over the AST subtree; whitespace-only changes are not debt changes.
  let h = 2166136261;
  const normalized = value.replace(/\s+/g, " ").trim();
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
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
    if ((matches(rule.symbolPattern, symbol) ||
        (rule.contentPattern && matches(rule.contentPattern, node.initializer.getText(source)))) &&
        matches(rule.evidencePattern, symbol)) {
      return { symbol, subject: node.initializer.getText(source) };
    }
  }
  if (rule.kind === "import" && ts.isImportDeclaration(node) &&
    !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
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
  const observed = new Set<string>();
  for (const file of files) {
    if (!isProductionFoodSource(file.path)) continue;
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      for (const rule of FOOD_WAVE_ONE_RULES) {
        if (!matches(rule.pathPattern, file.path)) continue;
        const finding = ruleEvidence(node, source, rule);
        if (!finding) continue;
        const fingerprint = rule.id + ":" + file.path + ":" + finding.symbol + ":" + stableHash(finding.subject);
        if (observed.has(fingerprint)) continue;
        observed.add(fingerprint);
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
