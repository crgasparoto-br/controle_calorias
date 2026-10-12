/**
 * Food Intelligence V2, ADR §19: static discovery for gates 17 and 18.
 * Detection is conservative: this reports candidates for review, never
 * authorizes a debt entry or silently expands the blocking scope (ADR §25).
 */
import ts from "typescript";

export type FoodArchitectureFile = { path: string; content: string };
export type FoodFinding = {
  ruleId: "17" | "18";
  file: string;
  line: number;
  symbol: string;
  failureClass: "A" | "B" | "C" | "I";
  fingerprint: string;
};

const FOOD_DECLARATION = /(?:food|alimento|nutrition|nutrient|macro|portion|porcao|porção|classification|processingLevel|alias|synonym|lexicon|vocab|ingredient|catalog|serving)/i;
const MATERIALITY = /(?:materiality|materialidade|nutritionallyNeutral|neutralPackaging|commercialCategory|attributeMaterial|materialAttribute)/i;
const MATERIALITY_DECISION = /(?:token|term|word|keyword|lexical|lexic|descriptor|qualifier)/i;
const CHANNEL = /(?:whatsapp|inbound|image|audio|ocr|transcri|handler|router)/i;

export function isProductionFoodSource(file: string): boolean {
  const p = file.replace(/\\/g, "/");
  return p.startsWith("server/") &&
    /\.[cm]?tsx?$/.test(p) &&
    !/\.d\.ts$|\.(?:test|spec)\.[cm]?tsx?$|(?:^|\/)(?:__tests__|__fixtures__|fixtures|generated)(?:\/|$)/i.test(p);
}

function category(name: string, ruleId: "17" | "18"): FoodFinding["failureClass"] {
  if (ruleId === "18") return "B";
  if (/portion|porc|serving|macro|nutrition|nutrient/i.test(name)) return "C";
  if (/alias|lexic|synonym|vocab|term/i.test(name)) return "A";
  return "I";
}

export function findFoodStaticCandidates(files: FoodArchitectureFile[]): FoodFinding[] {
  const out: FoodFinding[] = [];
  for (const file of files) {
    if (!isProductionFoodSource(file.path)) continue;
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) {
        const name = node.name.getText(source);
        const initializer = node.initializer;
        if (initializer) {
          const array = ts.isArrayLiteralExpression(initializer);
          const set = ts.isNewExpression(initializer) &&
            initializer.expression.getText(source) === "Set" &&
            !!initializer.arguments?.some(ts.isArrayLiteralExpression);
          const literalMap = ts.isObjectLiteralExpression(initializer);
          const location = source.getLineAndCharacterOfPosition(node.getStart(source));
          const ruleId: "17" | "18" | null =
            (MATERIALITY.test(name) && MATERIALITY_DECISION.test(name) && (array || set || literalMap))
              ? "18"
              : FOOD_DECLARATION.test(name) && (array || set || literalMap)
                ? "17" : null;
          if (ruleId) {
            const symbol = name.replace(/^["']|["']$/g, "");
            // fingerprint is stable across line movement; cannot mask other symbols in same file.
            out.push({
              ruleId, file: file.path, line: location.line + 1, symbol,
              failureClass: category(symbol, ruleId),
              fingerprint: ruleId + ":" + file.path + ":" + symbol,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return out.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}

/** Channel-owned declarations are discovery signals, not proof of competing decisions. */
export function findCompetingOwnerInventory(files: FoodArchitectureFile[]) {
  return findFoodStaticCandidates(files).map(finding => ({
    ...finding,
    suspectedChannelOwner: CHANNEL.test(finding.file),
    status: "requires-review" as const,
  }));
}
