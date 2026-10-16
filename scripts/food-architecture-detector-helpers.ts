import ts from "typescript";
import { FOOD_WAVE_ONE_RULES } from "./food-architecture-rules";
import type { FoodArchitectureFile, FoodFinding } from "./food-intelligence-architecture";

type Unwrap = (expr: ts.Expression) => ts.Expression;

function isStaticNutritionNumber(expr: ts.Expression, unwrap: Unwrap): boolean {
  const value = unwrap(expr);
  if (ts.isNumericLiteral(value)) return true;
  if (ts.isPrefixUnaryExpression(value) &&
      [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(value.operator)) {
    return isStaticNutritionNumber(value.operand, unwrap);
  }
  if (ts.isBinaryExpression(value) &&
      [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
        ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken]
        .includes(value.operatorToken.kind)) {
    const right = unwrap(value.right);
    if (ts.isNumericLiteral(right) && Number(right.text) === 0 &&
        [ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken].includes(value.operatorToken.kind)) return false;
    return isStaticNutritionNumber(value.left, unwrap) && isStaticNutritionNumber(value.right, unwrap);
  }
  return false;
}

/** A food resolver must not hardcode macros merely by omitting foodId/name. */
export function isAnonymousFoodNutrition(
  node: ts.ObjectLiteralExpression, fields: Map<string, ts.Expression>,
  enclosingDeclaration: (node: ts.Node) => string, unwrap: Unwrap,
  isStaticallyNumeric: (value: ts.Expression) => boolean = value => isStaticNutritionNumber(value, unwrap),
): boolean {
  const context = node.getSourceFile().fileName + " " + enclosingDeclaration(node);
  if (!/food|aliment|meal|nutrition|nutrient|ingredient|portion|serving|recipe/i.test(context) ||
      /exercise|activity|workout|fitness|sport|burnedcalories/i.test(context)) return false;
  const macros = ["protein", "carbs", "fat", "kcal", "energykcal"].filter(key => {
    const value = fields.get(key);
    return value !== undefined && isStaticallyNumeric(value);
  });
  const calories = fields.get("calories");
  const fixedCalories = calories !== undefined && isStaticallyNumeric(calories);
  if (macros.length >= 2 || (macros.length >= 1 && fixedCalories)) return true;
  // A resolver can return a single hardcoded nutrient without a named food
  // field. Restrict this extra case to a decision return, not arbitrary UI or
  // activity summaries that also happen to have a "calories" property.
  const directReturn = ts.isReturnStatement(node.parent) ||
    (ts.isArrowFunction(node.parent) && node.parent.body === node);
  const decisionName = enclosingDeclaration(node);
  const foodDecision = /resolve|infer|select|decide|lookup|find|calculate|estimate|classif|portion|nutrition|nutrient|macro|calor/i.test(decisionName);
  return directReturn && foodDecision && (fixedCalories || macros.length > 0);
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


/**
 * Gate 10 is about a competing decision owner, not merely an imported filename.
 * Exclude only a statically proven inert no-op edge. Unknown runtime bindings
 * and side-effect imports remain fail-closed.
 */
function isProvenInertResolverEdge(
  importerPath: string,
  targetPath: string,
  files: Map<string, FoodArchitectureFile>,
  resolveDeps: (from: string, specifier: string, indexed: Map<string, FoodArchitectureFile>) => string[],
): boolean {
  const importer = files.get(importerPath);
  const target = files.get(targetPath);
  if (!importer || !target) return false;
  const imported = ts.createSourceFile(importer.path, importer.content, ts.ScriptTarget.Latest, true);
  const targetSource = ts.createSourceFile(target.path, target.content, ts.ScriptTarget.Latest, true);
  const symbols: string[] = [];
  let importsTarget = false;
  for (const stmt of imported.statements) {
    const literal = (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) &&
      stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
        ? stmt.moduleSpecifier.text : undefined;
    if (!literal || !resolveDeps(importerPath, literal, files).includes(targetPath)) continue;
    importsTarget = true;
    if (ts.isImportDeclaration(stmt) && stmt.importClause &&
        !stmt.importClause.isTypeOnly && !stmt.importClause.name &&
        stmt.importClause.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
      for (const spec of stmt.importClause.namedBindings.elements) {
        if (!spec.isTypeOnly) symbols.push(spec.propertyName?.text ?? spec.name.text);
      }
    } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly && stmt.exportClause &&
               ts.isNamedExports(stmt.exportClause)) {
      for (const spec of stmt.exportClause.elements) {
        if (!spec.isTypeOnly) symbols.push(spec.propertyName?.text ?? spec.name.text);
      }
    } else {
      // Namespace/default imports, export-star and unknown import shapes
      // could reference a real resolver: do not grant an exemption.
      return false;
    }
  }
  if (!importsTarget || symbols.length === 0) return false;
  // An imported module may execute work at import time even if the requested
  // binding is inert. Conservatively reject the exemption in that case.
  // Only declaration-only modules are provably inert. Constructors, static
  // initializers, import-equals and unknown top-level code execute on import.
  if (!targetSource.statements.every(stmt =>
    ts.isFunctionDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) || ts.isEmptyStatement(stmt) ||
    (ts.isImportDeclaration(stmt) && !!stmt.importClause?.isTypeOnly) ||
    (ts.isExportDeclaration(stmt) && stmt.isTypeOnly))) return false;
  return symbols.every(symbol => {
    if (!/^noop$/i.test(symbol)) return false;
    const declaration = targetSource.statements.find(stmt =>
      ts.isFunctionDeclaration(stmt) && stmt.name?.text === symbol);
    if (!declaration || !ts.isFunctionDeclaration(declaration) ||
        !declaration.body || declaration.body.statements.length !== 1 ||
        declaration.parameters.some(parameter => !!parameter.initializer ||
          !ts.isIdentifier(parameter.name))) return false;
    const only = declaration.body.statements[0];
    return ts.isReturnStatement(only) && only.expression?.kind === ts.SyntaxKind.NullKeyword;
  });
}

