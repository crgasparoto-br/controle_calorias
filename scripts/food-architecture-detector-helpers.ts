import ts from "typescript";
import { FOOD_WAVE_ONE_RULES } from "./food-architecture-rules";
import type { FoodFinding } from "./food-intelligence-architecture";

type Unwrap = (expr: ts.Expression) => ts.Expression;

function isStaticNutritionNumber(expr: ts.Expression, unwrap: Unwrap): boolean {
  const value = unwrap(expr);
  return ts.isNumericLiteral(value) ||
    (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand));
}

/** A food resolver must not hardcode macros merely by omitting foodId/name. */
export function isAnonymousFoodNutrition(node: ts.ObjectLiteralExpression, fields: Map<string, ts.Expression>, enclosingDeclaration: (node: ts.Node) => string, unwrap: Unwrap): boolean {
  const context = node.getSourceFile().fileName + " " + enclosingDeclaration(node);
  if (!/food|aliment|meal|nutrition|nutrient|ingredient|portion|serving|recipe/i.test(context) ||
      /exercise|activity|workout|fitness|sport|burnedcalories/i.test(context)) return false;
  const macros = ["protein", "carbs", "fat", "kcal", "energykcal"].filter(key => {
    const value = fields.get(key);
    return value !== undefined && isStaticNutritionNumber(value, unwrap);
  });
  const calories = fields.get("calories");
  return macros.length >= 2 || (macros.length >= 1 &&
    calories !== undefined && isStaticNutritionNumber(calories, unwrap));
}


export function referencesLiteralLexicalMap(target: ts.Expression, node: ts.Node, unwrap: Unwrap): boolean {
  const value = unwrap(target);
  if (ts.isObjectLiteralExpression(value)) return isLexicalMap(value, unwrap);
  if (!ts.isIdentifier(value)) return false;
  for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === value.text) {
          return !!declaration.initializer && isLexicalMap(declaration.initializer, unwrap);
        }
      }
    }
  }
  return false;
}

export function isLexicalMap(expr: ts.Expression, unwrap: Unwrap): boolean {
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

export function isStaticText(expr: ts.Node): expr is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr);
}


export function isPresentationOnlyFilter(node: ts.VariableDeclaration, source: ts.SourceFile, unwrap: Unwrap): boolean {
  if (!/^client\/src\/.*\.(?:tsx|jsx)$/i.test(source.fileName) || !node.initializer) return false;
  const symbol = node.name.getText(source);
  if (!/(?:^|[_-])(?:filters?|views?|facets?|sorts?)(?:$|[_-])|(?:Filters?|Views?|Facets?)$/i.test(symbol)) return false;
  const value = unwrap(node.initializer);
  if (!ts.isArrayLiteralExpression(value) || value.elements.length === 0 ||
      !value.elements.every(element => isStaticText(unwrap(element)))) return false;
  let decisionUse = false;
  const scan = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate) && ts.isPropertyAccessExpression(candidate.expression) &&
        ["includes", "has", "indexOf", "some", "find", "filter", "every"].includes(candidate.expression.name.text) &&
        candidate.expression.expression.getText(source) === symbol) decisionUse = true;
    if (ts.isElementAccessExpression(candidate) &&
        candidate.expression.getText(source) === symbol) decisionUse = true;
    ts.forEachChild(candidate, scan);
  };
  scan(source);
  return !decisionUse;
}


export function findTransitiveAlternativeResolverFindings(
  dependencyGraph: Map<string, Set<string>>,
  runtime: Set<string>,
  isProductionFoodSource: (file: string) => boolean,
  stableHash: (value: string) => string,
): FoodFinding[] {
  // A neutral barrel module does not make an alternative resolver safe:
  // traverse import edges from channel entrypoints to legacy decision owners.
  const results: FoodFinding[] = [];
  const alternateResolver = /nutritionEngine|foodItemResolution|catalogMatching|foodSemanticCompatibility/i;
  const gate10 = FOOD_WAVE_ONE_RULES.find(rule => rule.id === "10" && rule.kind === "import");
  if (gate10) for (const origin of [...runtime].filter(file =>
    isProductionFoodSource(file) && (!gate10.pathPattern || new RegExp(gate10.pathPattern, "i").test(file)))) {
    const frontier: Array<{ file: string; depth: number }> = [{ file: origin, depth: 0 }];
    const visited = new Set<string>([origin]);
    for (let i = 0; i < frontier.length; i++) {
      const { file, depth } = frontier[i];
      for (const dependency of dependencyGraph.get(file) ?? []) {
        if (visited.has(dependency)) continue;
        visited.add(dependency);
        const nextDepth = depth + 1;
        if (nextDepth >= 2 && alternateResolver.test(dependency)) {
          const symbol = "transitive-import:" + dependency;
          results.push({
            ruleId: "10", file: origin, line: 1, symbol,
            fingerprint: "10:" + origin + ":" + symbol + ":" + stableHash(symbol),
            failureClass: "E",
            description: "Canal alcança resolvedor alimentar alternativo por importação indireta",
          });
        }
        frontier.push({ file: dependency, depth: nextDepth });
      }
    }
  }
  return results;
}