export function findTransitiveAlternativeResolverFindings(
  dependencyGraph: Map<string, Set<string>>,
  runtime: Set<string>,
  isProductionFoodSource: (file: string) => boolean,
  stableHash: (value: string) => string,
  files: FoodArchitectureFile[],
  resolveDeps: (from: string, specifier: string, indexed: Map<string, FoodArchitectureFile>) => string[],
): FoodFinding[] {
  // A neutral barrel module does not make an alternative resolver safe:
  // traverse import edges from channel entrypoints to legacy decision owners.
  const results: FoodFinding[] = [];
  const filesByPath = new Map(files.map(file => [file.path.replace(/\\/g, "/"), file]));
  const neutralEdgeCache = new Map<string, boolean>();
  const neutralEdge = (from: string, to: string): boolean => {
    const key = from + "\0" + to;
    if (!neutralEdgeCache.has(key)) neutralEdgeCache.set(key,
      isProvenInertResolverEdge(from, to, filesByPath, resolveDeps));
    return neutralEdgeCache.get(key)!;
  };
  const alternateResolver = /nutritionEngine|foodItemResolution|catalogMatching|foodSemanticCompatibility/i;
  const gate10 = FOOD_WAVE_ONE_RULES.find(rule => rule.id === "10" && rule.kind === "import");
  if (gate10) for (const origin of [...runtime].filter(file =>
    isProductionFoodSource(file) && (!gate10.pathPattern || new RegExp(gate10.pathPattern, "i").test(file)))) {
    const frontier: Array<{ file: string; depth: number }> = [{ file: origin, depth: 0 }];
    const visited = new Set<string>([origin]);
    const emitted = new Set<string>();
    for (let i = 0; i < frontier.length; i++) {
      const { file, depth } = frontier[i];
      for (const dependency of dependencyGraph.get(file) ?? []) {
        const nextDepth = depth + 1;
        // Check every edge before the visited guard: another path might
        // carry a real resolver while the first path was inert.
        if (nextDepth >= 2 && alternateResolver.test(dependency) &&
            !emitted.has(dependency) && !neutralEdge(file, dependency)) {
          const symbol = "transitive-import:" + dependency;
          results.push({
            ruleId: "10", file: origin, line: 1, symbol,
            fingerprint: "10:" + origin + ":" + symbol + ":" + stableHash(symbol),
            failureClass: "E",
            description: "Canal alcança resolvedor alimentar alternativo por importação indireta",
          });
          emitted.add(dependency);
        }
        if (visited.has(dependency)) continue;
        visited.add(dependency);
        frontier.push({ file: dependency, depth: nextDepth });
      }
    }
  }
  return results;
}
