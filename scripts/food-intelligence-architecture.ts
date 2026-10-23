/**
 * Static, AST-backed Food Intelligence V2 architecture discovery (ADR §19).
 * Do not confuse a candidate with a proven behavioral violation: the wave-one
 * registry blocks NEW findings after item 25 approval; existing legacy stays visible.
 */
import ts from "typescript";
import { unshadowedIntrinsic, isNativeViteFetchTarget, hasStaticNativeFetchRequestInit } from "./food-architecture-native-fetch";
import path from "node:path";
import { isImmutableNumericSpread } from "./food-architecture-numeric-spreads";
import { isLiteralMealChoiceData, findConsumedMealChoiceCatalogs } from "./food-architecture-meal-choices";
import { findImportedLexicalFoodFindings } from "./food-architecture-lexical-imports";
import { FOOD_WAVE_ONE_RULES, type FoodWaveOneRuleId, type FoodWaveOneRule } from "./food-architecture-rules";
import {
  isAnonymousFoodNutrition, referencesLiteralLexicalMap, isLexicalMap,
  isStaticText, isPresentationOnlyFilter, findTransitiveAlternativeResolverFindings,
} from "./food-architecture-detector-helpers";

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

/**
 * ADR §4.1: the canonical LCL must implement numeric/lexical grammar without
 * becoming a competing food-identity or nutrition rule engine.
 *
 * Only these audited grammar expressions in this *specific* owner are exempt
 * from the wave-one generic lexical candidate heuristic. Food-specific maps,
 * unknown functions and channel/adapters remain fully checked. This is not a
 * blanket file or directory exclusion.
 */
function isCanonicalLinguisticGrammar(
  file: string, rule: FoodWaveOneRule, finding: { symbol: string; subject: string },
): boolean {
  if (file === "server/modules/foodIntelligenceV2/linguisticComprehension.ts") {
    if (["17", "5"].includes(rule.id) && rule.kind === "numeric-map" &&
        finding.symbol === "writtenNumbers:numeric-food-map") {
      const keys = new Set(["um", "uma", "dois", "duas", "tres", "quatro", "cinco", "seis",
        "sete", "oito", "nove", "dez", "meio", "meia"]);
      const pairs = [...finding.subject.matchAll(/\b([a-z]+)\s*:\s*(\d+(?:\.\d+)?)/g)];
      return pairs.length >= 10 && pairs.every(match =>
        keys.has(match[1]) && Number(match[2]) >= 0.5 && Number(match[2]) <= 10);
    }
    if (["17", "18"].includes(rule.id)) {
      const regexGrammar = /^(?:foldFoodSurface|parseNumber|readQuantity|splitFoodSurface|foodOnlySpan|qualifierKey):lexical-regex$/u;
      if (regexGrammar.test(finding.symbol) &&
          rule.kind === "literal-regex-test") return true;
      if (finding.symbol === "recognizedUnit:lexical-dictionary" &&
          rule.kind === "lexical-lookup" &&
          /^unitMap\s*\[\s*foldFoodSurface\s*\(/u.test(finding.subject)) return true;
      if (finding.symbol === "splitFoodSurface:char:lexical-branch" &&
          rule.kind === "literal-branch") return true;
    }
    // Selecting already validated, versioned lexicon rows is not a second
    // identity resolver; the nutrition/food resolver remains elsewhere.
    if (rule.id === "2" && rule.kind === "function" &&
        finding.symbol === "selectLexicon") return true;
  }
  // A dynamic store callback holding no food catalog is not a literal food map.
  return file === "server/modules/foodIntelligenceV2/linguisticLexiconRepository.ts" &&
    rule.id === "17" && rule.kind === "collection" &&
    finding.symbol === "governedLinguisticLexiconStore" &&
    /\bload\b/u.test(finding.subject) && !/\b(?:calories|protein|carbs|fat)\s*:/iu.test(finding.subject);
}

export function isProductionFoodSource(file: string): boolean {
  const p = file.replace(/\\/g, "/");
  return (p.startsWith("server/") || p.startsWith("shared/") || p.startsWith("client/src/")) &&
    /\.(?:[cm]?[jt]sx?|json)$/.test(p) &&
    !/\.d\.ts$|\.(?:test|spec|fixture|fixtures|mock|stories|generated)\.(?:[cm]?[jt]sx?|json)$|(?:^|\/)(?:__tests__|__fixtures__|__mocks__|fixtures|testFixtures|test-fixtures|generated|__generated__|mocks|stories)(?:\/|$)/i.test(p);
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

/** CommonJS loader is authoritative only when its lexical binding is Node's
 * require, not a local parameter, function, import or variable. Reuse this
 * proof for reachability and JSON/filesystem provenance alike. */
function isNodeRequireCall(node: ts.CallExpression): boolean {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "require") return false;
  const declaresRequire = (name: ts.BindingName): boolean =>
    ts.isIdentifier(name) ? name.text === "require" :
    name.elements.some(element => ts.isBindingElement(element) && declaresRequire(element.name));
  for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(param => declaresRequire(param.name))) return false;
    if (ts.isCatchClause(scope) && scope.variableDeclaration &&
        declaresRequire(scope.variableDeclaration.name)) return false;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some(decl => declaresRequire(decl.name))) return false;
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
          statement.name?.text === "require") return false;
      if (ts.isImportEqualsDeclaration(statement) && statement.name.text === "require") return false;
      if (ts.isImportDeclaration(statement) && statement.importClause &&
          (statement.importClause.name?.text === "require" ||
            (statement.importClause.namedBindings &&
              (ts.isNamespaceImport(statement.importClause.namedBindings)
                ? statement.importClause.namedBindings.name.text === "require"
                : statement.importClause.namedBindings.elements.some(el => el.name.text === "require"))))) return false;
    }
  }
  return true;
}

/** Context-keyed meal suggestion catalogs are food knowledge even when a
 * local identifier is simply "optionsByContext". Presentation-only status
 * labels and unrelated arrays must not be treated as nutrition knowledge. */
function isLiteralFoodMealChoiceCatalog(expr: ts.Expression, node: ts.VariableDeclaration): boolean {
  if (!isLiteralMealChoiceData(expr)) return false;
  // Food knowledge is determined by the consumer, not a fixed vocabulary of meals.
  const owner = enclosingDeclaration(node);
  const foodDecision = /food|alimen|meal|nutri|ingred|recipe|receita/i.test(owner + " " + node.getSourceFile().fileName) ||
    /^(?:buildAssistantReply|buildMealSuggestions|buildFoodPlan)/i.test(owner);
  if (!foodDecision || !/^(?:suggest|recommend|buildAssistantReply|buildMealSuggestions|buildFoodPlan)/i.test(owner) ||
      !ts.isIdentifier(node.name)) return false;
  let consumedByContext = false;
  let functionParent: ts.Node | null = null;
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) { functionParent = parent; break; }
  }
  if (!functionParent) return false;
  const visit = (child: ts.Node): void => {
    if (ts.isElementAccessExpression(child) && ts.isIdentifier(child.expression) &&
        child.expression.text === node.name.getText() && child.argumentExpression &&
        !ts.isStringLiteral(child.argumentExpression)) consumedByContext = true;
    ts.forEachChild(child, visit);
  };
  visit(functionParent);
  return consumedByContext;
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
    if (ts.isShorthandPropertyAssignment(property)) {
      // Shorthand identities like { foodId, calories: 100 } must not
      // bypass the static food knowledge gate.
      fields.set(property.name.text.toLowerCase(), property.name);
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name.getText().replace(/^['"]|['"]$/g, "").toLowerCase();
    fields.set(key, unwrap(property.initializer));
  }
  const nameKeys = ["name", "foodname", "alimento", "productname", "label", "nome", "productlabel"];
  const hasNamedFood = nameKeys.some(key => {
    const value = fields.get(key);
    if (!value) return false;
    // A food identity may be selected at runtime while its macro data remain
    // hardcoded. Do not require the food name itself to be a string literal.
    const nameIsFoodSpecific = key !== "name" && key !== "label" && key !== "nome";
    const foodContext = /food|alimento|meal|ingredient|nutrition|nutrient|macro|portion|porc|product/i.test(
      value.getText() + " " + enclosingDeclaration(node) + " " + node.getSourceFile().fileName);
    const numericNutrientCount = ["calories", "kcal", "protein", "carbs", "fat", "energykcal"]
      .filter(nutrient => {
        const nutrientValue = fields.get(nutrient);
        return nutrientValue && staticNutritionNumber(nutrientValue) !== null;
      }).length;
    const domainEvidence = ["kcal", "protein", "carbs", "fat", "energykcal",
      "portiongrams", "portion_grams", "servinggrams", "serving_grams",
      "aliases", "synonyms", "classification", "processinglevel"]
      .some(field => fields.has(field));
    // A literal "name" + one calorie count could be an exercise/activity.
    if (ts.isStringLiteral(value)) {
      return nameIsFoodSpecific || foodContext || domainEvidence;
    }
    return nameIsFoodSpecific || foodContext || numericNutrientCount >= 2;
  });
  // A stable food identifier may be a runtime variable while its nutrition
  // numbers are hardcoded in a nameless collection.
  const hasFoodIdentifier = ["foodid", "food_id", "alimentoid", "alimento_id", "productfoodid"].some(key =>
    fields.has(key));
  const hasLiteralNutrition = ["calories", "kcal", "protein", "carbs", "fat", "grams",
    "portiongrams", "portion_grams", "servinggrams", "serving_grams", "energykcal"].some(key => {
      const value = fields.get(key);
      return value !== undefined && staticNutritionNumber(value) !== null;
    });
  const hasNestedLiteralNutrition = ["macros", "nutrition", "nutrients"].some(key => {
    const block = fields.get(key);
    return block && ts.isObjectLiteralExpression(block) && block.properties.some(property => {
      if (!ts.isPropertyAssignment(property)) return false;
      const name = property.name.getText().replace(/^['"]|['"]$/g, "").toLowerCase();
      const value = unwrap(property.initializer);
      return /^(?:calories|kcal|protein|carbs|fat|energykcal)$/.test(name) &&
        staticNutritionNumber(value) !== null;
    });
  });
  return ((hasNamedFood || hasFoodIdentifier) &&
    (hasLiteralNutrition || hasNestedLiteralNutrition)) ||
    isAnonymousFoodNutrition(node, fields, enclosingDeclaration, unwrap,
      value => staticNutritionNumber(value) !== null);
}

/** Nutrition maps may hold literal nutrient objects instead of bare numbers.
 * A food-indexed consumer, not the arbitrary map keys, determines food scope. */
/** Only arithmetic derived entirely from constants is hardcoded nutrition.
 * Mixed provider/DB values remain dynamic and must not be guessed as rules. */
function staticNutritionNumber(
  value: ts.Expression, visited = new Set<ts.VariableDeclaration>(), depth = 0,
): number | null {
  if (depth > 12) return null;
  const expr = unwrap(value);
  if (ts.isIdentifier(expr)) {
    // Resolve only immutable lexical bindings. A DB result, parameter, mutable
    // variable or shadowed name is not a proven hardcoded nutritional number.
    const source = expr.getSourceFile();
    for (let scope: ts.Node | undefined = expr; scope; scope = scope.parent) {
      if ((ts.isFunctionDeclaration(scope) || ts.isMethodDeclaration(scope) ||
          ts.isArrowFunction(scope) || ts.isFunctionExpression(scope)) &&
          scope.parameters.some(parameter => ts.isIdentifier(parameter.name) &&
            parameter.name.text === expr.text)) return null;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== expr.text) continue;
          if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
              !declaration.initializer || declaration.getStart(source) >= expr.getStart(source) ||
              visited.has(declaration)) return null;
          const next = new Set(visited);
          next.add(declaration);
          return staticNutritionNumber(declaration.initializer, next, depth + 1);
        }
      }
    }
    return null;
  }
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) &&
      expr.expression.text === "Number" && expr.arguments.length === 1 &&
      unshadowedIntrinsic("Number", expr)) {
    return staticNutritionNumber(expr.arguments[0], visited, depth + 1);
  }
  if (ts.isPrefixUnaryExpression(expr) &&
      [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(expr.operator)) {
    const operand = staticNutritionNumber(expr.operand, visited, depth + 1);
    if (operand === null) return null;
    const result = expr.operator === ts.SyntaxKind.MinusToken ? -operand : operand;
    return Number.isFinite(result) ? result : null;
  }
  if (ts.isBinaryExpression(expr)) {
    const left = staticNutritionNumber(expr.left, visited, depth + 1);
    const right = staticNutritionNumber(expr.right, visited, depth + 1);
    if (left === null || right === null) return null;
    let result: number;
    switch (expr.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken: result = left + right; break;
      case ts.SyntaxKind.MinusToken: result = left - right; break;
      case ts.SyntaxKind.AsteriskToken: result = left * right; break;
      case ts.SyntaxKind.SlashToken: result = left / right; break;
      case ts.SyntaxKind.PercentToken: result = left % right; break;
      case ts.SyntaxKind.AsteriskAsteriskToken: result = left ** right; break;
      default: return null;
    }
    return Number.isFinite(result) ? result : null;
  }
  return null;
}

function isLiteralNutritionRecord(value: ts.Expression): boolean {
  const record = unwrap(value);
  if (!ts.isObjectLiteralExpression(record) || record.properties.length === 0) return false;
  return record.properties.some(property => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = property.name.getText().replace(/^['"]|['"]$/g, "").toLowerCase();
    if (/^(?:nutrition|nutrients|macros)$/.test(name)) {
      return isLiteralNutritionRecord(property.initializer);
    }
    if (!/^(?:calories|kcal|energykcal|protein|carbs|fat|fiber|grams|portiongrams|portion_grams|servinggrams|serving_grams)$/.test(name)) return false;
    return staticNutritionNumber(property.initializer) !== null;
  });
}

function isLiteralNumericFoodValue(value: ts.Expression): boolean {
  const expr = unwrap(value);
  return staticNutritionNumber(expr) !== null || isLiteralNutritionRecord(expr);
}

/** Contract size limits are not per-food nutrition or portion knowledge.
 * This exemption is narrow: food-indexed use or an unknown/nutrient key still
 * remains eligible for the gate even when the symbol says "LIMITS". */
function isPureContractSizeBounds(value: ts.Expression): boolean {
  const object = unwrap(value);
  if (!ts.isObjectLiteralExpression(object) || object.properties.length === 0) return false;
  const structuralKeys = new Set([
    "rawtext", "identifier", "shorttext", "nametext", "collection",
    "qualifiers", "alternatives", "observations",
  ]);
  return object.properties.every(property =>
    ts.isPropertyAssignment(property) &&
    structuralKeys.has(property.name.getText().replace(/^['"]|['"]$/g, "").toLowerCase()) &&
    staticNutritionNumber(property.initializer) !== null);
}

/**
 * A literal vocabulary of contract field paths is schema metadata, not
 * food-specific nutritional knowledge. Require both a structural naming
 * convention and dotted field keys; a mixed list or a food catalog still
 * reaches gate 17, including when disguised as a field list.
 */
function isStructuralEvidenceFieldVocabulary(node: ts.VariableDeclaration): boolean {
  if (!node.initializer || !ts.isIdentifier(node.name) ||
      !/(?:^|_)(?:EVIDENCE|SCHEMA|CONTRACT)_(?:FIELDS?|PATHS?)$/i.test(node.name.text)) {
    return false;
  }
  const initializer = unwrap(node.initializer);
  return ts.isArrayLiteralExpression(initializer) && initializer.elements.length > 0 &&
    initializer.elements.every(element => {
      const field = unwrap(element);
      return isStaticText(field) &&
        /^(?:identity|variant|quantity|nutrition|classification)\.[A-Za-z][A-Za-z0-9_]*$/.test(field.text);
    });
}

/** Numeric policy metadata is not food knowledge: only known structural
 * constraints qualify. An unknown key or food identity lookup stays gated. */
function isPureFoodAdministrativePolicy(node: ts.VariableDeclaration): boolean {
  if (!ts.isIdentifier(node.name) || !/(?:^|_)POLICY$/i.test(node.name.text) ||
      !node.initializer) return false;
  const value = unwrap(node.initializer);
  if (!ts.isObjectLiteralExpression(value) || !value.properties.length) return false;
  return value.properties.every(property =>
    ts.isPropertyAssignment(property) &&
    /^(?:max|min|ttl|persistence|precedence|localMapIsAuthoritative|directGlobalPromotionAllowed|enabled|retention|quota)/i
      .test(property.name.getText().replace(/^['"]|['"]$/g, "")));
}

/** User goal multipliers keyed by a nominal NutritionObjective are not an
 * item's food-specific macros. Imported/direct food-indexed use remains gated. */
function isNominalNutritionGoalMap(node: ts.VariableDeclaration): boolean {
  return !!node.type && /\bRecord\s*<\s*NutritionObjective\s*,\s*number\s*>/.test(node.type.getText());
}

function importedNumericMapRules(): FoodWaveOneRule[] {
  return FOOD_WAVE_ONE_RULES.filter(rule =>
    rule.detectorKey === "food-numeric-map-food" ||
    rule.detectorKey === "food-numeric-map-portions");
}

/** Domain-driven numeric maps need evidence of food identity, not food words
 * inside their arbitrary keys. Reuse the same rule for collections and lookups. */
function isLiteralNumericMap(value: ts.Expression, use?: ts.Node, visited = new Set<ts.VariableDeclaration>(), source?: ts.SourceFile): boolean {
  const object = unwrap(value);
  if (ts.isNewExpression(object) && ts.isIdentifier(object.expression) &&
      object.expression.text === "Map" && object.arguments?.length === 1) {
    const entries = unwrap(object.arguments[0]);
    return ts.isArrayLiteralExpression(entries) && entries.elements.length > 0 &&
      entries.elements.some(entry => {
        const pair = unwrap(entry);
        if (!ts.isArrayLiteralExpression(pair) || pair.elements.length !== 2) return false;
        const key = unwrap(pair.elements[0]);
        const number = unwrap(pair.elements[1]);
        const staticKey = source
          ? immutableDecisionString(key, pair, source) !== null
          : ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key);
        return staticKey && isLiteralNumericFoodValue(number);
      });
  }
  return ts.isObjectLiteralExpression(object) && object.properties.length > 0 &&
    object.properties.some(property => {
      if (ts.isSpreadAssignment(property)) return !!use && isImmutableNumericSpread(property.expression, use, visited,
        (expr, at, seen) => isLiteralNumericMap(expr, at, seen, source));
      if (!ts.isPropertyAssignment(property)) return false;
      if (ts.isComputedPropertyName(property.name)) {
        if (!source || immutableDecisionString(property.name.expression, property, source) === null) return false;
      } else if (!ts.isIdentifier(property.name) &&
          !ts.isStringLiteral(property.name) &&
          !ts.isNumericLiteral(property.name)) return false;
      return isLiteralNumericFoodValue(property.initializer);
    });
}

/** Resolve local aliases of the food identity without treating arbitrary
 * indexes as food. Only transparent string normalization may be followed. */
function foodIndexOrigin(value: ts.Expression, use: ts.Node, source: ts.SourceFile,
  visited = new Set<ts.VariableDeclaration>(), depth = 0): string {
  if (depth > 8) return "";
  const expr = unwrap(value);
  if (ts.isIdentifier(expr)) {
    for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
      if ((ts.isFunctionDeclaration(scope) || ts.isFunctionExpression(scope) ||
           ts.isArrowFunction(scope) || ts.isMethodDeclaration(scope)) &&
          scope.parameters.some(parameter =>
            ts.isIdentifier(parameter.name) && parameter.name.text === expr.text)) {
        return expr.text;
      }
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== expr.text) continue;
          if (!declaration.initializer || visited.has(declaration)) return expr.text;
          visited.add(declaration);
          return foodIndexOrigin(declaration.initializer, declaration, source, visited, depth + 1);
        }
      }
    }
    return expr.text;
  }
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee) &&
        /^(?:toLowerCase|toUpperCase|trim|normalize|replace|replaceAll)$/.test(callee.name.text)) {
      return foodIndexOrigin(callee.expression, use, source, visited, depth + 1);
    }
    if (ts.isIdentifier(callee) && /^(?:String|normalizeFoodName|normalizeFoodKey)$/.test(callee.text) &&
        expr.arguments.length) {
      return foodIndexOrigin(expr.arguments[0], use, source, visited, depth + 1);
    }
    // Preserve existing productive food-normalizer indices while following
    // transparent local aliases; never silently drop a legacy finding.
    return /food|aliment|portion|porc|serving/i.test(callee.getText(source))
      ? expr.getText(source) : "";
  }
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    return expr.getText(source);
  }
  return "";
}

function foodIndexContext(index: ts.Expression, node: ts.Node, source: ts.SourceFile): boolean {
  const name = foodIndexOrigin(index, node, source);
  const domain = source.fileName + " " + enclosingDeclaration(node);
  // An explicitly typed food identifier is domain evidence even in helpers.ts.
  const explicitIdentity = /(?:^|\.|\[["'])(?:foodName|foodId|foodLabel|foodKey|alimento|alimentoId|ingredientName|productName)(?:$|\b)/i.test(name);
  // The active decision's domain wins over a parameter's incidental name.
  // e.g. exercise(foodName) must not turn exercise weights into food macros.
  if (/exercise|activity|workout|fitness|burnedcalories/i.test(domain) ||
      (!explicitIdentity && !/food|aliment|meal|nutrition|nutrient|ingredient|portion|porc|serving|recipe|receita/i.test(domain))) return false;
  return /food|aliment|ingredient|product|portion|porc|serving|recipe|receita/i.test(name) ||
    /^(?:name|nome|item\.name|item\[['"]name['"]\])$/.test(name);
}

/** Follow a const alias to an intrinsic namespace without trusting shadows. */
function resolvesIntrinsicNamespace(
  target: ts.Expression, use: ts.Node, intrinsic: "Object" | "Reflect" | "globalThis",
  seen = new Set<ts.VariableDeclaration>(), depth = 0,
): boolean {
  if (depth > 12) return false;
  const expr = unwrap(target);
  if (!ts.isIdentifier(expr)) return false;
  const name = expr.text;
  if (name === intrinsic) return unshadowedIntrinsic(intrinsic, use);
  const declares = (binding: ts.BindingName): boolean => ts.isIdentifier(binding)
    ? binding.text === name
    : binding.elements.some(e => ts.isBindingElement(e) && declares(e.name));
  for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(p => declares(p.name))) return false;
    if (ts.isCatchClause(scope) && scope.variableDeclaration &&
        declares(scope.variableDeclaration.name)) return false;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
          statement.name?.text === name) return false;
      if (ts.isImportDeclaration(statement) && statement.importClause &&
          (statement.importClause.name?.text === name ||
            (statement.importClause.namedBindings &&
              (ts.isNamespaceImport(statement.importClause.namedBindings)
                ? statement.importClause.namedBindings.name.text === name
                : statement.importClause.namedBindings.elements.some(e => e.name.text === name)))))
        return false;
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!declares(declaration.name)) continue;
        if (!ts.isIdentifier(declaration.name) ||
            !(statement.declarationList.flags & ts.NodeFlags.Const) ||
            !declaration.initializer || declaration.getStart() >= use.getStart() ||
            seen.has(declaration)) return false;
        const next = new Set(seen);
        next.add(declaration);
        return resolvesIntrinsicNamespace(declaration.initializer, declaration, intrinsic,
          next, depth + 1);
      }
    }
  }
  return false;
}

/** Track *identity-preserving* projections of numeric food maps through
 * Object.keys/entries. UI enumerations, substituted keys and shadowed globals
 * never become productive knowledge merely because a map exists. */
function isFoodNumericProjectionDecision(
  candidate: ts.CallExpression, source: ts.SourceFile,
  matchesMap: (value: ts.Expression, use: ts.Node) => boolean,
): boolean {
  const outerCall = candidate.expression;
  if (!ts.isPropertyAccessExpression(outerCall) && !ts.isElementAccessExpression(outerCall)) return false;
  const method = ts.isPropertyAccessExpression(outerCall) ? outerCall.name.text :
    outerCall.argumentExpression && isStaticText(unwrap(outerCall.argumentExpression))
      ? unwrap(outerCall.argumentExpression).getText(source).slice(1, -1) : "";
  if (!["find", "filter", "some", "every", "includes", "indexOf", "has",
      "keys", "entries", "ownKeys", "getOwnPropertyNames"].includes(method)) return false;
  type Projection = "keys" | "entries";
  const unshadowedGlobal = (name: string, use: ts.Node): boolean => {
    for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
          ts.isIdentifier(param.name) && param.name.text === name)) return false;
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          ts.isIdentifier(scope.variableDeclaration.name) &&
          scope.variableDeclaration.name.text === name) return false;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(decl =>
            ts.isIdentifier(decl.name) && decl.name.text === name)) return false;
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
            statement.name?.text === name) return false;
        if (ts.isImportDeclaration(statement) && statement.importClause &&
            (statement.importClause.name?.text === name ||
              (statement.importClause.namedBindings &&
                (ts.isNamespaceImport(statement.importClause.namedBindings)
                  ? statement.importClause.namedBindings.name.text === name
                  : statement.importClause.namedBindings.elements.some(el =>
                      el.name.text === name))))) return false;
      }
    }
    return true;
  };
  // An immutable alias of Object.keys/entries is the same intrinsic, but a
  // shadowed Object, reassigned binding or user-defined function is not.
  const enumerationMethod = (value: ts.Expression, use: ts.Node, depth = 0): Projection | null => {
    if (depth > 10) return null;
    const expr = unwrap(value);
    if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
      const member = ts.isPropertyAccessExpression(expr) ? expr.name.text :
        expr.argumentExpression && isStaticText(unwrap(expr.argumentExpression))
          ? (unwrap(expr.argumentExpression) as ts.StringLiteral).text : "";
      if ((["keys", "entries", "getOwnPropertyNames"].includes(member) &&
            resolvesIntrinsicNamespace(expr.expression, use, "Object")) ||
          (member === "ownKeys" &&
            resolvesIntrinsicNamespace(expr.expression, use, "Reflect"))) {
        return member === "entries" ? "entries" : "keys";
      }
    }
    if (!ts.isIdentifier(expr)) return null;
    for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
          ts.isIdentifier(param.name) && param.name.text === expr.text)) return null;
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          ts.isIdentifier(scope.variableDeclaration.name) &&
          scope.variableDeclaration.name.text === expr.text) return null;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === expr.text) {
            return (statement.declarationList.flags & ts.NodeFlags.Const) && decl.initializer &&
              decl.getStart(source) < use.getStart(source)
              ? enumerationMethod(decl.initializer, decl, depth + 1) : null;
          }
          if (ts.isObjectBindingPattern(decl.name) && decl.initializer &&
              (statement.declarationList.flags & ts.NodeFlags.Const) &&
              decl.getStart(source) < use.getStart(source) &&
              ts.isIdentifier(unwrap(decl.initializer)) &&
              ["Object", "Reflect"].includes(unwrap(decl.initializer).getText(source)) &&
              unshadowedGlobal(unwrap(decl.initializer).getText(source), decl)) {
            const binding = decl.name.elements.find(el => ts.isIdentifier(el.name) &&
              el.name.text === expr.text);
            const member = binding?.propertyName?.getText(source) || expr.text;
            if (binding && (member === "keys" || member === "entries" ||
                member === "getOwnPropertyNames" || member === "ownKeys") &&
                ((unwrap(decl.initializer).getText(source) === "Reflect")
                  ? member === "ownKeys"
                  : member !== "ownKeys"))
              return member === "entries" ? "entries" : "keys";
          }
        }
      }
    }
    return null;
  };
  const alternativeProjection = (left: ts.Expression, right: ts.Expression,
    use: ts.Node, depth: number): Projection | null => {
    const a = projection(left, use, depth + 1);
    const b = projection(right, use, depth + 1);
    return a && b && a !== b ? null : a || b;
  };
  const projection = (value: ts.Expression, use: ts.Node, depth = 0): Projection | null => {
    if (depth > 10) return null;
    const expr = unwrap(value);
    if (ts.isIdentifier(expr)) {
      for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
        if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
            ts.isIdentifier(param.name) && param.name.text === expr.text)) return null;
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || decl.name.text !== expr.text) continue;
            return (statement.declarationList.flags & ts.NodeFlags.Const) && decl.initializer &&
              decl.getStart(source) < use.getStart(source)
              ? projection(decl.initializer, decl, depth + 1) : null;
          }
        }
      }
      return null;
    }
    if (ts.isConditionalExpression(expr)) {
      return alternativeProjection(expr.whenTrue, expr.whenFalse, use, depth);
    }
    if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken]
        .includes(expr.operatorToken.kind)) {
      return alternativeProjection(expr.left, expr.right, use, depth);
    }
    if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 1 &&
        ts.isSpreadElement(expr.elements[0])) {
      return projection(expr.elements[0].expression, use, depth + 1);
    }
    // A native Set retains its iterable's members. An unrelated object or
    // shadowed Set does not prove that the projected food keys survive.
    if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) &&
        expr.expression.text === "Set" && unshadowedGlobal("Set", expr) &&
        expr.arguments?.length === 1) {
      return projection(expr.arguments[0], expr, depth + 1) === "keys" ? "keys" : null;
    }
    if (!ts.isCallExpression(expr)) return null;
    const enumeration = enumerationMethod(expr.expression, expr, depth + 1);
    if (enumeration && expr.arguments.length === 1 && matchesMap(expr.arguments[0], expr))
      return enumeration;
    if (!ts.isPropertyAccessExpression(expr.expression)) return null;
    const callee = expr.expression;
    // join/split with the same static separator round-trips projected keys.
    // A change of separator, opaque callback or nonliteral delimiter stops tracing.
    if (callee.name.text === "split" && expr.arguments.length === 1 &&
        ts.isCallExpression(unwrap(callee.expression))) {
      const joined = unwrap(callee.expression) as ts.CallExpression;
      if (ts.isPropertyAccessExpression(joined.expression) &&
          joined.expression.name.text === "join" && joined.arguments.length <= 1) {
        const separator = immutableDecisionString(expr.arguments[0], expr, source);
        const joinedSeparator = joined.arguments.length
          ? immutableDecisionString(joined.arguments[0], joined, source) : ",";
        if (separator !== null && separator === joinedSeparator) {
          return projection(joined.expression.expression, joined, depth + 1);
        }
      }
    }
    if (ts.isIdentifier(callee.expression) && callee.expression.text === "Array" &&
        callee.name.text === "from" && expr.arguments.length === 1 &&
        unshadowedGlobal("Array", expr)) {
      return projection(expr.arguments[0], use, depth + 1);
    }
    const previous = projection(callee.expression, use, depth + 1);
    if (!previous) return null;
    if (["slice", "toSorted", "toReversed", "sort", "reverse", "filter"].includes(callee.name.text))
      return previous;
    if (callee.name.text !== "map" || expr.arguments.length !== 1) return null;
    const cb = expr.arguments[0];
    if (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb)) return null;
    const first = cb.parameters[0]?.name;
    const head = first && ts.isArrayBindingPattern(first) ? first.elements[0] : undefined;
    const key = previous === "keys" && first && ts.isIdentifier(first) ? first.text :
      previous === "entries" && head && ts.isBindingElement(head) &&
        ts.isIdentifier(head.name) ? head.name.text : null;
    if (!key || !cb.body || ts.isBlock(cb.body)) return null;
    const projected = unwrapFoodIdentityNormalization(cb.body);
    return ts.isIdentifier(projected) && projected.text === key ? "keys" : null;
  };
  // A const tuple destructuring from Object.keys() preserves the extracted
  // key, even when a later comparison is no longer a collection method call.
  if (["keys", "entries", "ownKeys", "getOwnPropertyNames"].includes(method)) {
    const declared = candidate.parent;
    if (!ts.isVariableDeclaration(declared) || !ts.isArrayBindingPattern(declared.name) ||
        !ts.isVariableDeclarationList(declared.parent) ||
        !(declared.parent.flags & ts.NodeFlags.Const) || projection(candidate, candidate) !== "keys")
      return false;
    const first = declared.name.elements[0];
    if (!first || !ts.isBindingElement(first) || !ts.isIdentifier(first.name)) return false;
    const key = first.name.text;
    let boundary: ts.Node = source;
    for (let parent: ts.Node | undefined = declared.parent; parent; parent = parent.parent) {
      if (ts.isFunctionLike(parent)) { boundary = parent; break; }
    }
    let consumed = false;
    const compare = (node: ts.Node): void => {
      if (consumed) return;
      if (ts.isFunctionLike(node) && node !== boundary) return;
      if (ts.isBlock(node) && node.statements.some(stmt => ts.isVariableStatement(stmt) &&
          stmt.declarationList.declarations.some(binding =>
            ts.isIdentifier(binding.name) && binding.name.text === key))) {
        let parent: ts.Node | undefined = declared;
        while (parent && parent !== node) parent = parent.parent;
        if (!parent) return; // Nested shadowing is not a use of this tuple binding.
      }
      if (ts.isBinaryExpression(node) && node.getStart(source) > declared.getStart(source) &&
          [ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
        const left = unwrapFoodIdentityNormalization(node.left);
        const right = unwrapFoodIdentityNormalization(node.right);
        consumed = ts.isIdentifier(left) && left.text === key &&
          (foodIndexContext(node.right, node, source) ||
            hasGenericFoodIdentityDecisionContext(node.right, node, source)) ||
          ts.isIdentifier(right) && right.text === key &&
          (foodIndexContext(node.left, node, source) ||
            hasGenericFoodIdentityDecisionContext(node.left, node, source));
      }
      if (!consumed) ts.forEachChild(node, compare);
    };
    ts.forEachChild(boundary, compare);
    return consumed;
  }
  const kind = projection(outerCall.expression, candidate);
  if (!kind) return false;
  const inFoodContext = (expression: ts.Expression): boolean =>
    foodIndexContext(expression, candidate, source) ||
    hasGenericFoodIdentityDecisionContext(expression, candidate, source);
  if (method === "includes" || method === "indexOf" || method === "has") {
    return kind === "keys" && candidate.arguments.length === 1 &&
      inFoodContext(candidate.arguments[0]);
  }
  const cb = candidate.arguments[0];
  if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb))) return false;
  const first = cb.parameters[0]?.name;
  const head = first && ts.isArrayBindingPattern(first) ? first.elements[0] : undefined;
  const key = kind === "keys" && first && ts.isIdentifier(first) ? first.text :
    kind === "entries" && head && ts.isBindingElement(head) &&
      ts.isIdentifier(head.name) ? head.name.text : null;
  if (!key || !cb.body) return false;
  const isKey = (value: ts.Expression): boolean => {
    const expr = unwrapFoodIdentityNormalization(value);
    return ts.isIdentifier(expr) && expr.text === key;
  };
  let decision = false;
  const visit = (node: ts.Node): void => {
    if (decision) return;
    if (ts.isBinaryExpression(node) && [
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(node.operatorToken.kind) &&
        ((isKey(node.left) && inFoodContext(node.right)) ||
          (isKey(node.right) && inFoodContext(node.left)))) decision = true;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ["includes", "startsWith", "endsWith", "localeCompare", "indexOf"].includes(node.expression.name.text) &&
        node.arguments[0] &&
        ((isKey(node.expression.expression) && inFoodContext(node.arguments[0])) ||
          (isKey(node.arguments[0]) && inFoodContext(node.expression.expression)))) decision = true;
    if (!decision) ts.forEachChild(node, visit);
  };
  visit(cb.body);
  return decision;
}

function isFoodNumericMapUse(node: ts.VariableDeclaration, source: ts.SourceFile): boolean {
  if (!node.initializer || !ts.isIdentifier(node.name) ||
      !isLiteralNumericMap(node.initializer, node, new Set<ts.VariableDeclaration>(), source)) return false;
  const symbol = node.name.text;
  const context = source.fileName + " " + enclosingDeclaration(node);
  if (/exercise|activity|workout|fitness|burnedcalories/i.test(context)) return false;
  const structuralBounds = /(?:^|_)(?:CONTRACT_)?LIMITS?$/i.test(symbol) &&
    isPureContractSizeBounds(node.initializer);
  const nonFoodMetadata = isPureFoodAdministrativePolicy(node) ||
    isNominalNutritionGoalMap(node);
  if (!structuralBounds && !nonFoodMetadata &&
      /food|alimento|portion|porc|serving|nutrition|nutrient|macro|gram|catalog/i.test(symbol) &&
      /food|aliment|meal|nutrition|nutrient|ingredient|portion|porc|serving/i.test(context)) {
    return true;
  }
  // A generic "table" becomes food knowledge when indexed by a food identity.
  // Search the enclosing function/block; declarations at module scope use the
  // module as their consumer scope.
  let scope: ts.Node = source;
  for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) ||
        ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) {
      scope = parent;
      break;
    }
  }
  let consumed = false;
  const visit = (candidate: ts.Node): void => {
    if (consumed) return;
    if (ts.isElementAccessExpression(candidate) &&
        ts.isIdentifier(candidate.expression) && candidate.expression.text === symbol &&
        candidate.argumentExpression &&
        foodIndexContext(candidate.argumentExpression, candidate, source)) {
      consumed = true;
      return;
    }
    if (ts.isCallExpression(candidate) && ts.isPropertyAccessExpression(candidate.expression) &&
        candidate.expression.name.text === "get" &&
        ts.isIdentifier(candidate.expression.expression) &&
        candidate.expression.expression.text === symbol &&
        candidate.arguments[0] && foodIndexContext(candidate.arguments[0], candidate, source)) {
      consumed = true;
      return;
    }
    if (ts.isCallExpression(candidate) && isFoodNumericProjectionDecision(
      candidate, source, (value) => ts.isIdentifier(unwrap(value)) &&
        (unwrap(value) as ts.Identifier).text === symbol,
    )) {
      consumed = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(scope);
  return consumed;
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

/** Follow locally declared lexical maps without mistaking generated data for hardcodes. */
function hasLiteralWords(expr: ts.Expression): boolean {
  const value = unwrap(expr);
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.length > 0 && value.elements.every(element =>
      ts.isStringLiteral(unwrap(element)));
  }
  return ts.isNewExpression(value) && value.expression.getText() === "Set" &&
    value.arguments?.length === 1 && hasLiteralWords(value.arguments[0]) || false;
}


function hasLiteralRegex(expr: ts.Expression): boolean {
  const value = unwrap(expr);
  return ts.isRegularExpressionLiteral(value) ||
    (ts.isNewExpression(value) && value.expression.getText() === "RegExp" &&
      !!value.arguments?.length && ts.isStringLiteral(unwrap(value.arguments[0])));
}

/** A RegExp call and new RegExp create the same regular expression. Follow
 * immutable constructor aliases but never guess through mutable or shadowed bindings. */
function intrinsicRegExpFactory(value: ts.Expression, use: ts.Node,
  seen = new Set<ts.Node>(), depth = 0): boolean {
  if (depth > 12) return false;
  const expr = unwrap(value);
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    const member = ts.isPropertyAccessExpression(expr) ? expr.name.text :
      expr.argumentExpression && isStaticText(unwrap(expr.argumentExpression))
        ? (unwrap(expr.argumentExpression) as ts.StringLiteral).text : "";
    return member === "RegExp" &&
      resolvesIntrinsicNamespace(expr.expression, use, "globalThis");
  }
  if (!ts.isIdentifier(expr)) return false;
  if (expr.text === "RegExp") return unshadowedIntrinsic("RegExp", use);
  for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(parameter =>
        ts.isIdentifier(parameter.name) && parameter.name.text === expr.text)) return false;
    if (ts.isCatchClause(scope) && scope.variableDeclaration &&
        ts.isIdentifier(scope.variableDeclaration.name) &&
        scope.variableDeclaration.name.text === expr.text) return false;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const stmt of scope.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isObjectBindingPattern(decl.name) && decl.name.elements.some(element =>
            ts.isIdentifier(element.name) && element.name.text === expr.text)) {
          if (!(stmt.declarationList.flags & ts.NodeFlags.Const) || !decl.initializer ||
              decl.getStart() >= use.getStart() || !ts.isIdentifier(unwrap(decl.initializer)) ||
              unwrap(decl.initializer).getText() !== "globalThis" ||
              !unshadowedIntrinsic("globalThis", decl)) return false;
          const element = decl.name.elements.find(element =>
            ts.isIdentifier(element.name) && element.name.text === expr.text);
          const field = element?.propertyName ?? element?.name;
          return !!field && (ts.isIdentifier(field) || ts.isStringLiteral(field)) &&
            field.text === "RegExp";
        }
        if (!ts.isIdentifier(decl.name) || decl.name.text !== expr.text) continue;
        if (!(stmt.declarationList.flags & ts.NodeFlags.Const) || !decl.initializer ||
            seen.has(decl) || decl.getStart() >= use.getStart()) return false;
        const next = new Set(seen);
        next.add(decl);
        return intrinsicRegExpFactory(decl.initializer, decl, next, depth + 1);
      }
    }
  }
  return false;
}

/** Resolve only immutable regex aliases in the lexical scope of the use.
 * A parameter, mutable binding, shadowed name or cyclic chain is not proof
 * that the runtime regular expression is the literal originally declared. */
function resolveLiteralRegexPattern(
  target: ts.Expression, use: ts.Node,
  visited = new Set<ts.VariableDeclaration>(), depth = 0,
): string | null {
  if (depth > 12) return null;
  const expr = unwrap(target);
  if (ts.isRegularExpressionLiteral(expr)) return expr.getText();
  if (ts.isConditionalExpression(expr)) {
    return resolveLiteralRegexPattern(expr.whenTrue, expr, new Set(visited), depth + 1) ??
      resolveLiteralRegexPattern(expr.whenFalse, expr, new Set(visited), depth + 1);
  }
  if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken]
      .includes(expr.operatorToken.kind)) {
    return resolveLiteralRegexPattern(expr.left, expr, new Set(visited), depth + 1) ??
      resolveLiteralRegexPattern(expr.right, expr, new Set(visited), depth + 1);
  }
  if ((ts.isNewExpression(expr) || ts.isCallExpression(expr)) &&
      intrinsicRegExpFactory(expr.expression, expr) && expr.arguments?.length) {
    // The constructor argument can be an immutable literal alias (possibly a
    // chain). The lexical resolver rejects mutable and shadowed bindings.
    const pattern = immutableDecisionString(expr.arguments[0], expr, expr.getSourceFile());
    if (pattern !== null) return pattern;
  }
  if (!ts.isIdentifier(expr)) return null;
  for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
    if ((ts.isFunctionDeclaration(scope) || ts.isMethodDeclaration(scope) ||
        ts.isArrowFunction(scope) || ts.isFunctionExpression(scope)) &&
        scope.parameters.some(parameter => ts.isIdentifier(parameter.name) &&
          parameter.name.text === expr.text)) return null;
    if (ts.isCatchClause(scope) && scope.variableDeclaration &&
        ts.isIdentifier(scope.variableDeclaration.name) &&
        scope.variableDeclaration.name.text === expr.text) return null;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== expr.text) continue;
        if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
            !declaration.initializer || visited.has(declaration) ||
            declaration.getStart() >= use.getStart()) return null;
        const next = new Set(visited);
        next.add(declaration);
        return resolveLiteralRegexPattern(declaration.initializer, declaration, next, depth + 1);
      }
    }
  }
  return null;
}

function referencesLiteralRegex(target: ts.Expression, node: ts.Node): boolean {
  return resolveLiteralRegexPattern(target, node) !== null;
}

/**
 * Unwrap only transparent, bounded string normalizations when tracing an
 * identity in a literal comparison or switch. Never trust arbitrary method
 * calls as evidence of the original food name: they may return unrelated data.
 */
function unwrapFoodIdentityNormalization(expression: ts.Expression): ts.Expression {
  let current = unwrap(expression);
  for (let depth = 0; depth < 12; depth++) {
    if (!ts.isCallExpression(current)) break;
    const callee = current.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      const name = callee.name.text;
      const args = current.arguments;
      const noArgs = /^(?:trim|trimStart|trimEnd|toLowerCase|toUpperCase)$/.test(name) &&
        args.length === 0;
      const unicodeNormalization = name === "normalize" && args.length <= 1 &&
        (args.length === 0 || isStaticText(unwrap(args[0])));
      const literalReplacement = /^(?:replace|replaceAll)$/.test(name) &&
        args.length === 2 &&
        (isStaticText(unwrap(args[0])) || ts.isRegularExpressionLiteral(unwrap(args[0]))) &&
        isStaticText(unwrap(args[1]));
      if (noArgs || unicodeNormalization || literalReplacement) {
        current = unwrap(callee.expression);
        continue;
      }
    }
    // Named identity normalizers are still constrained by the surrounding
    // food-decision evidence; a generic transform is not unwrapped.
    if (ts.isIdentifier(callee) && current.arguments.length === 1 &&
        /^(?:String|normalizeFood[A-Za-z0-9_]*|normalizeAlimento[A-Za-z0-9_]*|canonicalizeFood[A-Za-z0-9_]*|stripAccents|removeAccents)$/.test(callee.text)) {
      current = unwrap(current.arguments[0]);
      continue;
    }
    break;
  }
  return current;
}

/**
 * A comparison of item.name may be a food/portion decision even when neither
 * "item" nor "name" contains "food". Require independently observable domain
 * context; generic usernames, account labels and status checks stay outside.
 */
function hasFoodNameDecisionContext(operand: ts.Expression, node: ts.Node, source: ts.SourceFile): boolean {
  const identity = unwrapFoodIdentityNormalization(operand);
  const field = ts.isPropertyAccessExpression(identity) ? identity.name.text :
    ts.isElementAccessExpression(identity) && identity.argumentExpression &&
    ts.isStringLiteral(identity.argumentExpression) ? identity.argumentExpression.text : "";
  if (!/^(?:name|label|title)$/i.test(field)) return false;
  const receiver = ts.isPropertyAccessExpression(identity) || ts.isElementAccessExpression(identity)
    ? identity.expression.getText(source) : "";
  const owner = receiver.split(".")[0].toLowerCase();
  if (/^(?:user|account|profile|customer|member|admin)$/.test(owner)) return false;
  // A UI tab/navigation label is not a food-identity decision merely because
  // it appears in a Food* component; do not exempt food objects themselves.
  if (/^client\/src\/.*\.(?:tsx|jsx)$/i.test(source.fileName) &&
      /^(?:tab|nav|menu|view|header|column|button|icon)$/.test(owner)) return false;

  let context = source.fileName + " " + enclosingDeclaration(node);
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent)) {
      // A branch returning portion or nutritional values is itself food evidence.
      context += " " + parent.getText(source).slice(0, 3000);
    }
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) ||
        ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) {
      context += " " + parent.parameters.map(parameter => parameter.getText(source)).join(" ");
      if (parent.type) context += " " + parent.type.getText(source);
      break;
    }
  }
  return /food|aliment|meal|nutrition|nutrient|macro|portion|por[cç][aã]?o|serving|ingredient|ingrediente|recipe|receita|calor|kcal|protein|carb|grams|gramas/i.test(context);
}


/** Food decisions may use "item" or "input" instead of "foodName". */
function hasGenericFoodIdentityDecisionContext(
  operand: ts.Expression, node: ts.Node, source: ts.SourceFile,
): boolean {
  const name = unwrapFoodIdentityNormalization(operand).getText(source);
  if (!/^(?:item|input|value|name|label|term|token|text|raw|candidate)$/i.test(name)) return false;
  const owner = enclosingDeclaration(node);
  if (!/food|aliment|nutrition|nutrient|meal|ingredient|portion|porc|serving|materiality/i.test(source.fileName) ||
      !/normaliz|resolv|decid|classif|infer|select|pick|parse|match|identif|lookup|find|extract/i.test(owner)) return false;
  return !/status|account|permission|role|exercise|activity|workout|mode|view|tab/i.test(owner);
}

function isFoodDomainSource(file: string): boolean {
  return /food|aliment|nutrition|nutrient|meal|ingredient|portion|porc|serving|product|materiality/i.test(file);
}

/**
 * A regex used to make a lexical decision may be anonymous (e.g. decide(value)).
 * Limit path-based inference to literal word alternatives or word-boundary terms;
 * numeric/input-format regexes in food modules are not food attributes.
 */
function hasLexicalVocabularyRegex(target: ts.Expression, node: ts.Node): boolean {
  const pattern = resolveLiteralRegexPattern(target, node);
  if (pattern === null) return false;
  return /[a-zA-ZÀ-ÿ]{3,}\|[a-zA-ZÀ-ÿ]{3,}|\\b[a-zA-ZÀ-ÿ]{3,}/.test(pattern);
}

/** A pure navigation list must not become a blocked food rule. */
function isPresentationOnlyCollection(node: ts.VariableDeclaration, source: ts.SourceFile): boolean {
  const symbol = node.name.getText(source);
  if (!/(?:^|[_-])(?:tabs?|columns?|headers?|menus?|navigation|buttons?|icons?|styles?|statuses?|badges?|toasts?)(?:$|[_-])|(?:Tabs?|Columns?|Headers?|Menus?|Styles?)$/i.test(symbol)) return false;
  // A view-oriented name is not an exemption once the collection drives a decision.
  let decisiveConsumer = false;
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate) && ts.isPropertyAccessExpression(candidate.expression) &&
        ["includes", "has", "indexOf", "some", "find", "filter", "every"].includes(candidate.expression.name.text) &&
        candidate.expression.expression.getText(source) === symbol) decisiveConsumer = true;
    if (ts.isElementAccessExpression(candidate) &&
        candidate.expression.getText(source) === symbol) decisiveConsumer = true;
    ts.forEachChild(candidate, visit);
  };
  visit(source);
  return !decisiveConsumer;
}

/** A rendered label becomes food knowledge when code also uses it to decide
 * identity or aliases. A display-only TSX label remains excluded. */
function isDecisionBearingFoodScalar(declaration: ts.VariableDeclaration, source: ts.SourceFile): boolean {
  if (!ts.isIdentifier(declaration.name)) return false;
  const symbol = declaration.name.text;
  let decisionUse = false;

  // A display label ceases to be presentation-only if its value (including a
  // local alias) feeds food identity, nutrition, classification or portioning.
  // Resolve lexical declarations instead of relying on repeated identifier
  // spellings: a shadowing parameter must not taint the original label.
  const refers = (expr: ts.Expression, use: ts.Node,
    visited = new Set<ts.VariableDeclaration>()): boolean => {
    const value = unwrap(expr);
    if (!ts.isIdentifier(value)) return false;
    for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
      if ((ts.isFunctionDeclaration(scope) || ts.isFunctionExpression(scope) ||
           ts.isMethodDeclaration(scope) || ts.isArrowFunction(scope)) &&
          scope.parameters.some(parameter =>
            ts.isIdentifier(parameter.name) && parameter.name.text === value.text)) return false;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const candidate of statement.declarationList.declarations) {
          if (!ts.isIdentifier(candidate.name) || candidate.name.text !== value.text) continue;
          if (candidate === declaration) return true;
          if (!candidate.initializer || visited.has(candidate)) return false;
          visited.add(candidate);
          return refers(candidate.initializer, candidate, visited);
        }
      }
    }
    return false;
  };
  const containsReference = (root: ts.Node): boolean => {
    let found = false;
    const scan = (candidate: ts.Node): void => {
      if (found) return;
      if (ts.isIdentifier(candidate) && refers(candidate, candidate)) {
        found = true;
        return;
      }
      ts.forEachChild(candidate, scan);
    };
    scan(root);
    return found;
  };
  const foodDecision = /(?:resolve|decide|infer|identify|classify|match|select|choose|lookup|find|parse|extract|register|create|get)[A-Za-z0-9_]*(?:food|alimento|nutrition|nutrient|portion|serving|ingredient|meal)[A-Za-z0-9_]*/i;
  const scan = (candidate: ts.Node): void => {
    if (decisionUse) return;
    if (ts.isBinaryExpression(candidate) &&
        [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]
          .includes(candidate.operatorToken.kind) &&
        ((ts.isExpression(candidate.left) && refers(candidate.left, candidate.left)) ||
         refers(candidate.right, candidate.right))) {
      decisionUse = true;
      return;
    }
    if (ts.isSwitchStatement(candidate) &&
        refers(candidate.expression, candidate.expression) &&
        candidate.caseBlock.clauses.some(clause =>
          ts.isCaseClause(clause) && isStaticText(clause.expression))) {
      decisionUse = true;
      return;
    }
    if (ts.isCallExpression(candidate) && ts.isPropertyAccessExpression(candidate.expression) &&
        ["includes", "has", "indexOf"].includes(candidate.expression.name.text) &&
        (refers(candidate.expression.expression, candidate.expression.expression) ||
         candidate.arguments.some(argument => containsReference(argument)))) {
      decisionUse = true;
      return;
    }
    // Resolve calls are a decision sink even when the constant is nested in
    // an argument object or passed through a simple lexical alias.
    if (ts.isCallExpression(candidate) &&
        foodDecision.test(candidate.expression.getText(source)) &&
        candidate.arguments.some(argument => containsReference(argument))) {
      decisionUse = true;
      return;
    }
    if (ts.isPropertyAssignment(candidate) &&
        /^(?:foodName|foodLabel|foodId|food_id|alimento|alimentoId|productName|ingredientName|nutritionIdentity)$/i
          .test(candidate.name.getText(source).replace(/^['"]|['"]$/g, "")) &&
        containsReference(candidate.initializer)) {
      decisionUse = true;
      return;
    }
    if (ts.isReturnStatement(candidate) && candidate.expression &&
        foodDecision.test(enclosingDeclaration(candidate)) &&
        containsReference(candidate.expression)) {
      decisionUse = true;
      return;
    }
    ts.forEachChild(candidate, scan);
  };
  scan(source);
  return decisionUse;
}

/** Presentation copy is not a food identity or a domain decision. */
function isPresentationOnlyScalar(symbol: string, value: string, file: string): boolean {
  if (!/(?:label|title|text|placeholder|description|message|tooltip|caption|heading|button|toast)/i.test(symbol) ||
      /alias|synonym|lexic|classification|materiality|defaultFoodName/i.test(symbol)) return false;
  const viewOnly = /^client\/src\/.*\.(?:tsx|jsx)$/i.test(file);
  const instructionalCopy = /^(?:Adicionar|Salvar|Selecionar|Selecione|Buscar|Editar|Remover|Excluir|Escolher|Escolha|Informe|Registrar|Cancelar|Carregar|Nenhum|Nenhuma|Add|Save|Select|Search|Edit|Remove|Choose|Enter|Cancel)\s+/i.test(value);
  return viewOnly || instructionalCopy;
}

/** Trace literal collections through ordered local updates, not just their initializer.
 * This is deliberately restricted to immutable bindings and synchronous,
 * statement-level mutations before a decision; unknown writes cannot certify
 * that the resulting vocabulary is static. */
function referencesLiteralWords(target: ts.Expression, use: ts.Node): string[] {
  const source = use.getSourceFile();
  const resolve = (expression: ts.Expression, site: ts.Node, depth = 0,
    seen = new Set<ts.VariableDeclaration>()): string[] | null => {
    if (depth > 10) return null;
    const value = unwrap(expression);
    if (ts.isArrayLiteralExpression(value)) {
      const words: string[] = [];
      for (const element of value.elements) {
        if (ts.isSpreadElement(element)) {
          const spread = resolve(element.expression, element, depth + 1, new Set(seen));
          if (spread === null) return null;
          words.push(...spread);
        } else if (isStaticText(unwrap(element))) {
          words.push((unwrap(element) as ts.StringLiteral).text);
        } else return null;
      }
      return words;
    }
    if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
      // A statically serialized lexical array cannot bypass the same rules
      // applied to a TypeScript array. Only unshadowed native JSON qualifies.
      if (value.expression.name.text === "parse" &&
          ts.isIdentifier(value.expression.expression) &&
          value.expression.expression.text === "JSON" &&
          unshadowedIntrinsic("JSON", value) && value.arguments.length === 1 &&
          isStaticText(unwrap(value.arguments[0]))) {
        try {
          const parsed: unknown = JSON.parse((unwrap(value.arguments[0]) as ts.StringLiteral).text);
          return Array.isArray(parsed) && parsed.length > 0 && parsed.every(item =>
            typeof item === "string" && item.trim().length > 0) ? parsed as string[] : null;
        } catch { return null; }
      }
      const method = value.expression.name.text;
      const receiver = value.expression.expression;
      if ((method === "reverse" || method === "toReversed") && value.arguments.length === 0) {
        const items = resolve(receiver, value, depth + 1, new Set(seen));
        return items === null ? null : [...items].reverse();
      }
      if (method === "filter" && value.arguments.length === 1 &&
          ts.isIdentifier(value.arguments[0]) && value.arguments[0].text === "Boolean" &&
          unshadowedIntrinsic("Boolean", value)) {
        const items = resolve(receiver, value, depth + 1, new Set(seen));
        return items === null ? null : items.filter(Boolean);
      }
      if (method === "concat") {
        const initial = resolve(receiver, value, depth + 1, new Set(seen));
        if (initial === null) return null;
        const result = [...initial];
        for (const argument of value.arguments) {
          const items = resolve(argument, value, depth + 1, new Set(seen));
          if (items === null) return null;
          result.push(...items);
        }
        return result;
      }
    }
    if (ts.isNewExpression(value) && ts.isIdentifier(value.expression) &&
        value.expression.text === "Set" && unshadowedIntrinsic("Set", value) &&
        (value.arguments?.length ?? 0) <= 1) {
      return value.arguments?.length ? resolve(value.arguments[0], value, depth + 1, seen) : [];
    }
    if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
        value.expression.name.text === "split" && value.arguments.length === 1) {
      const input = immutableDecisionString(value.expression.expression, value, source);
      const separator = immutableDecisionString(value.arguments[0], value, source);
      return input !== null && separator !== null && separator.length > 0
        ? input.split(separator) : null;
    }
    if (!ts.isIdentifier(value)) return null;
    for (let scope: ts.Node | undefined = site; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
          ts.isIdentifier(param.name) && param.name.text === value.text)) return null;
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          ts.isIdentifier(scope.variableDeclaration.name) &&
          scope.variableDeclaration.name.text === value.text) return null;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== value.text) continue;
          if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
              !declaration.initializer || seen.has(declaration) ||
              declaration.getStart(source) >= site.getStart(source)) return null;
          const visited = new Set(seen); visited.add(declaration);
          const initial = resolve(declaration.initializer, declaration, depth + 1, visited);
          if (initial === null) return null;
          const values = [...initial];
          for (const operation of scope.statements) {
            if (operation.getStart(source) <= declaration.getStart(source) ||
                operation.getStart(source) >= site.getStart(source)) continue;
            if (!ts.isExpressionStatement(operation)) continue;
            const effect = operation.expression;
            if (!ts.isCallExpression(effect) || !ts.isPropertyAccessExpression(effect.expression) ||
                !ts.isIdentifier(effect.expression.expression) ||
                effect.expression.expression.text !== value.text) continue;
            const method = effect.expression.name.text;
            if (!(["push", "unshift", "add"] as string[]).includes(method)) return null;
            const isSet = ts.isNewExpression(unwrap(declaration.initializer)) &&
              ts.isIdentifier((unwrap(declaration.initializer) as ts.NewExpression).expression) &&
              ((unwrap(declaration.initializer) as ts.NewExpression).expression as ts.Identifier).text === "Set";
            if ((method === "add") !== isSet || effect.arguments.length === 0 ||
                effect.arguments.some(argument => !isStaticText(unwrap(argument)))) return null;
            const items = effect.arguments.map(argument => (unwrap(argument) as ts.StringLiteral).text);
            if (method === "unshift") values.unshift(...items);
            else values.push(...items);
          }
          return values;
        }
      }
    }
    return null;
  };
  const words = resolve(target, use);
  return words !== null && words.length > 0 && words.every(word => word.length > 0) ? words : [];
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
  if (rule.kind === "domain-field" || rule.kind === "numeric-map" ||
      rule.detectorKey === "food-static-table" || rule.ownerFunction ||
      rule.failureClass === "B" || rule.failureClass === "C") return rule.failureClass;
  // Structural numeric maps are portion/nutrition knowledge even when the
  // declaration is called just `table` or `lookup`. Trust the declared gate
  // class rather than guessing its domain from an arbitrary variable name.
  if (/portion|porc|serving|macro|nutrition|nutrient/i.test(symbol)) return "C";
  if (/alias|lexic|synonym|vocab|term/i.test(symbol)) return "A";
  return "I";
}

function localDecisionEvidence(value: ts.Expression, node: ts.Node, source: ts.SourceFile,
  depth = 0, visited = new Set<string>()): string {
  if (depth > 5) return "";
  const current = unwrap(value);
  if (ts.isCallExpression(current)) {
    return current.arguments.map(arg => localDecisionEvidence(arg, node, source, depth + 1, new Set(visited))).join(" ");
  }
  if (!ts.isIdentifier(current)) return current.getText(source);
  if (visited.has(current.text)) return "";
  visited.add(current.text);
  for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer || declaration.getStart(source) >= node.getStart(source)) continue;
        if (ts.isIdentifier(declaration.name) && declaration.name.text === current.text) {
          return declaration.initializer.getText(source) + " " +
            localDecisionEvidence(declaration.initializer, node, source, depth + 1, visited);
        }
        if (ts.isObjectBindingPattern(declaration.name)) {
          const binding = declaration.name.elements.find(element =>
            ts.isIdentifier(element.name) && element.name.text === current.text);
          if (binding) {
            const property = binding.propertyName?.getText(source) ?? current.text;
            return declaration.initializer.getText(source) + "." + property + " " +
              localDecisionEvidence(declaration.initializer, node, source, depth + 1, visited);
          }
        }
      }
    }
  }
  return "";
}

/** A dictionary is a decision even when its entries drive a comparison or
 * dynamic includes() instead of replaceAll(). Verify the iterator binding,
 * then find a predicate in the same loop body (not mere presentation). */
function iteratedLexicalDecision(call: ts.CallExpression, source: ts.SourceFile): {
  equality: boolean; textMethod: boolean;
} {
  const result = { equality: false, textMethod: false };
  const iterator = call.parent;
  if (!ts.isForOfStatement(iterator) || !ts.isVariableDeclarationList(iterator.initializer)) return result;
  const declaration = iterator.initializer.declarations[0];
  if (!declaration) return result;
  const method = ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : "";
  let term: string | undefined;
  if (ts.isArrayBindingPattern(declaration.name) && method === "entries") {
    const head = declaration.name.elements[0];
    if (head && ts.isIdentifier(head.name)) term = head.name.text;
  } else if (ts.isIdentifier(declaration.name) && method === "keys") {
    term = declaration.name.text;
  }
  if (!term) return result;
  const scan = (candidate: ts.Node): void => {
    if (ts.isBinaryExpression(candidate) &&
        [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]
          .includes(candidate.operatorToken.kind) &&
        ((ts.isIdentifier(candidate.left) && candidate.left.text === term) ||
         (ts.isIdentifier(candidate.right) && candidate.right.text === term))) {
      result.equality = true;
    }
    if (ts.isCallExpression(candidate) && ts.isPropertyAccessExpression(candidate.expression) &&
        ["includes", "startsWith", "endsWith", "match", "indexOf"].includes(candidate.expression.name.text) &&
        candidate.arguments.some(arg => ts.isIdentifier(unwrap(arg)) &&
          (unwrap(arg) as ts.Identifier).text === term)) {
      result.textMethod = true;
    }
    ts.forEachChild(candidate, scan);
  };
  scan(iterator.statement);
  return result;
}

/** A class/object resolver property may only be exempt when it is a pure
 * forwarding wrapper to the actual canonical import, without local decisions. */
function isCanonicalFoodResolverDelegate(
  callable: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration,
  source: ts.SourceFile): boolean {
  const canonicalImport = source.statements.some(statement =>
    ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
    /(?:^|\/)foodItemResolution(?:\.[cm]?[jt]s)?$/.test(statement.moduleSpecifier.text) &&
    statement.importClause?.namedBindings &&
    ts.isNamedImports(statement.importClause.namedBindings) &&
    statement.importClause.namedBindings.elements.some(element =>
      !element.isTypeOnly && element.name.text === "resolveCanonicalFoodQuantity" &&
      (!element.propertyName || element.propertyName.text === element.name.text)));
  if (!canonicalImport) return false;
  const body = callable.body;
  if (!body) return false;
  let returned: ts.Expression | undefined;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0])) return false;
    returned = body.statements[0].expression;
  } else returned = body;
  if (!returned) return false;
  let value = unwrap(returned);
  if (ts.isAwaitExpression(value)) value = unwrap(value.expression);
  if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression) ||
      value.expression.text !== "resolveCanonicalFoodQuantity") return false;
  // An apparent forwarder can still hardcode or transform the identity. Only
  // the unchanged arguments of the wrapper are a proven pure delegation.
  return value.arguments.length === callable.parameters.length &&
    value.arguments.every((argument, index) =>
      ts.isIdentifier(argument) && ts.isIdentifier(callable.parameters[index].name) &&
      argument.text === callable.parameters[index].name.text);
}

/** Match a resolver's actual call target, never names inside a receiver object.
 * A Zod schema may contain a field called resolveFood but only invokes superRefine. */
function callTargetName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const receiver = callTargetName(expression.expression);
    return receiver ? receiver + "." + expression.name.text : expression.name.text;
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression &&
      isStaticText(unwrap(expression.argumentExpression))) {
    const receiver = callTargetName(expression.expression);
    const member = (unwrap(expression.argumentExpression) as ts.StringLiteral).text;
    return receiver ? receiver + "." + member : member;
  }
  return "";
}

/** Only a literal array, or a lexically resolved const array, can provide a
 * compile-time regex vocabulary to Array.join. Dynamic arrays stay unknown. */
function immutableDecisionStringArray(expression: ts.Expression, use: ts.Node,
  source: ts.SourceFile, depth: number, seen: Set<ts.Node>): string[] | null {
  if (depth > 8) return null;
  const expr = unwrap(expression);
  if (ts.isArrayLiteralExpression(expr)) {
    const values: string[] = [];
    for (const element of expr.elements) {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return null;
      const resolved = immutableDecisionString(element, element, source, depth + 1, new Set(seen));
      if (resolved === null) return null;
      values.push(resolved);
    }
    return values;
  }
  if (!ts.isIdentifier(expr)) return null;
  for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
        ts.isIdentifier(param.name) && param.name.text === expr.text)) return null;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== expr.text) continue;
        if (!(statement.declarationList.flags & ts.NodeFlags.Const) || !declaration.initializer ||
            seen.has(declaration) || declaration.getStart(source) >= use.getStart(source)) return null;
        const next = new Set(seen);
        next.add(declaration);
        return immutableDecisionStringArray(declaration.initializer, declaration, source, depth + 1, next);
      }
    }
  }
  return null;
}

/** Resolve only lexically visible const string aliases; never treat mutable values,
 * shadowed parameters or unrelated expression text as hardcoded vocabulary. */
function immutableDecisionString(expression: ts.Expression, use: ts.Node, source: ts.SourceFile,
  depth = 0, seen = new Set<ts.Node>()): string | null {
  if (depth > 8) return null;
  const value = unwrap(expression);
  if (isStaticText(value)) return value.text;
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = immutableDecisionString(value.left, value, source, depth + 1, new Set(seen));
    const right = immutableDecisionString(value.right, value, source, depth + 1, new Set(seen));
    return left !== null && right !== null ? left + right : null;
  }
  if (ts.isTaggedTemplateExpression(value) &&
      (ts.isPropertyAccessExpression(value.tag) || ts.isElementAccessExpression(value.tag)) &&
      ts.isIdentifier(value.tag.expression) && value.tag.expression.text === "String" &&
      (ts.isPropertyAccessExpression(value.tag) ? value.tag.name.text === "raw" :
        !!value.tag.argumentExpression && isStaticText(unwrap(value.tag.argumentExpression)) &&
        (unwrap(value.tag.argumentExpression) as ts.StringLiteral).text === "raw") &&
      unshadowedIntrinsic("String", value)) {
    const template = value.template;
    if (ts.isNoSubstitutionTemplateLiteral(template))
      return template.rawText ?? template.text;
    let result = template.head.rawText ?? template.head.text;
    for (const span of template.templateSpans) {
      const part = immutableDecisionString(span.expression, span, source, depth + 1, new Set(seen));
      if (part === null) return null;
      result += part + (span.literal.rawText ?? span.literal.text);
    }
    return result;
  }
  if (ts.isTemplateExpression(value)) {
    let result = value.head.text;
    for (const span of value.templateSpans) {
      const replacement = immutableDecisionString(span.expression, span, source, depth + 1, new Set(seen));
      if (replacement === null) return null;
      result += replacement + span.literal.text;
    }
    return result;
  }
  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
      value.expression.name.text === "join" && value.arguments.length <= 1) {
    const separator = value.arguments.length
      ? immutableDecisionString(value.arguments[0], value, source, depth + 1, new Set(seen)) : ",";
    const items = immutableDecisionStringArray(value.expression.expression, value, source, depth + 1, new Set(seen));
    return items && separator !== null ? items.join(separator) : null;
  }
  if (!ts.isIdentifier(value)) return null;
  for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
      ts.isIdentifier(param.name) && param.name.text === value.text)) return null;
    if (ts.isCatchClause(scope) && scope.variableDeclaration &&
        ts.isIdentifier(scope.variableDeclaration.name) &&
        scope.variableDeclaration.name.text === value.text) return null;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === value.text) return null;
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== value.text) continue;
        if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
            !declaration.initializer || declaration.getStart(source) >= use.getStart(source) ||
            seen.has(declaration)) return null;
        seen.add(declaration);
        return immutableDecisionString(declaration.initializer, declaration, source, depth + 1, seen);
      }
    }
  }
  return null;
}

/** Numeric results from indexOf/localeCompare are decisions only when
 * used as predicates; diagnostic ordering/display calls stay out of scope. */
function isLexicalNumericComparison(call: ts.CallExpression): boolean {
  let current: ts.Node = call;
  for (let depth = 0; depth < 8; depth++) {
    const parent = current.parent;
    if (!parent) return false;
    if ((ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) ||
         ts.isSatisfiesExpression(parent)) && parent.expression === current) {
      current = parent;
      continue;
    }
    if (ts.isPrefixUnaryExpression(parent) && parent.operand === current &&
        [ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken].includes(parent.operator)) {
      current = parent;
      continue;
    }
    if (ts.isBinaryExpression(parent) &&
        (parent.left === current || parent.right === current)) {
      const operator = parent.operatorToken.kind;
      if ([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
          ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken].includes(operator)) {
        const other = parent.left === current ? parent.right : parent.left;
        const value = unwrap(other);
        return ts.isNumericLiteral(value) ||
          (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken &&
            ts.isNumericLiteral(value.operand));
      }
      // indexOf + 1 is a boolean membership predicate only if consumed as
      // a predicate. Do not turn arithmetic used for display into knowledge.
      if (operator === ts.SyntaxKind.PlusToken &&
          ts.isPropertyAccessExpression(call.expression) &&
          call.expression.name.text === "indexOf" &&
          ts.isNumericLiteral(unwrap(parent.left === current ? parent.right : parent.left))) {
        current = parent;
        continue;
      }
      return false;
    }
    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) &&
        parent.expression.text === "Boolean" && parent.arguments.length === 1 &&
        parent.arguments[0] === current) return true;
    if ((ts.isIfStatement(parent) || ts.isWhileStatement(parent) ||
         ts.isDoStatement(parent) || ts.isConditionalExpression(parent)) &&
        parent.expression === current) return true;
    if (ts.isPrefixUnaryExpression(current) &&
        current.operator === ts.SyntaxKind.ExclamationToken) return true;
    return false;
  }
  return false;
}

/** Only an unshadowed native JSON.parse with literal input is static. */
function parsedStaticFoodJson(node: ts.Expression): unknown | undefined {
  const value = unwrap(node);
  if (!ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression) ||
      !ts.isIdentifier(value.expression.expression) ||
      value.expression.expression.text !== "JSON" || value.expression.name.text !== "parse" ||
      !unshadowedIntrinsic("JSON", value) || value.arguments.length !== 1 ||
      !isStaticText(unwrap(value.arguments[0]))) return undefined;
  try { return JSON.parse((unwrap(value.arguments[0]) as ts.StringLiteral).text); }
  catch { return undefined; }
}

/** A parsed literal is a violation only when used in a real food decision. */
function isConsumedSerializedFoodValue(node: ts.VariableDeclaration, source: ts.SourceFile): boolean {
  if (!ts.isIdentifier(node.name)) return false;
  const variable = node.name.text;
  let boundary: ts.Node = source;
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) { boundary = parent; break; }
  }
  const name = enclosingDeclaration(node);
  const parameters = ts.isFunctionLike(boundary) ? boundary.parameters.map(p => p.name.getText(source)).join(" ") : "";
  const foodDomain = /food|alimento|nutri|meal|portion|ingredient|productName/i.test(
    name + " " + parameters + " " + source.fileName);
  // A module-level literal can be consumed by a later function. A local
  // literal, by contrast, must not inherit uses from another function.
  if ((boundary !== source && !foodDomain) ||
      /exercise|activity|workout|fitness|account|status/i.test(name)) return false;
  const foodQuery = /\b(?:foodName|foodId|foodLabel|foodKey|alimento|ingredientName|productName)\b/i;
  const shadowedAt = (candidate: ts.Node): boolean => {
    if (boundary !== source) return false;
    for (let scope: ts.Node | undefined = candidate; scope && scope !== source; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(parameter =>
        ts.isIdentifier(parameter.name) && parameter.name.text === variable)) return true;
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          ts.isIdentifier(scope.variableDeclaration.name) &&
          scope.variableDeclaration.name.text === variable) return true;
      if (!ts.isBlock(scope)) continue;
      if (scope.statements.some(statement =>
        (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
          ts.isIdentifier(declaration.name) && declaration.name.text === variable)) ||
        (ts.isFunctionDeclaration(statement) && statement.name?.text === variable))) return true;
    }
    return false;
  };
  let consumed = false;
  const visit = (candidate: ts.Node): void => {
    if (consumed || (ts.isFunctionLike(candidate) && candidate !== boundary && boundary !== source) ||
        shadowedAt(candidate)) return;
    // A foodName parameter in an exercise/status decision is not proof of
    // a food catalog; the active consumer's domain takes precedence.
    const consumer = enclosingDeclaration(candidate);
    if (/exercise|activity|workout|fitness|account|status/i.test(consumer)) return;
    if (ts.isCallExpression(candidate) && ts.isPropertyAccessExpression(candidate.expression) &&
        /^(?:includes|indexOf|lastIndexOf|has|find|filter|some|every)$/.test(candidate.expression.name.text) &&
        candidate.expression.expression.getText(source) === variable &&
        (foodQuery.test(candidate.getText(source)) || foodDomain ||
          /food|meal|nutri|alimento/i.test(consumer))) {
      consumed = true;
    }
    if (ts.isElementAccessExpression(candidate) &&
        candidate.expression.getText(source) === variable && candidate.argumentExpression &&
        foodQuery.test(candidate.argumentExpression.getText(source))) consumed = true;
    ts.forEachChild(candidate, visit);
  };
  ts.forEachChild(boundary, visit);
  return consumed;
}

function ruleEvidence(node: ts.Node, source: ts.SourceFile, rule: FoodWaveOneRule): {
  symbol: string; subject: string;
} | null {
  if (rule.kind === "domain-field") {
    const field = (candidate: ts.Node): { name: string; value?: ts.Expression; owner: ts.Node } | null => {
      if (ts.isPropertyAssignment(candidate)) {
        const name = ts.isComputedPropertyName(candidate.name)
          ? immutableDecisionString(candidate.name.expression, candidate, source)
          : candidate.name.getText(source).replace(/^['"]|['"]$/g, "");
        return name ? { name, value: candidate.initializer, owner: candidate.parent } : null;
      }
      if (ts.isPropertyDeclaration(candidate) && candidate.initializer &&
          candidate.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)) {
        const name = ts.isComputedPropertyName(candidate.name)
          ? immutableDecisionString(candidate.name.expression, candidate, source)
          : candidate.name.getText(source).replace(/^['"]|['"]$/g, "");
        return name ? { name, value: candidate.initializer, owner: candidate.parent } : null;
      }
      if (ts.isEnumMember(candidate) && candidate.initializer) {
        const name = ts.isComputedPropertyName(candidate.name)
          ? immutableDecisionString(candidate.name.expression, candidate, source)
          : candidate.name.getText(source).replace(/^['"]|['"]$/g, "");
        return name ? { name, value: candidate.initializer, owner: candidate.parent } : null;
      }
      return null;
    };
    const candidate = field(node);
    if (!candidate || !rule.fieldPattern || !matches(rule.fieldPattern, candidate.name)) return null;
    const context = [source.fileName, enclosingDeclaration(node), candidate.owner.getText(source)].join(" ");
    const unrelated = /account|status|permission|role|config|setting|ui|exercise|activity|workout|fitness|burnedcalories/i.test(context);
    const domainEvidence = rule.contextPattern ? matches(rule.contextPattern, context) : false;
    if (unrelated || !domainEvidence) return null;
    const value = candidate.value;
    if (!value) return null;
    const validValue = rule.valueKind === "numeric"
      ? staticNutritionNumber(value) !== null || isLiteralNutritionRecord(value)
      : rule.valueKind === "collection"
        ? immutableDecisionString(value, node, source) !== null ||
          immutableDecisionStringArray(value, node, source, 0, new Set()) !== null ||
          (ts.isNewExpression(unwrap(value)) && ts.isIdentifier(unwrap(value).expression) &&
            unwrap(value).expression.text === "Set" && unshadowedIntrinsic("Set", unwrap(value)) &&
            !!unwrap(value).arguments?.[0] &&
            immutableDecisionStringArray(unwrap(value).arguments![0], node, source, 0, new Set()) !== null)
        : false;
    if (!validValue) return null;
    return {
      symbol: (enclosingDeclaration(node) || "domain") + "." + candidate.name + ":domain-field",
      subject: value.getText(source),
    };
  }
  if (rule.kind === "numeric-map") {
    if (ts.isVariableDeclaration(node) && isFoodNumericMapUse(node, source)) {
      return { symbol: node.name.getText(source) + ":numeric-food-map",
        subject: node.initializer!.getText(source) };
    }
    // Avoid evasion by returning an indexed inline numeric object directly.
    if (ts.isElementAccessExpression(node) && node.argumentExpression &&
        isLiteralNumericMap(node.expression, node, new Set<ts.VariableDeclaration>(), source) &&
        foodIndexContext(node.argumentExpression, node, source)) {
      return { symbol: "inline-numeric-food-map", subject: node.getText(source) };
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "get" && node.arguments[0] &&
        isLiteralNumericMap(node.expression.expression, node, new Set<ts.VariableDeclaration>(), source) &&
        foodIndexContext(node.arguments[0], node, source)) {
      return { symbol: "inline-numeric-food-map", subject: node.getText(source) };
    }
  }
  if ((rule.detectorKey === "food-static-collection" || rule.detectorKey === "food-static-table") &&
      ts.isVariableDeclaration(node) && node.initializer &&
      parsedStaticFoodJson(node.initializer) !== undefined &&
      isConsumedSerializedFoodValue(node, source)) {
    const parsed = parsedStaticFoodJson(node.initializer);
    const lexical = Array.isArray(parsed) && parsed.length > 0 &&
      parsed.every(item => typeof item === "string" && item.trim().length > 0);
    const numericRows = Array.isArray(parsed) && parsed.some(item =>
      item !== null && typeof item === "object" && !Array.isArray(item) &&
      (typeof item.name === "string" || typeof item.foodName === "string") &&
      ["calories", "kcal", "protein", "carbs", "fat", "nutrition"].some(key =>
        typeof item[key] === "number" || item[key] !== null && typeof item[key] === "object"));
    const numericMap = parsed !== null && typeof parsed === "object" &&
      !Array.isArray(parsed) && Object.keys(parsed).length > 0 &&
      Object.values(parsed).every(value => typeof value === "number" && Number.isFinite(value));
    if ((rule.failureClass === "I" && (lexical || numericRows || numericMap)) ||
        (rule.failureClass === "C" && (numericRows || numericMap))) {
      return { symbol: node.name.getText(source) + ":serialized-food-knowledge",
        subject: node.initializer.getText(source) };
    }
  }
  if (rule.kind === "collection" && ts.isVariableDeclaration(node) &&
    node.initializer && isLiteralCollection(node.initializer)) {
    const symbol = node.name.getText(source);
    const mappedLexicon = rule.ownerFunction === "lexical-knowledge" && isLexicalMap(node.initializer, unwrap) &&
      // The path alone does not make an ordinary UI/status dictionary a food lexicon.
      /food|alimento|lexic|normaliz|language|vocab|synonym|alias/i.test(
        symbol + " " + enclosingDeclaration(node));
    // Meal recommendations hardcoded in local dictionaries are actionable
    // domain knowledge, not ordinary strings shown in a status widget.
    if (rule.detectorKey === "food-static-collection" && rule.failureClass === "I" &&
        isLiteralFoodMealChoiceCatalog(node.initializer, node)) {
      return { symbol: symbol + ":meal-choice-catalog", subject: node.initializer.getText(source) };
    }
    if (rule.detectorKey === "food-static-collection" && rule.failureClass === "I" &&
        ((ts.isIdentifier(node.name) &&
          /(?:^|_)(?:CONTRACT_)?LIMITS?$/i.test(node.name.text) &&
          isPureContractSizeBounds(node.initializer) &&
          !isFoodNumericMapUse(node, source)) ||
          isStructuralEvidenceFieldVocabulary(node) ||
          isPresentationOnlyCollection(node, source) ||
          isPresentationOnlyFilter(node, source, unwrap))) return null;
    // Inline food rows are visited separately by isInlineFoodKnowledge.
    // A generic { name: user.name, calories: 100 } collection must not be
    // reclassified as food solely because those two property names coexist.
    if ((matches(rule.symbolPattern, symbol) || mappedLexicon) &&
        matches(rule.evidencePattern, symbol)) {
      return { symbol, subject: node.initializer.getText(source) };
    }
  }
  if (rule.detectorKey === "food-static-collection" && rule.failureClass === "I" &&
      ts.isObjectLiteralExpression(node) && isInlineFoodKnowledge(node)) {
    return { symbol: "inline-food-knowledge", subject: node.getText(source) };
  }
  if (rule.kind === "scalar" && ts.isVariableDeclaration(node) && node.initializer) {
    const symbol = node.name.getText(source);
    const value = unwrap(node.initializer);
    const numericFoodField = /portion|porc|serving|gram|calor|kcal|protein|carb|fat|macro|nutrient|nutrition|classification/i.test(symbol);
    if (isStaticText(value) && isPresentationOnlyScalar(symbol, value.text, source.fileName) &&
        !isDecisionBearingFoodScalar(node, source)) return null;
    const numericLiteral = staticNutritionNumber(value) !== null;
    const scalarDomain = source.fileName + " " + enclosingDeclaration(node);
    const domainNumericFoodValue = rule.kind === "scalar" && numericFoodField &&
      numericLiteral &&
      /food|aliment|meal|nutrition|nutrient|ingredient|portion|porc|serving|recipe|receita/i.test(scalarDomain) &&
      !/exercise|activity|workout|fitness|burnedcalories/i.test(scalarDomain) &&
      !/^(?:grams?Per(?:Kg|Kilogram|Ounce|Pound)|milligrams?PerGram|unitConversion|conversionFactor)/i.test(symbol);
    if ((matches(rule.symbolPattern, symbol) || domainNumericFoodValue) &&
        (isStaticText(value) || (numericFoodField &&
          (ts.isNumericLiteral(value) ||
            (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)))))) {
      return { symbol, subject: node.initializer.getText(source) };
    }
  }
  if (rule.kind === "numeric-return" &&
      (ts.isReturnStatement(node) || ts.isArrowFunction(node) && !ts.isBlock(node.body))) {
    const expression = ts.isReturnStatement(node) ? node.expression : node.body;
    // Only inspect returned branches, not their conditions, so a guard like
    // foodName.length > 0 does not become a false nutritional hardcode.
    const numericParts = (expr: ts.Expression): string[] => {
      const value = unwrap(expr);
      if (ts.isNumericLiteral(value) ||
          ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)) {
        return [value.getText(source)];
      }
      if (ts.isConditionalExpression(value)) {
        return [...numericParts(value.whenTrue), ...numericParts(value.whenFalse)];
      }
      if (ts.isBinaryExpression(value) && [
        ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken,
        ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken,
        ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken,
      ].includes(value.operatorToken.kind)) {
        return [...numericParts(value.left), ...numericParts(value.right)];
      }
      return [];
    };
    if (expression && numericParts(expression).length > 0) {
      let enclosing: ts.Node | undefined = node;
      while (enclosing && !ts.isFunctionDeclaration(enclosing) &&
          !ts.isMethodDeclaration(enclosing) && !ts.isArrowFunction(enclosing) &&
          !ts.isFunctionExpression(enclosing)) enclosing = enclosing.parent;
      if (enclosing && (ts.isFunctionDeclaration(enclosing) ||
          ts.isMethodDeclaration(enclosing) || ts.isArrowFunction(enclosing) ||
          ts.isFunctionExpression(enclosing))) {
        const functionName = ts.isFunctionDeclaration(enclosing) || ts.isMethodDeclaration(enclosing)
          ? enclosing.name?.getText(source) ?? ""
          : enclosing.parent && ts.isVariableDeclaration(enclosing.parent)
            ? enclosing.parent.name.getText(source) : "";
        const parameters = enclosing.parameters.map(parameter => parameter.getText(source)).join(" ");
        const nutritionDecision = /portion|por[cç]|serving|grams|nutrition|nutrient|macro|kcal|calor/i.test(functionName);
        const foodIdentity = /food|aliment|ingredient|product|meal|item|recipe|receita/i.test(parameters);
        const excludedConversion = /conversion|convert|perkilogram|perkg|pergram|milligram|unitfactor/i.test(functionName);
        const exercise = /exercise|activity|workout|fitness|burnedcalories/i.test(
          source.fileName + " " + functionName);
        if (nutritionDecision && foodIdentity && !excludedConversion && !exercise) {
          return { symbol: functionName + ":numeric-return", subject: expression.getText(source) };
        }
      }
    }
  }
  // A dictionary consumed through Object.entries() is still a lexical decision
  // when its pairs drive normalization; it must not evade a gate merely by
  // having an arbitrary identifier and using replaceAll instead of [key].
  if (rule.kind === "lexical-lookup" && ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["entries", "keys", "values"].includes(node.expression.name.text) &&
      node.expression.expression.getText(source) === "Object" &&
      node.arguments.length === 1 &&
      referencesLiteralLexicalMap(node.arguments[0], node, unwrap)) {
    let behavior: ts.Node | undefined = node.parent;
    while (behavior && !ts.isFunctionDeclaration(behavior) &&
        !ts.isMethodDeclaration(behavior) && !ts.isArrowFunction(behavior) &&
        !ts.isFunctionExpression(behavior)) behavior = behavior.parent;
    const behaviorText = behavior?.getText(source) ?? "";
    const decisionName = enclosingDeclaration(node);
    const decisionText = decisionName + " " + source.fileName;
    const channelContext = /whatsapp|inbound|transcri|image|audio|ocr/i.test(source.fileName);
    const foodBehavior = /food|alimento|nutrition|ingredient|portion|lexic|alias|synonym|normaliz|resolv|parse|material|classif|language/i.test(decisionName);
    const domainContext = (isFoodDomainSource(source.fileName) || channelContext ||
      /food|alimento|nutrition|ingredient|portion/i.test(decisionName)) && foodBehavior;
    const unrelated = /account|status|permission|userrole|exercise|activity/i.test(decisionName);
    const isNormalization = /\.replace(?:All)?\s*\(/.test(behaviorText);
    const iterated = iteratedLexicalDecision(node, source);
    const decision = isNormalization || iterated.equality || iterated.textMethod;
    // A lexical map used by materiality or by an identity resolver is
    // governed knowledge regardless of the spelling of individual food terms.
    const materialityDecision = /material|nutrition|packag|commercial|qualifier/i.test(decisionText);
    if (!unrelated && decision &&
        (rule.ownerFunction === "lexical-knowledge" ? channelContext && domainContext :
          !rule.ownerFunction ? domainContext : materialityDecision) &&
        (rule.ownerFunction !== "attribute-materiality" || materialityDecision)) {
      return { symbol: (enclosingDeclaration(node) || "expression") + ":iterated-lexical-dictionary",
        subject: node.getText(source) + " " + behaviorText };
    }
  }
  if (rule.kind === "lexical-lookup" && ts.isElementAccessExpression(node) &&
      node.argumentExpression && !isStaticText(node.argumentExpression) &&
      referencesLiteralLexicalMap(node.expression, node, unwrap)) {
    const context = node.expression.getText(source) + " " +
      node.argumentExpression.getText(source) + " " + enclosingDeclaration(node);
    const unrelated = /status|account|user|profile|role|permission|featureflag|config|setting/i.test(context);
    const relevant = rule.ownerFunction === "lexical-knowledge"
      ? /normaliz|language|lexic|food|aliment|word|term|input|text|token/i.test(context)
      : rule.ownerFunction === "attribute-materiality"
        ? matches(rule.symbolPattern, context + " " + source.fileName)
        : isFoodDomainSource(source.fileName) || matches(rule.symbolPattern, context);
    if (!unrelated && relevant) {
      return { symbol: (enclosingDeclaration(node) || "expression") + ":lexical-dictionary",
        subject: node.getText(source) + " " + node.expression.getText(source) };
    }
  }
  if (rule.kind === "literal-membership" && ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["includes", "has", "indexOf", "some", "find", "every"].includes(node.expression.name.text) &&
      node.arguments.length > 0) {
    const method = node.expression.name.text;
    const predicate = node.arguments[0];
    const callback = (ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate)) ? predicate : null;
    const comparison = callback && callback.parameters[0] && ts.isIdentifier(callback.parameters[0].name) &&
      /(?:===|==|!==|!=)/.test(callback.body.getText(source)) &&
      callback.body.getText(source).includes(callback.parameters[0].name.text) &&
      /food|alimento|material|attribute|qualifier|ingredient|portion|nutrition/i.test(
        callback.body.getText(source) + " " + enclosingDeclaration(node));
    if (["some", "find", "every"].includes(method) && !comparison) return null;
    const words = referencesLiteralWords(node.expression.expression, node);
    if (words.length > 0) {
      const context = enclosingDeclaration(node) + " " + node.arguments[0].getText(source);
      // The source path alone cannot make administrative status values food
      // materiality. Anonymous consumers still need domain-specific lexical
      // evidence declared in the rule registry (ADR gate 18).
      const anonymousMateriality = rule.ownerFunction === "attribute-materiality" &&
        isFoodDomainSource(source.fileName) && !!rule.evidencePattern &&
        matches(rule.evidencePattern, words.join(" "));
      if (matches(rule.symbolPattern, context) || anonymousMateriality) {
        return { symbol: (enclosingDeclaration(node) || "expression") + ":lexical-membership",
          subject: node.getText(source) };
      }
    }
  }
  if (rule.kind === "literal-regex-test" && ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) && node.arguments.length > 0 &&
      (/^(?:test|exec)$/.test(node.expression.name.text) &&
        referencesLiteralRegex(node.expression.expression, node) ||
       /^(?:match|matchAll|search|replace|replaceAll)$/.test(node.expression.name.text) &&
        referencesLiteralRegex(node.arguments[0], node) ||
       /^(?:replace|replaceAll)$/.test(node.expression.name.text) &&
        isStaticText(unwrap(node.arguments[0])) &&
        /[a-zA-ZÀ-ÿ]{3,}/.test(node.arguments[0].getText(source)) &&
        isFoodDomainSource(source.fileName))) {
    const regexSource = /^(?:test|exec)$/.test(node.expression.name.text)
      ? node.expression.expression : node.arguments[0];
    const context = enclosingDeclaration(node) + " " + node.arguments[0].getText(source) +
      " " + node.expression.expression.getText(source);
    const sourceDecision = isFoodDomainSource(source.fileName) &&
      hasLexicalVocabularyRegex(regexSource, node);
    // Materiality vocabulary in the registry is evidence for this detector,
    // not a product-level nutrition or identity decision.
    const materialityLexeme = rule.ownerFunction === "attribute-materiality" && !!rule.evidencePattern &&
      (isFoodDomainSource(source.fileName) ||
        (rule.lexicalEvidencePathPattern !== undefined &&
          matches(rule.lexicalEvidencePathPattern, source.fileName))) &&
      matches(rule.evidencePattern,
        localDecisionEvidence(regexSource, node, source));
    const unrelated = /status|account|permission|role|exercise|activity|workout|fitness|render|display/i
      .test(enclosingDeclaration(node)) ||
      /^(?:status|account|permission|role|username|userName)\b/i.test(
        node.arguments[0].getText(source));
    if (!unrelated && (matches(rule.symbolPattern, context) || sourceDecision || materialityLexeme)) {
      return { symbol: (enclosingDeclaration(node) || "expression") + ":lexical-regex",
        subject: node.getText(source) };
    }
  }
  if (rule.kind === "literal-string-method" && ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["includes", "startsWith", "endsWith", "indexOf", "localeCompare"].includes(node.expression.name.text) &&
      node.arguments.length >= 1 &&
      (node.expression.name.text === "localeCompare" ? node.arguments.length <= 3 : node.arguments.length === 1) &&
      immutableDecisionString(unwrap(node.arguments[0]), node, source) !== null &&
      (!["indexOf", "localeCompare"].includes(node.expression.name.text) ||
        isLexicalNumericComparison(node))) {
    const literal = immutableDecisionString(unwrap(node.arguments[0]), node, source)!;
    const receiver = node.expression.expression.getText(source);
    const owner = enclosingDeclaration(node);
    const context = source.fileName + " " + owner + " " + receiver;
    // Only textual lexical decisions: avoid account/status/UI format checks.
    // Domain evidence comes from the decision surface, not a food-name allowlist.
    const domain = /food|aliment|nutrition|nutrient|meal|ingredient|portion|porc|serving|recipe|material|lexic|alias/i.test(context);
    const unrelated = /account|status|permission|userrole|exercise|activity|workout|fitness/i.test(owner + " " + receiver);
    const word = /[a-zA-ZÀ-ÿ]{2,}/.test(literal);
    const semanticOwner = /food|aliment|nutrition|meal|ingredient|portion|porc|serving|recipe|lexic|alias|normaliz/i.test(owner + " " + receiver);
    const decidingFunction = /classif|resolv|normaliz|parse|identif|detect|decid|qualif|match|infer|select|extract/i.test(owner);
    const relevant = rule.ownerFunction === "attribute-materiality"
      ? matches(rule.evidencePattern, literal) ||
        /material|qualifier|attribute|packag|commercial/i.test(owner + " " + receiver)
      : rule.ownerFunction === "lexical-knowledge"
        ? /food|aliment|normaliz|lexic|alias|synonym|input/i.test(owner + " " + receiver)
        : semanticOwner || (isFoodDomainSource(source.fileName) && decidingFunction);
    if (word && domain && !unrelated && relevant) {
      return { symbol: (owner || "expression") + ":literal-string-" + node.expression.name.text,
        subject: node.getText(source) };
    }
  }
  const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
  const onlyNamedTypes = bindings && ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 && bindings.elements.every(specifier => specifier.isTypeOnly) &&
    !node.importClause?.name;
  if (rule.kind === "import") {
    let moduleSpecifier: string | undefined;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
        !node.importClause?.isTypeOnly && !onlyNamedTypes) {
      moduleSpecifier = node.moduleSpecifier.text;
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      const clause = node.exportClause;
      const typesOnly = clause && ts.isNamedExports(clause) &&
        clause.elements.length > 0 && clause.elements.every(e => e.isTypeOnly);
      if (!typesOnly) moduleSpecifier = node.moduleSpecifier.text;
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteral(node.moduleReference.expression)) {
      moduleSpecifier = node.moduleReference.expression.text;
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0]) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      moduleSpecifier = node.arguments[0].text;
    }
    if (moduleSpecifier && matches(rule.symbolPattern, moduleSpecifier)) {
      return { symbol: moduleSpecifier, subject: node.getText(source) };
    }
  }
  if (rule.kind === "function") {
    const propertyCallable = (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) &&
      node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ? node.initializer : undefined;
    const symbol = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
      ? node.name?.getText(source)
      : ts.isVariableDeclaration(node) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
          ? node.name.getText(source)
          : propertyCallable && (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node))
            ? node.name.getText(source).replace(/^['"]|['"]$/g, "") : undefined;
    if (symbol) {
      const declarationCallable = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
        ? node : ts.isVariableDeclaration(node) && node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
            ? node.initializer : undefined;
      const callable = propertyCallable ?? declarationCallable;
      const signature = symbol + " " + (callable?.parameters
        .map(parameter => parameter.getText(source)).join(" ") ?? "");
      const body = callable?.body?.getText(source) ?? "";
      // Generic resolver signatures are not evidence of safety: follow the
      // actual food/nutrition lookup in the body, including imported catalogs.
      const foodBodyDecision =
        /food|alimento|nutrition|nutrient|portion|porc|serving|ingredient|meal/i.test(body) &&
        /\[[^\]]+\]|\.get\s*\(|\.find\s*\(|\.filter\s*\(|resolve|select|decide|match|lookup|return\s*\{/i.test(body);
      const namedRule = matches(rule.symbolPattern, symbol);
      const genericOwnerRule = !rule.pathPattern;
      if (!namedRule && !(genericOwnerRule &&
          /resolv|select|identify|infer|classif|lookup|match|choose|decid|pick|find/i.test(symbol) &&
          foodBodyDecision)) return null;
      // Account/status resolvers without food-specific decisions stay outside
      // gate 2 even if they have a generic resolver-like name.
      if (genericOwnerRule &&
          !/food|alimento|nutrition|nutrient|portion|porc|serving|ingredient|meal/i.test(signature) &&
          !foodBodyDecision) return null;
      // A pure delegation to the real canonical import is not a competing
      // owner, whether it uses a function, arrow, class or object method.
      if (callable && isCanonicalFoodResolverDelegate(callable, source)) return null;
      return { symbol, subject: node.getText(source) };
    }
  }
  if (rule.kind === "literal-switch" && ts.isCaseClause(node) &&
      isStaticText(node.expression)) {
    const block = node.parent;
    const branch = ts.isCaseBlock(block) && block.parent && ts.isSwitchStatement(block.parent)
      ? block.parent : null;
    if (!branch) return null;
    const operand = branch.expression.getText(source);
    const relevant = rule.ownerFunction !== "attribute-materiality"
      ? matches(rule.symbolPattern, operand) ||
        hasFoodNameDecisionContext(branch.expression, node, source) ||
        hasGenericFoodIdentityDecisionContext(branch.expression, node, source)
      : matches(rule.symbolPattern, operand) ||
        matches(rule.symbolPattern, enclosingDeclaration(node));
    if (relevant) {
      return { symbol: (enclosingDeclaration(node) || "expression") + ":" + operand + ":lexical-switch",
        subject: branch.expression.getText(source) + " => " + node.getText(source) };
    }
  }
  if (rule.kind === "literal-branch" && ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]
      .includes(node.operatorToken.kind)) {
    // Only const-bound alternatives proven static on every branch count;
    // mutable variables and unknown branches never become literal evidence.
    const alternatives = (expression: ts.Expression, at: ts.Node, depth = 0,
      seen = new Set<ts.VariableDeclaration>()): string[] => {
      if (depth > 8) return [];
      const value = unwrap(expression);
      if (ts.isConditionalExpression(value)) {
        const yes = alternatives(value.whenTrue, value, depth + 1, new Set(seen));
        const no = alternatives(value.whenFalse, value, depth + 1, new Set(seen));
        return yes.length && no.length ? [...new Set([...yes, ...no])] : [];
      }
      const direct = immutableDecisionString(value, at, source);
      if (direct !== null) return direct.length ? [direct] : [];
      if (!ts.isIdentifier(value)) return [];
      for (let scope: ts.Node | undefined = at; scope; scope = scope.parent) {
        if (ts.isFunctionLike(scope) && scope.parameters.some(parameter =>
          ts.isIdentifier(parameter.name) && parameter.name.text === value.text)) return [];
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || decl.name.text !== value.text) continue;
            if (!(statement.declarationList.flags & ts.NodeFlags.Const) || !decl.initializer ||
                seen.has(decl) || decl.getStart(source) >= at.getStart(source)) return [];
            const next = new Set(seen); next.add(decl);
            return alternatives(decl.initializer, decl, depth + 1, next);
          }
        }
      }
      return [];
    };
    const leftLiterals = alternatives(node.left, node);
    const rightLiterals = alternatives(node.right, node);
    if (!leftLiterals.length && !rightLiterals.length) return null;
    const leftLiteral = leftLiterals[0] ?? null;
    const rightLiteral = rightLiterals[0] ?? null;
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
    const identity = leftLiteral !== null ? node.right : node.left;
    // A typed state guard is not lexical food knowledge or attribute materiality.
    const literal = leftLiteral ?? rightLiteral;
    if (literal && isStructuralContractComparison(identity, literal)) return null;
    const operand = identity.getText(source);
    const relevant = rule.ownerFunction !== "attribute-materiality"
      ? matches(rule.symbolPattern, operand) || hasFoodNameDecisionContext(
        identity, node, source) ||
        hasGenericFoodIdentityDecisionContext(identity, node, source)
      : matches(rule.symbolPattern, functionName) || matches(rule.symbolPattern, operand);
    if (relevant) {
      return { symbol: (functionName || "expression") + ":" + operand + ":lexical-branch",
        subject: node.getText(source) };
    }
  }
  if (rule.kind === "call" && ts.isCallExpression(node)) {
    const symbol = callTargetName(node.expression);
    const argumentsText = node.arguments.map(a => a.getText(source)).join(" ");
    const provenance = rule.ownerFunction === "decision-roundtrip" ?
      node.arguments.map(arg => localDecisionEvidence(arg, node, source)).join(" ") : "";
    if (matches(rule.symbolPattern, symbol) &&
        matches(rule.evidencePattern, argumentsText + " " + provenance)) {
      return { symbol, subject: node.getText(source) };
    }
  }
  return null;
}

/**
 * JSON catalogs are food knowledge just as TS/JS literal tables are. A JSON
 * source produces one finding per gate/file; its normalized content hash makes
 * additions and edits visible without flooding the debt ledger with every row.
 * Non-food JSON does not produce a finding.
 */
function isJsonNutritionValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.some(([key, entry]) =>
    /^(?:nutrition|nutrients|macros)$/i.test(key)
      ? isJsonNutritionValue(entry)
      : /^(?:calories|kcal|energykcal|protein|carbs|fat|fiber|grams|portiongrams|portion_grams|servinggrams|serving_grams)$/i.test(key) &&
        typeof entry === "number" && Number.isFinite(entry));
}

function findJsonFoodCatalog(
  file: FoodArchitectureFile, consumerEvidence = "", indexedByFoodIdentity = false,
  usedAsFoodRecords = false,
): FoodFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    throw new Error("Invalid production JSON source: " + file.path);
  }

  // "name" plus "calories" is ambiguous: activity and exercise data use
  // precisely that shape. Nutrition, food identity or a food-specific source
  // must independently establish the domain before the static gate blocks.
  const foodSource = /food|aliment|nutrition|nutrient|meal|ingredient|portion|serving|recipe/i.test(file.path);
  const channelSource = /whatsapp|inbound|transcri|image|audio|ocr/i.test(file.path);
  // An otherwise anonymous aliases.json becomes a food lexicon when loaded
  // by a food decision module. Generic account/status aliases remain exempt.
  const lexicalDomain = /food|aliment|nutrition|nutrient|meal|ingredient|portion|serving|recipe/i.test(
    file.path + " " + consumerEvidence);
  let foodRows = 0;
  let lexicalRows = 0;
  function walk(value: unknown, context: string): void {
    if (Array.isArray(value)) {
      // Productive food selection is sufficient without a special alias key.
      if (usedAsFoodRecords && value.length > 0 && value.every(entry =>
          typeof entry === "string" && entry.trim().length > 0)) lexicalRows++;
      // A plain array of governed food aliases is itself lexical knowledge.
      // Keep inert fixtures and account/status dictionaries out of scope.
      if (value.length > 0 && value.every(entry =>
          typeof entry === "string" && entry.trim().length > 0) &&
          /alias|synonym|sinonim|lexicon|vocab|normaliz|replacement/i.test(context) &&
          lexicalDomain) {
        lexicalRows++;
      }
      value.forEach(entry => walk(entry, context));
      return;
    }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const entries = Object.entries(item);
    // A governed food alias map can be a plain {"pao":"pão"} JSON object.
    // Require food + lexical context from the path or enclosing JSON key;
    // never infer that any ordinary string dictionary is a food lexicon.
    if (entries.length > 0 &&
        entries.every(([key, entry]) => key.trim().length > 0 &&
          typeof entry === "string" && entry.trim().length > 0) &&
        /alias|synonym|sinonim|lexicon|vocab|normaliz|replacement/i.test(context + " " + consumerEvidence) &&
        (lexicalDomain || /food|aliment|nutrition|nutrient|meal|ingredient|portion|serving|recipe/i.test(context))) {
      lexicalRows++;
    }

    const explicitIdentity = ["foodName", "food_name", "foodId", "food_id",
      "food", "productName", "alimento", "ingredient", "ingredientId"].some(key =>
      typeof item[key] === "string" || typeof item[key] === "number");
    const genericIdentity = ["name", "label", "slug", "nome"].some(key =>
      typeof item[key] === "string" || typeof item[key] === "number");
    const specificNutrition = ["kcal", "protein", "carbs", "fat", "fiber",
      "gramsPerServing", "portionGrams", "portion_grams", "servingGrams",
      "energyKcal"].some(key => typeof item[key] === "number");
    const nestedNutrition = ["nutrition", "nutrients", "macros"].some(key => {
      const entry = item[key];
      return entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
        ["calories", "kcal", "protein", "carbs", "fat"].some(n =>
          typeof (entry as Record<string, unknown>)[n] === "number");
    });
    const governedAttributes = ["aliases", "synonyms", "synonimos", "lexicon",
      "portions", "portionGrams", "servingGrams", "grams", "processingLevel",
      "classification"].some(key =>
      Array.isArray(item[key]) || typeof item[key] === "string" || typeof item[key] === "number");
    const genericCalories = typeof item.calories === "number";
    // Numeric dictionaries keyed by food identity are production knowledge
    // even without a name/grams field: {"pão":50,"arroz":90}. Domain evidence
    // must come from a food/portion/catalog context, never a product name list.
    const foodNumericMap = entries.length > 0 &&
      entries.some(([key, entry]) => key.trim().length > 0 &&
        // Nutrition fields belong to a record, not to a dictionary indexed
        // by food identity. A sibling inert collection must not activate it.
        !/^(?:calories|kcal|energyKcal|protein|carbs|fat|fiber|grams|portionGrams|portion_grams|servingGrams|serving_grams)$/i.test(key) &&
        isJsonNutritionValue(entry)) &&
      (indexedByFoodIdentity || (
        /(?:food|alimento).*(?:portion|porc|serving|gram|macro|nutri|catalog)|(?:portion|porc|serving|gram|macro|nutri|catalog).*(?:food|alimento)/i.test(context + " " + consumerEvidence) &&
        !/(?:config|settings|preferences|options)\.json$/i.test(file.path)
      ));
    if (foodNumericMap) foodRows++;
    if ((explicitIdentity || genericIdentity) &&
        (specificNutrition || nestedNutrition || governedAttributes ||
          (genericCalories && (explicitIdentity || foodSource || usedAsFoodRecords)))) foodRows++;
    for (const [key, child] of entries) walk(child, context + " " + key);
  }
  walk(parsed, file.path);
  if (!foodRows && !lexicalRows) return [];

  let hash = 2166136261;
  // FNV-1a over normalized JSON; whitespace-only changes preserve identity.
  for (const character of JSON.stringify(parsed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const digest = (hash >>> 0).toString(16).padStart(8, "0");
  const foodCatalogRule = FOOD_WAVE_ONE_RULES.find(rule =>
    rule.detectorKey === "food-static-collection" && rule.failureClass === "I");
  const numericPortionRule = FOOD_WAVE_ONE_RULES.find(rule =>
    rule.detectorKey === "food-numeric-map-portions");
  const lexicalRule = FOOD_WAVE_ONE_RULES.find(rule =>
    rule.kind === "lexical-lookup" && !rule.ownerFunction);
  const channelLexicalRule = FOOD_WAVE_ONE_RULES.find(rule =>
    rule.ownerFunction === "lexical-knowledge");
  const rules = foodRows
    ? [foodCatalogRule, numericPortionRule].filter((rule): rule is FoodWaveOneRule => !!rule)
    : [lexicalRule].filter((rule): rule is FoodWaveOneRule => !!rule);
  if (lexicalRows && channelSource && channelLexicalRule &&
      !rules.some(rule => rule.ownerFunction === channelLexicalRule.ownerFunction)) {
    rules.push(channelLexicalRule);
  }
  return rules.map(rule => ({
    ruleId: rule.id, file: file.path, line: 1,
    symbol: foodRows ? "json-food-catalog" : "json-food-lexicon",
    fingerprint: rule.id + ":" + file.path + ":" +
      (foodRows ? "json-food-catalog:" : "json-food-lexicon:") + digest,
    failureClass: rule.failureClass,
    description: rule.description,
  }));
}

/**
 * Resolve local runtime dependencies without restricting imports to three legacy
 * source roots. A production entrypoint may import a package outside server/.
 */
function resolveRuntimeDependencies(
  importer: string, specifier: string, indexed: Map<string, FoodArchitectureFile>,
): string[] {
  let base: string;
  if (specifier.startsWith(".")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  } else if (specifier.startsWith("/")) {
    // Absolute marker for paths rooted at process.cwd(), not at the importer.
    base = path.posix.normalize(specifier.slice(1));
  } else if (specifier.startsWith("@/")) {
    base = "client/src/" + specifier.slice(2);
  } else if (specifier.startsWith("@shared/")) {
    base = "shared/" + specifier.slice("@shared/".length);
  } else if (/^(?:server|shared|client\/src|packages|apps|src|lib|modules)\//.test(specifier)) {
    base = specifier;
  } else {
    return [];
  }
  const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
  const candidates = [base, ...extensions.map(ext => base + ext),
    ...extensions.map(ext => base + "/index" + ext)];
  // A transpiled .js specifier may refer to the TypeScript source in the tree.
  if (/\.[cm]?js$/.test(base)) {
    const stem = base.replace(/\.[cm]?js$/, "");
    candidates.push(stem + ".ts", stem + ".tsx", stem + ".mts", stem + ".cts");
  }
  return [...new Set(candidates)].filter(candidate => indexed.has(candidate));
}

/** Vite serves client/public at the client URL root, not the module root.
 * Only statically addressed assets in that configured directory are provable.
 * Resolving a public URL as an ordinary absolute import would incorrectly
 * attribute it to a repository-root module, or ignore it altogether.
 */
function resolveVitePublicAsset(
  importer: string, specifier: string, indexed: Map<string, FoodArchitectureFile>,
): string[] {
  if (!importer.startsWith("client/src/") || !specifier.startsWith("/") ||
      specifier.startsWith("//") || /\\/.test(specifier)) return [];
  // Browser search parameters and fragments do not change the public asset.
  // Keep the proven local source even when the URL uses a cache-busting suffix.
  const pathname = specifier.split(/[?#]/, 1)[0];
  if (!pathname || pathname === "/") return [];
  const candidate = path.posix.normalize("client/public/" + pathname.slice(1));
  return candidate.startsWith("client/public/") && indexed.has(candidate) ? [candidate] : [];
}

/**
 * Resolve statically proven Vite fetch URLs. Keep aliases local and immutable:
 * a runtime URL, local fetch implementation, or shadowed browser global is not
 * evidence that client/public supplied food knowledge.
 */
function staticViteFetchUrl(node: ts.CallExpression): string | null {
  if (!node.arguments[0] || !hasStaticNativeFetchRequestInit(node) ||
      !isNativeViteFetchTarget(node.expression, node)) return null;

  const resolve = (
    expression: ts.Expression, use: ts.Node,
    seen = new Set<ts.VariableDeclaration>(), depth = 0,
  ): string | null => {
    if (depth > 10) return null;
    const value = unwrap(expression);
    if (isStaticText(value)) return value.text;
    if (!ts.isIdentifier(value)) return null;
    for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
          ts.isIdentifier(param.name) && param.name.text === value.text)) return null;
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          ts.isIdentifier(scope.variableDeclaration.name) &&
          scope.variableDeclaration.name.text === value.text) return null;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== value.text) continue;
            if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
                !declaration.initializer || seen.has(declaration) ||
                declaration.getStart() >= use.getStart()) return null;
            seen.add(declaration);
            return resolve(declaration.initializer, declaration, seen, depth + 1);
          }
        }
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
            statement.name?.text === value.text) return null;
        if (ts.isImportDeclaration(statement) && statement.importClause &&
            (statement.importClause.name?.text === value.text ||
              (statement.importClause.namedBindings &&
                (ts.isNamespaceImport(statement.importClause.namedBindings)
                  ? statement.importClause.namedBindings.name.text === value.text
                  : statement.importClause.namedBindings.elements.some(el => el.name.text === value.text)))))
          return null;
      }
    }
    return null;
  };
  return resolve(node.arguments[0], node);
}

function isNativeViteFetch(node: ts.CallExpression): boolean {
  return staticViteFetchUrl(node) !== null;
}

/** Resolve only statically knowable filesystem loads; unresolved paths are not exempted. */
function staticFilesystemPath(argument: ts.Expression): string | null {
  const value = unwrap(argument);
  // Node filesystem paths without __dirname or import.meta.url are resolved from process.cwd().
  if (isStaticText(value)) return path.posix.normalize("/" + value.text);
  if (ts.isNewExpression(value) && value.expression.getText() === "URL" &&
      value.arguments?.length === 2 && isStaticText(unwrap(value.arguments[0])) &&
      /import\.meta\.url/.test(value.arguments[1].getText())) {
    return (unwrap(value.arguments[0]) as ts.StringLiteral).text;
  }
  if (ts.isCallExpression(value) &&
      /^(?:fileURLToPath|url\.fileURLToPath)$/.test(value.expression.getText()) &&
      value.arguments[0]) return staticFilesystemPath(value.arguments[0]);
  if (ts.isCallExpression(value) &&
      /^(?:path\.)?(?:join|resolve)$/.test(value.expression.getText())) {
    const args = value.arguments.map(a => unwrap(a));
    const literal = args.filter(isStaticText).map(a => a.text);
    if (literal.length !== args.length &&
        !(args.length > 1 && /^(?:__dirname|process\.cwd\(\))$/.test(args[0].getText()) &&
          literal.length === args.length - 1)) return null;
    if (args.length > literal.length) {
      if (args[0].getText() === "__dirname") return "./" + literal.join("/");
      // process.cwd() is the repository root; relative module resolution
      // would otherwise turn data/food.json into server/data/food.json.
      if (args[0].getText() === "process.cwd()") return "/" + path.posix.join(...literal);
    }
    return path.posix.normalize("/" + path.posix.join(...literal));
  }
  return null;
}

/** Track statically imported filesystem APIs, including renamed imports and
 * CommonJS bindings. Matching a bare identifier name without resolving its
 * provider would miss otherwise ordinary aliases such as `readFileSync as load`.
 */
function filesystemReadBindings(source: ts.SourceFile): {
  sync: Set<string>; any: Set<string>; isReader: (expression: ts.Expression) => boolean;
} {
  // Never infer a real filesystem reader from a bare variable name.
  // `fs`/`readFileSync` can also name unrelated local helpers or third-party APIs.
  const sync = new Set<string>();
  const any = new Set<string>();
  const namespaces = new Set<string>();
  const addNamespace = (name: string): void => {
    namespaces.add(name);
    sync.add(name + ".readFileSync");
    for (const method of ["readFile", "promises.readFile"]) any.add(name + "." + method);
    any.add(name + ".readFileSync");
  };
  const addMember = (name: string, original: string): void => {
    if (original === "readFileSync") {
      sync.add(name);
      any.add(name);
    } else if (original === "readFile") {
      any.add(name);
    } else if (original === "promises") {
      any.add(name + ".readFile");
    }
  };
  const fsModule = (specifier: string): boolean => specifier === "fs" || specifier === "node:fs";
  const fsPromisesModule = (specifier: string): boolean =>
    specifier === "fs/promises" || specifier === "node:fs/promises";
  const addPromiseNamespace = (name: string): void => {
    namespaces.add(name);
    any.add(name + ".readFile");
  };
  const collectBindings = (name: ts.BindingName, promises: boolean): void => {
    if (ts.isIdentifier(name)) {
      if (promises) addPromiseNamespace(name.text);
      else addNamespace(name.text);
    } else if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const original = element.propertyName?.getText(source).replace(/^['"]|['"]$/g, "") ?? element.name.text;
        addMember(element.name.text, original);
      }
    }
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
        (fsModule(statement.moduleSpecifier.text) ||
          fsPromisesModule(statement.moduleSpecifier.text)) && !statement.importClause?.isTypeOnly) {
      const clause = statement.importClause;
      const promises = fsPromisesModule(statement.moduleSpecifier.text);
      if (clause?.name) {
        if (promises) addPromiseNamespace(clause.name.text);
        else addNamespace(clause.name.text);
      }
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        if (promises) addPromiseNamespace(clause.namedBindings.name.text);
        else addNamespace(clause.namedBindings.name.text);
      } else if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (!element.isTypeOnly) addMember(element.name.text, element.propertyName?.text ?? element.name.text);
        }
      }
    } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly &&
        ts.isExternalModuleReference(statement.moduleReference) &&
        statement.moduleReference.expression &&
        ts.isStringLiteral(statement.moduleReference.expression) &&
        (fsModule(statement.moduleReference.expression.text) ||
          fsPromisesModule(statement.moduleReference.expression.text))) {
      if (fsPromisesModule(statement.moduleReference.expression.text)) addPromiseNamespace(statement.name.text);
      else addNamespace(statement.name.text);
    }
  }
  // Variable aliases in the same source may appear after their provider import.
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isCallExpression(init) && isNodeRequireCall(init) && init.arguments[0] &&
          ts.isStringLiteral(init.arguments[0]) &&
          (fsModule(init.arguments[0].text) || fsPromisesModule(init.arguments[0].text))) {
        collectBindings(node.name, fsPromisesModule(init.arguments[0].text));
      } else if (ts.isIdentifier(init) && namespaces.has(init.text)) {
        collectBindings(node.name, any.has(init.text + ".readFile") &&
          !sync.has(init.text + ".readFileSync"));
      } else if (ts.isIdentifier(node.name) && ts.isIdentifier(init) && sync.has(init.text)) {
        addMember(node.name.text, "readFileSync");
      } else if (ts.isIdentifier(node.name) && ts.isIdentifier(init) && any.has(init.text)) {
        addMember(node.name.text, "readFile");
      } else if (ts.isIdentifier(node.name) &&
          (ts.isPropertyAccessExpression(init) || ts.isElementAccessExpression(init))) {
        const invoked = filesystemExpressionName(init);
        if (sync.has(invoked) || isDirectFilesystemSyncReader(init)) {
          addMember(node.name.text, "readFileSync");
        } else if (any.has(invoked)) addMember(node.name.text, "readFile");
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  // F12: filename-wide names are discovery hints, not proof of a filesystem
  // provider. Resolve the lexical binding at the exact read call instead.
  type Role = "namespace" | "promises" | "sync" | "async";
  const fsRole = (specifier: string): Role | undefined =>
    fsModule(specifier) ? "namespace" :
      fsPromisesModule(specifier) ? "promises" : undefined;
  const memberRole = (role: Role | undefined, member: string): Role | undefined => {
    if (role === "namespace" && member === "promises") return "promises";
    if (role === "namespace" && member === "readFileSync") return "sync";
    if ((role === "namespace" || role === "promises") && member === "readFile") return "async";
    return undefined;
  };
  const resolveRole = (candidate: ts.Expression, visited = new Set<ts.Node>(),
    depth = 0): Role | undefined => {
    if (depth > 12) return undefined;
    const value = unwrap(candidate);
    if (visited.has(value)) return undefined;
    const next = new Set(visited);
    next.add(value);
    if (ts.isCallExpression(value) && isNodeRequireCall(value) &&
        value.arguments.length === 1 && ts.isStringLiteral(value.arguments[0])) {
      return fsRole(value.arguments[0].text);
    }
    if (ts.isPropertyAccessExpression(value)) {
      return memberRole(resolveRole(value.expression, next, depth + 1), value.name.text);
    }
    if (ts.isElementAccessExpression(value) && value.argumentExpression &&
        isStaticText(unwrap(value.argumentExpression))) {
      return memberRole(resolveRole(value.expression, next, depth + 1),
        (unwrap(value.argumentExpression) as ts.StringLiteral).text);
    }
    if (!ts.isIdentifier(value)) return undefined;
    const name = value.text;
    for (let scope: ts.Node | undefined = value; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) &&
          scope.parameters.some(param => ts.isIdentifier(param.name) &&
            param.name.text === name)) return undefined;
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          ts.isIdentifier(scope.variableDeclaration.name) &&
          scope.variableDeclaration.name.text === name) return undefined;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      // A mutable alias (or a declaration shadowing an import) is opaque.
      for (const statement of scope.statements) {
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
            statement.name?.text === name) return undefined;
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            const isConst = !!(statement.declarationList.flags & ts.NodeFlags.Const);
            if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
              return isConst && declaration.initializer
                ? resolveRole(declaration.initializer, next, depth + 1) : undefined;
            }
            if (ts.isObjectBindingPattern(declaration.name)) {
              for (const element of declaration.name.elements) {
                if (!ts.isIdentifier(element.name) || element.name.text !== name) continue;
                const property = element.propertyName ?? element.name;
                const member = ts.isIdentifier(property) || ts.isStringLiteral(property)
                  ? property.text : "";
                return isConst && declaration.initializer
                  ? memberRole(resolveRole(declaration.initializer, next, depth + 1), member)
                  : undefined;
              }
            }
          }
        }
      }
      if (!ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
            !statement.importClause?.isTypeOnly) {
          const role = fsRole(statement.moduleSpecifier.text);
          if (!role) continue;
          const clause = statement.importClause;
          if (clause?.name?.text === name) return role;
          if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) &&
              clause.namedBindings.name.text === name) return role;
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) {
              if (element.name.text !== name || element.isTypeOnly) continue;
              return memberRole(role, element.propertyName?.text ?? element.name.text);
            }
          }
        }
        if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly &&
            statement.name.text === name && ts.isExternalModuleReference(statement.moduleReference) &&
            statement.moduleReference.expression &&
            ts.isStringLiteral(statement.moduleReference.expression)) {
          return fsRole(statement.moduleReference.expression.text);
        }
      }
    }
    return undefined;
  };
  return { sync, any, isReader: expression =>
    ["sync", "async"].includes(resolveRole(expression) ?? "") };
}

function filesystemExpressionName(expression: ts.Node): string {
  if (ts.isIdentifier(expression)) return expression.text;
  // CommonJS supports direct member calls and assignments without an
  // intermediate namespace variable: require("node:fs").readFileSync(...).
  // Only a literal fs provider is trusted, never require(variable) or a
  // similarly named third-party module.
  if (ts.isCallExpression(expression) && isNodeRequireCall(expression) &&
      expression.arguments.length === 1 &&
      ts.isStringLiteral(expression.arguments[0]) &&
      (expression.arguments[0].text === "fs" || expression.arguments[0].text === "node:fs")) {
    return "fs";
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return filesystemExpressionName(expression.expression) + "." + expression.name.text;
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression &&
      isStaticText(expression.argumentExpression)) {
    return filesystemExpressionName(expression.expression) + "." + expression.argumentExpression.text;
  }
  return "";
}

/** A direct CommonJS fs call has provider evidence without a named binding.
 * Requiring this identity avoids mistaking a local `fs` object for node:fs.
 */
function isDirectFilesystemSyncReader(expression: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression)) return false;
  const member = ts.isPropertyAccessExpression(expression) ? expression.name.text :
    expression.argumentExpression && isStaticText(unwrap(expression.argumentExpression)) ?
      (unwrap(expression.argumentExpression) as ts.StringLiteral).text : "";
  if (member !== "readFileSync") return false;
  const provider = expression.expression;
  return ts.isCallExpression(provider) && isNodeRequireCall(provider) &&
    provider.arguments.length === 1 &&
    ts.isStringLiteral(provider.arguments[0]) &&
    (provider.arguments[0].text === "fs" || provider.arguments[0].text === "node:fs");
}

/** Prove a filesystem provider, including fs/promises, instead of trusting a
 * name like readFile that may refer to a local unrelated function.
 */
function isDirectFilesystemAsyncReader(expression: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression)) return false;
  const member = ts.isPropertyAccessExpression(expression) ? expression.name.text :
    expression.argumentExpression && isStaticText(unwrap(expression.argumentExpression)) ?
      (unwrap(expression.argumentExpression) as ts.StringLiteral).text : "";
  if (member !== "readFile") return false;
  const isRequireOf = (node: ts.Node, modules: string[]): boolean =>
    ts.isCallExpression(node) && isNodeRequireCall(node) &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0]) && modules.includes(node.arguments[0].text);
  const provider = expression.expression;
  return isRequireOf(provider, ["node:fs/promises", "fs/promises"]) ||
    (ts.isPropertyAccessExpression(provider) && provider.name.text === "promises" &&
      isRequireOf(provider.expression, ["node:fs", "fs"]));
}

/** Prove the *native* JSON parser at the call site. A textual `JSON.parse`
 * match can refer to a local parameter or a shadowed parser; conversely
 * bracket notation and immutable local aliases invoke the same intrinsic.
 */
function isNativeJsonParseCall(call: ts.CallExpression): boolean {
  const source = call.getSourceFile();
  const bindingContains = (name: ts.BindingName, sought: string): boolean =>
    ts.isIdentifier(name) ? name.text === sought :
      name.elements.some(element => ts.isBindingElement(element) &&
        bindingContains(element.name, sought));
  type Binding = { declaration?: ts.VariableDeclaration; shadowed: boolean };
  const bindingAt = (name: string, use: ts.Node): Binding => {
    for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) &&
          scope.parameters.some(param => bindingContains(param.name, name))) return { shadowed: true };
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          bindingContains(scope.variableDeclaration.name, name)) return { shadowed: true };
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
            statement.name?.text === name)) return { shadowed: true };
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (bindingContains(declaration.name, name)) {
              return { declaration, shadowed: true };
            }
          }
        }
        if (ts.isImportDeclaration(statement) && statement.importClause) {
          const clause = statement.importClause;
          if (clause.name?.text === name ||
              (clause.namedBindings && (ts.isNamespaceImport(clause.namedBindings)
                ? clause.namedBindings.name.text === name
                : clause.namedBindings.elements.some(element => element.name.text === name)))) {
            return { shadowed: true };
          }
        }
        if (ts.isImportEqualsDeclaration(statement) && statement.name.text === name) {
          return { shadowed: true };
        }
      }
    }
    return { shadowed: false };
  };
  const constantInitializer = (expr: ts.Identifier, use: ts.Node): ts.Expression | null => {
    const { declaration } = bindingAt(expr.text, use);
    if (!declaration || !declaration.initializer ||
        !(ts.isVariableDeclarationList(declaration.parent) &&
          (declaration.parent.flags & ts.NodeFlags.Const)) ||
        declaration.getStart(source) >= use.getStart(source)) return null;
    return declaration.initializer;
  };
  const nativeObject = (expression: ts.Expression, use: ts.Node,
    visited = new Set<string>(), depth = 0): boolean => {
    if (depth > 12) return false;
    const value = unwrap(expression);
    if (!ts.isIdentifier(value)) return false;
    if (value.text === "JSON") return !bindingAt("JSON", use).shadowed;
    if (visited.has(value.text)) return false;
    const initializer = constantInitializer(value, use);
    return !!initializer && nativeObject(initializer, initializer,
      new Set([...visited, value.text]), depth + 1);
  };
  const parser = (expression: ts.Expression, use: ts.Node,
    visited = new Set<string>(), depth = 0): boolean => {
    if (depth > 12) return false;
    const value = unwrap(expression);
    if (ts.isPropertyAccessExpression(value) && value.name.text === "parse") {
      return nativeObject(value.expression, use);
    }
    if (ts.isElementAccessExpression(value) && value.argumentExpression &&
        isStaticText(unwrap(value.argumentExpression)) &&
        (unwrap(value.argumentExpression) as ts.StringLiteral).text === "parse") {
      return nativeObject(value.expression, use);
    }
    if (!ts.isIdentifier(value) || visited.has(value.text)) return false;
    const initializer = constantInitializer(value, use);
    return !!initializer && parser(initializer, initializer,
      new Set([...visited, value.text]), depth + 1);
  };
  return parser(call.expression, call);
}

/** Resolve a parsed numeric JSON binding, including awaited fs/promises reads.
 * Unknown/dynamic paths stay outside the static proof and require separate review.
 */
function parsedFilesystemJsonPath(initializer: ts.Expression,
  bindings: ReturnType<typeof filesystemReadBindings>, location?: ts.Node): string | null {
  const unwrapAwait = (node: ts.Expression): ts.Expression => {
    let value = unwrap(node);
    while (ts.isAwaitExpression(value)) value = unwrap(value.expression);
    return value;
  };
  const parsed = unwrapAwait(initializer);
  if (!ts.isCallExpression(parsed) || !isNativeJsonParseCall(parsed) ||
      parsed.arguments.length < 1) return null;
  let read = unwrapAwait(parsed.arguments[0]);
  // Common async pattern: const raw = await readFile(...); JSON.parse(raw).
  if (ts.isIdentifier(read) && location) {
    const target = read.text;
    for (let scope: ts.Node | undefined = location; scope; scope = scope.parent) {
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      const declaration = scope.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations])
        .find(decl => ts.isIdentifier(decl.name) && decl.name.text === target);
      if (declaration) {
        // AUD1300-F29: a definite assignment before JSON.parse replaces the
        // original fs content. Do not attribute an abandoned read to the JSON.
        // Conditional writes are not definite and preserve the possible source.
        let current = declaration.initializer;
        const mutable = ts.isVariableDeclarationList(declaration.parent) &&
          !(declaration.parent.flags & ts.NodeFlags.Const);
        if (mutable) {
          // Compare source-order positions against this AST's own SourceFile.
          const source = location.getSourceFile();
          for (const statement of scope.statements) {
            if (statement.getStart(source) <= declaration.getStart(source) ||
                statement.getStart(source) >= location.getStart(source)) continue;
            if (!ts.isExpressionStatement(statement) ||
                !ts.isBinaryExpression(statement.expression) ||
                statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
                !ts.isIdentifier(statement.expression.left) ||
                statement.expression.left.text !== target) continue;
            current = statement.expression.right;
          }
        }
        read = current ? unwrapAwait(current) : read;
        break;
      }
    }
  }
  if (!ts.isCallExpression(read) ||
      !bindings.isReader(read.expression) ||
      !read.arguments[0]) return null;
  const file = staticFilesystemPath(read.arguments[0]);
  return file && /\.json$/i.test(file) ? file : null;
}

/**
 * Runtime food data loaded from an unknown filesystem path cannot be excluded
 * as an inert fixture. Record a static gate finding rather than claiming that
 * a missing path in the dependency graph proves the content is safe.
 * Only actual Node fs bindings consumed by JSON.parse qualify.
 */
function isOpaqueFoodJsonLoad(node: ts.Node, source: ts.SourceFile,
  bindings: ReturnType<typeof filesystemReadBindings>): boolean {
  if (!ts.isCallExpression(node) || !isNativeJsonParseCall(node) ||
      !node.arguments[0]) return false;
  const unwrapAwait = (expr: ts.Expression): ts.Expression => {
    let result = unwrap(expr);
    while (ts.isAwaitExpression(result)) result = unwrap(result.expression);
    return result;
  };
  let read = unwrapAwait(node.arguments[0]);
  if (ts.isIdentifier(read)) {
    const name = read.text;
    for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      const declaration = scope.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations])
        .find(decl => ts.isIdentifier(decl.name) && decl.name.text === name);
      if (declaration) {
        if (declaration.initializer) read = unwrapAwait(declaration.initializer);
        break;
      }
    }
  }
  if (!ts.isCallExpression(read) || !read.arguments[0] ||
      !bindings.isReader(read.expression) ||
      staticFilesystemPath(read.arguments[0]) !== null) return false;
  const decision = enclosingDeclaration(node);
  const pathExpression = read.arguments[0].getText(source);
  // Explicit food evidence in the consuming operation wins over an
  // administrative directory name. A generic settings/config read inside a
  // food-named module is not, by itself, a nutrition catalog load.
  const foodEvidence = /food|aliment|meal|nutrition|nutrient|ingredient|portion|porc|serving|recipe|catalog|lexic|alias|material/i;
  if (foodEvidence.test(decision + " " + pathExpression)) return true;
  if (/settings|config|status|featureflag|permission|account|admin|exercise|workout|activity/i.test(
    decision + " " + pathExpression)) return false;
  return foodEvidence.test(source.fileName);
}

function isOpaqueFoodDynamicImport(node: ts.Node, source: ts.SourceFile): boolean {
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword ||
      !node.arguments[0] || isStaticText(unwrap(node.arguments[0]))) return false;
  const decision = enclosingDeclaration(node);
  const dynamicPath = node.arguments[0].getText(source);
  // Administrative paths must not mask explicit food-domain evidence.
  return /food|aliment|meal|nutrition|nutrient|ingredient|portion|porc|serving|recipe|catalog|lexic|alias|material/i.test(
    source.fileName + " " + decision + " " + dynamicPath);
}

/** Follow named exported numeric dictionaries into a food-domain consumer. */
function findCrossModuleNumericFoodMaps(
  files: FoodArchitectureFile[], runtime: Set<string>,
  indexed: Map<string, FoodArchitectureFile>,
): { findings: FoodFinding[]; foodIndexedJson: Set<string> } {
  type ExportedMap = { symbol: string; source: string };
  const exported = new Map<string, Map<string, ExportedMap>>();
  const locals = new Map<string, Map<string, ExportedMap>>();
  for (const file of files) {
    if (!runtime.has(file.path.replace(/\\/g, "/"))) continue;
    if (/\.json$/i.test(file.path)) {
      // JSON modules export their parsed object as the default binding. Do
      // not infer a food rule from a neutral file name or numeric values alone:
      // the consumer's indexed food identity must prove domain ownership.
      let parsed: unknown;
      try {
        parsed = JSON.parse(file.content);
      } catch {
        continue; // findJsonFoodCatalog reports invalid productive JSON.
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const entries = Object.entries(parsed);
      if (!entries.length || !entries.some(([key, value]) =>
        key.trim().length > 0 && isJsonNutritionValue(value))) continue;
      exported.set(file.path, new Map([["default", {
        symbol: "default", source: JSON.stringify(parsed),
      }]]));
      continue;
    }
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    const maps = new Map<string, ExportedMap>();
    const localNumericMaps = new Map<string, ExportedMap>();
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const isExported = statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer ||
            !isLiteralNumericMap(declaration.initializer, declaration, new Set<ts.VariableDeclaration>(), source)) continue;
        const record = { symbol: declaration.name.text, source: declaration.initializer.getText(source) };
        localNumericMaps.set(declaration.name.text, record);
        if (isExported) maps.set(declaration.name.text, record);
      }
    }
    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        const value = unwrap(statement.expression);
        const record = ts.isIdentifier(value) ? localNumericMaps.get(value.text) :
          isLiteralNumericMap(value, statement, new Set<ts.VariableDeclaration>(), source)
            ? { symbol: "default", source: value.getText(source) } : undefined;
        if (record) maps.set("default", record);
      }
    }
    if (localNumericMaps.size) locals.set(file.path, localNumericMaps);
    if (maps.size) exported.set(file.path, maps);
  }
  // Preserve aliases across export { local as named }, export-from and
  // export-star barrels. A type-only re-export never loads food knowledge.
  for (let pass = 0; pass < files.length; pass++) {
    let changed = false;
    for (const file of files) {
      if (!runtime.has(file.path.replace(/\\/g, "/")) || /\.json$/i.test(file.path)) continue;
      const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
      const maps = exported.get(file.path) ?? new Map<string, ExportedMap>();
      for (const statement of source.statements) {
        if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
        const sources: Array<Map<string, ExportedMap>> = [];
        if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          for (const target of resolveRuntimeDependencies(
            file.path, statement.moduleSpecifier.text, indexed)) {
            const targetMaps = exported.get(target);
            if (targetMaps) sources.push(targetMaps);
          }
        } else {
          sources.push(locals.get(file.path) ?? new Map());
        }
        for (const available of sources) {
          if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
              if (element.isTypeOnly) continue;
              const value = available.get(element.propertyName?.text ?? element.name.text);
              if (value && !maps.has(element.name.text)) {
                maps.set(element.name.text, value);
                changed = true;
              }
            }
          } else if (!statement.exportClause && statement.moduleSpecifier) {
            for (const [name, value] of available) {
              if (name !== "default" && !maps.has(name)) {
                maps.set(name, value);
                changed = true;
              }
            }
          }
        }
      }
      if (maps.size) exported.set(file.path, maps);
    }
    if (!changed) break;
  }
  const results: FoodFinding[] = [];
  const foodIndexedJson = new Set<string>();
  for (const consumer of files) {
    if (!runtime.has(consumer.path.replace(/\\/g, "/")) || /\.json$/i.test(consumer.path)) continue;
    const source = ts.createSourceFile(consumer.path, consumer.content, ts.ScriptTarget.Latest, true);
    const filesystemBindings = filesystemReadBindings(source);
    type Reference = { file: string; declaration: ExportedMap };
    const importedBindings = new Map<string, Reference>();
    const namespaceBindings = new Map<string, Map<string, Reference>>();
    const fromSpecifier = (specifier: string, exportedName = "default"):
      { file: string; declaration: ExportedMap } | undefined => {
      for (const dependency of resolveRuntimeDependencies(consumer.path, specifier, indexed)) {
        const match = exported.get(dependency)?.get(exportedName);
        if (match) return { file: dependency, declaration: match };
      }
      return undefined;
    };
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
          !statement.importClause?.isTypeOnly) {
        const specifier = statement.moduleSpecifier.text;
        if (statement.importClause?.name) {
          const match = fromSpecifier(specifier);
          if (match) importedBindings.set(statement.importClause.name.text, match);
        }
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          const exportedMembers = new Map<string, Reference>();
          for (const dependency of resolveRuntimeDependencies(consumer.path, specifier, indexed)) {
            for (const [name, declaration] of exported.get(dependency) ?? []) {
              if (!exportedMembers.has(name)) {
                exportedMembers.set(name, { file: dependency, declaration });
              }
            }
          }
          namespaceBindings.set(bindings.name.text, exportedMembers);
        }
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            const match = fromSpecifier(specifier, element.propertyName?.text ?? element.name.text);
            if (match) importedBindings.set(element.name.text, match);
          }
        }
      } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly &&
          ts.isExternalModuleReference(statement.moduleReference) &&
          statement.moduleReference.expression &&
          ts.isStringLiteral(statement.moduleReference.expression)) {
        const match = fromSpecifier(statement.moduleReference.expression.text);
        if (match) importedBindings.set(statement.name.text, match);
      }
    }
    // Resolve each use at its lexical binding site. A local DB result or
    // parameter named like an imported JSON map must NOT inherit that import.
    // Likewise, a function-local alias cannot contaminate another function.
    const bindingNames = (name: ts.BindingName, target: string): boolean =>
      ts.isIdentifier(name) ? name.text === target :
        name.elements.some(element => ts.isBindingElement(element) &&
          bindingNames(element.name, target));
    const namespaceReference = (value: ts.Expression, use: ts.Node): Reference | undefined => {
      const expr = unwrap(value);
      if (!ts.isPropertyAccessExpression(expr) || !ts.isIdentifier(expr.expression)) return undefined;
      const namespace = expr.expression.text;
      for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
        if ((ts.isFunctionDeclaration(scope) || ts.isMethodDeclaration(scope) ||
            ts.isFunctionExpression(scope) || ts.isArrowFunction(scope)) &&
            scope.parameters.some(parameter => bindingNames(parameter.name, namespace))) return undefined;
        if (ts.isCatchClause(scope) && scope.variableDeclaration &&
            bindingNames(scope.variableDeclaration.name, namespace)) return undefined;
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          if (statement.declarationList.declarations.some(declaration =>
            bindingNames(declaration.name, namespace))) return undefined;
        }
      }
      return namespaceBindings.get(namespace)?.get(expr.name.text);
    };
    const resolveReference = (name: string, use: ts.Node,
      visited = new Set<ts.VariableDeclaration>()): Reference | undefined => {
      for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
        if ((ts.isFunctionDeclaration(scope) || ts.isMethodDeclaration(scope) ||
            ts.isFunctionExpression(scope) || ts.isArrowFunction(scope)) &&
            scope.parameters.some(parameter => bindingNames(parameter.name, name))) return undefined;
        if (ts.isCatchClause(scope) && scope.variableDeclaration &&
            bindingNames(scope.variableDeclaration.name, name)) return undefined;
        if ((ts.isForOfStatement(scope) || ts.isForInStatement(scope)) &&
            ts.isVariableDeclarationList(scope.initializer) &&
            scope.initializer.declarations.some(decl => bindingNames(decl.name, name))) return undefined;
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            if (!bindingNames(declaration.name, name)) continue;
            if (visited.has(declaration) || !declaration.initializer) return undefined;
            visited.add(declaration);
            const initializer = unwrap(declaration.initializer);
            if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) &&
                initializer.expression.text === "require" && initializer.arguments[0] &&
                ts.isStringLiteral(initializer.arguments[0])) {
              return fromSpecifier(initializer.arguments[0].text);
            }
            const parsedFile = parsedFilesystemJsonPath(initializer, filesystemBindings, declaration);
            if (parsedFile) return fromSpecifier(parsedFile);
            if (ts.isIdentifier(initializer)) return resolveReference(initializer.text, declaration, visited);
            if (ts.isPropertyAccessExpression(initializer)) return namespaceReference(initializer, declaration);
            return undefined; // a shadowing declaration from another source
          }
        }
      }
      return importedBindings.get(name);
    };
    const visit = (node: ts.Node): void => {
      let collection: ts.Expression | undefined;
      let index: ts.Expression | undefined;
      if (ts.isElementAccessExpression(node) &&
          (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression))) {
        collection = node.expression;
        index = node.argumentExpression;
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "get" &&
          (ts.isIdentifier(node.expression.expression) ||
            ts.isPropertyAccessExpression(node.expression.expression))) {
        collection = node.expression.expression;
        index = node.arguments[0];
      }
      const reference = collection ? (ts.isIdentifier(collection)
        ? resolveReference(collection.text, node) : namespaceReference(collection, node)) : undefined;
      if (reference && index && foodIndexContext(index, node, source)) {
        if (/\.json$/i.test(reference.file)) foodIndexedJson.add(reference.file.replace(/\\/g, "/"));
        const subject = reference.file + ":" + reference.declaration.source + ":" + node.getText(source);
        // A generic consumer using a typed food identifier attributes the
        // hardcoded knowledge to the source table, never its helper name.
        const genericFoodInput = /(?:^|\.|\[["'])(?:foodName|foodId|foodLabel|foodKey|alimento|alimentoId|ingredientName|productName)(?:$|\b)/i
          .test(foodIndexOrigin(index, node, source)) &&
          !/food|alimen|nutrition|meal|portion|serving|ingredient/i.test(
            consumer.path + " " + enclosingDeclaration(node));
        const originFile = indexed.get(reference.file);
        const attributed = genericFoodInput && originFile && !/.json$/i.test(reference.file);
        const originSource = attributed ? ts.createSourceFile(reference.file, originFile.content,
          ts.ScriptTarget.Latest, true) : undefined;
        const originOffset = attributed ? Math.max(0, originFile.content.indexOf(reference.declaration.source)) : 0;
        const findingFile = attributed ? reference.file : consumer.path;
        const findingLine = originSource ? originSource.getLineAndCharacterOfPosition(originOffset).line + 1 :
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        for (const rule of importedNumericMapRules()) {
          const symbol = "imported-numeric-food-map:" + reference.file + "#" + reference.declaration.symbol;
          results.push({
            ruleId: rule.id, file: findingFile,
            line: findingLine,
            symbol, fingerprint: rule.id + ":" + findingFile + ":" + symbol + ":" + stableHash(subject),
            failureClass: rule.failureClass, description: rule.description,
          });
        }
      }
      if (ts.isCallExpression(node) && isFoodNumericProjectionDecision(
        node, source, (value, use) => {
          const expr = unwrap(value);
          return ts.isIdentifier(expr) ? !!resolveReference(expr.text, use) :
            !!namespaceReference(expr, use);
        },
      )) {
        const projection = (value: ts.Expression, depth = 0): Reference | undefined => {
          if (depth > 10) return undefined;
          const expr = unwrap(value);
          if (ts.isConditionalExpression(expr)) {
            return projection(expr.whenTrue, depth + 1) || projection(expr.whenFalse, depth + 1);
          }
          if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.BarBarToken,
              ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken]
              .includes(expr.operatorToken.kind)) {
            return projection(expr.left, depth + 1) || projection(expr.right, depth + 1);
          }
          // The caller has already verified the builtin alias using lexical
          // scope. Recover the imported map behind this approved invocation.
          if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) &&
              expr.arguments.length === 1) {
            const arg = unwrap(expr.arguments[0]);
            if (ts.isIdentifier(arg)) return resolveReference(arg.text, expr);
            if (ts.isPropertyAccessExpression(arg)) return namespaceReference(arg, expr);
          }
          if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 1 &&
              ts.isSpreadElement(expr.elements[0])) {
            return projection(expr.elements[0].expression, depth + 1);
          }
          if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) &&
              expr.expression.text === "Set" && unshadowedIntrinsic("Set", expr) &&
              expr.arguments?.length === 1) return projection(expr.arguments[0], depth + 1);
          if (ts.isCallExpression(expr) && ts.isElementAccessExpression(expr.expression) &&
              expr.expression.argumentExpression &&
              isStaticText(unwrap(expr.expression.argumentExpression)) &&
              ["keys", "entries", "ownKeys", "getOwnPropertyNames"].includes(
                (unwrap(expr.expression.argumentExpression) as ts.StringLiteral).text) &&
              expr.arguments.length === 1) {
            const arg = unwrap(expr.arguments[0]);
            return ts.isIdentifier(arg) ? resolveReference(arg.text, expr) :
              ts.isPropertyAccessExpression(arg) ? namespaceReference(arg, expr) : undefined;
          }
          if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
            if (expr.expression.name.text === "from" &&
                ts.isIdentifier(expr.expression.expression) &&
                expr.expression.expression.text === "Array" && expr.arguments[0]) {
              return projection(expr.arguments[0], depth + 1);
            }
            if (["keys", "entries", "ownKeys", "getOwnPropertyNames"].includes(
                expr.expression.name.text) && expr.arguments[0]) {
              const item = unwrap(expr.arguments[0]);
              return ts.isIdentifier(item) ? resolveReference(item.text, expr) :
                namespaceReference(item, expr);
            }
            if (expr.expression.name.text === "split" && expr.arguments.length === 1 &&
                ts.isCallExpression(unwrap(expr.expression.expression))) {
              const joined = unwrap(expr.expression.expression) as ts.CallExpression;
              if (ts.isPropertyAccessExpression(joined.expression) &&
                  joined.expression.name.text === "join" && joined.arguments.length <= 1) {
                const separator = immutableDecisionString(expr.arguments[0], expr, source);
                const joinedSeparator = joined.arguments.length
                  ? immutableDecisionString(joined.arguments[0], joined, source) : ",";
                if (separator !== null && separator === joinedSeparator)
                  return projection(joined.expression.expression, depth + 1);
              }
            }
            if (["slice", "filter", "map", "sort", "reverse", "toSorted", "toReversed"].includes(expr.expression.name.text))
              return projection(expr.expression.expression, depth + 1);
          }
          if (ts.isIdentifier(expr)) {
            for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
              if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
              for (const stmt of scope.statements) {
                if (!ts.isVariableStatement(stmt) || !(stmt.declarationList.flags & ts.NodeFlags.Const)) continue;
                for (const decl of stmt.declarationList.declarations) {
                  if (ts.isIdentifier(decl.name) && decl.name.text === expr.text &&
                      decl.initializer && decl.getStart(source) < node.getStart(source))
                    return projection(decl.initializer, depth + 1);
                }
              }
            }
          }
          return undefined;
        };
        const sourceProjection = ts.isVariableDeclaration(node.parent) &&
          ts.isArrayBindingPattern(node.parent.name) ? node : node.expression.expression;
        const reference = projection(sourceProjection);
        if (reference) {
          const subject = reference.file + ":" + reference.declaration.source + ":" + node.getText(source);
          for (const rule of importedNumericMapRules()) {
            const symbol = "imported-numeric-food-map:" + reference.file + "#" + reference.declaration.symbol;
            results.push({
              ruleId: rule.id, file: consumer.path,
              line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
              symbol, fingerprint: rule.id + ":" + consumer.path + ":" + symbol + ":" + stableHash(subject),
              failureClass: rule.failureClass, description: rule.description,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { findings: results, foodIndexedJson };
}


/**
 * Only structural TypeScript checks and known domain *state* enums are exempt
 * from the food-lexicon/materiality gate. The exception is value-and-field
 * specific: status === "integral", portion.label === "fatia", and all other
 * food/attribute terms remain detectable. Do not expand to arbitrary strings.
 */
function isStructuralContractComparison(identity: ts.Expression, literal: string): boolean {
  const operand = unwrap(identity);
  if (ts.isTypeOfExpression(operand)) {
    return ["undefined", "object", "boolean", "number", "string", "function", "symbol", "bigint"].includes(literal);
  }
  // Bare `mode` is the reconciliation CLI control, never a food attribute.
  if (ts.isIdentifier(operand) && operand.text === "mode") {
    return literal === "preview" || literal === "stage";
  }
  if (!ts.isPropertyAccessExpression(operand)) return false;
  const enumStates: Record<string, readonly string[]> = {
    status: ["active", "deprecated", "merged", "draft", "provisional", "pending_review",
      "verified", "rejected", "revoked", "pending", "approved", "open", "in_review", "closed"],
    governanceStatus: ["provisional", "pending_review", "verified", "rejected", "revoked"],
    // Governed evidence provenance types are schema states, not food descriptors.
    // A different value (e.g. a real attribute token) is still evaluated by gate 18.
    evidenceType: ["manufacturer", "nutrition_label"],
    // Source-table discriminant is structural migration metadata, not food materiality.
    table: ["foods", "foodCatalog"],
    scope: ["global", "user"],
    mode: ["preview", "stage"],
    action: ["mapped", "merged", "quarantined"],
    basisUnit: ["g", "ml", "serving"],
  };
  return enumStates[operand.name.text]?.includes(literal) ?? false;
}

export function findFoodStaticCandidates(files: FoodArchitectureFile[]): FoodFinding[] {
  const results: FoodFinding[] = [];
  // Preserve multiplicity: adding an identical rule in another scope is still new.
  // A fixture or generated TS module imported by production must not escape
  // the gate solely because it lives under a normally excluded folder.
  const indexed = new Map(files.map(file => [file.path.replace(/\\/g, "/"), file]));
  const runtime = new Set(files.filter(file => isProductionFoodSource(file.path))
    .map(file => file.path.replace(/\\/g, "/")));
  const importerContext = new Map<string, Set<string>>();
  const dependencyGraph = new Map<string, Set<string>>();
  const queue = [...runtime];
  for (let i = 0; i < queue.length; i++) {
    const file = indexed.get(queue[i]);
    if (!file) continue;
    if (/\.json$/i.test(file.path)) continue;
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    const filesystemBindings = filesystemReadBindings(source);
    const addDependency = (specifier: string, importSource = "", publicUrl = false): void => {
      for (const candidate of (publicUrl
        ? resolveVitePublicAsset(file.path, specifier, indexed)
        : resolveRuntimeDependencies(file.path, specifier, indexed))) {
        const direct = dependencyGraph.get(file.path) ?? new Set<string>();
        direct.add(candidate);
        dependencyGraph.set(file.path, direct);
        const contexts = importerContext.get(candidate) ?? new Set<string>();
        contexts.add(file.path + " " + importSource + " " +
          [...(importerContext.get(file.path) ?? [])].join(" "));
        importerContext.set(candidate, contexts);
        if (!runtime.has(candidate)) {
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
        if (!namedTypesOnly) addDependency(node.moduleSpecifier.text, node.getText(source));
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
        const clause = node.exportClause;
        const typesOnly = clause && ts.isNamedExports(clause) &&
          clause.elements.length > 0 && clause.elements.every(e => e.isTypeOnly);
        if (!typesOnly) addDependency(node.moduleSpecifier.text, node.getText(source));
      }
      if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly &&
          ts.isExternalModuleReference(node.moduleReference) &&
          node.moduleReference.expression &&
          ts.isStringLiteral(node.moduleReference.expression)) {
        addDependency(node.moduleReference.expression.text, node.getText(source));
      }
      if (ts.isCallExpression(node) && node.arguments.length > 0 &&
          ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (isNodeRequireCall(node)))) {
        addDependency(node.arguments[0].text, node.getText(source));
      }
      if (ts.isCallExpression(node) && node.arguments[0]) {
        const publicUrl = node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          isStaticText(unwrap(node.arguments[0]))
          ? (unwrap(node.arguments[0]) as ts.StringLiteral).text
          : staticViteFetchUrl(node);
        if (publicUrl !== null) addDependency(publicUrl, node.getText(source), true);
      }
      if (ts.isCallExpression(node) &&
          filesystemBindings.isReader(node.expression) &&
          node.arguments[0]) {
        const staticPath = staticFilesystemPath(node.arguments[0]);
        if (staticPath) addDependency(staticPath, node.getText(source));
      }
      ts.forEachChild(node, follow);
    };
    ts.forEachChild(source, follow);
  }
  // Generic JSON records are food knowledge only when productive code consumes
  // their identity in a food decision. Unused imports and exercise lookups stay exempt.
  const jsonRecordsConsumedByFood = new Set<string>();
  for (const consumer of files) {
    if (!runtime.has(consumer.path.replace(/\\/g, "/")) || /\.json$/i.test(consumer.path)) continue;
    const source = ts.createSourceFile(consumer.path, consumer.content, ts.ScriptTarget.Latest, true);
    const filesystemBindings = filesystemReadBindings(source);
    const imports = new Map<string, string[]>();
    const registerJsonImport = (specifier: string, binding: string): void => {
      const targets = resolveRuntimeDependencies(consumer.path, specifier, indexed)
        .filter(target => /\.json$/i.test(target));
      if (targets.length) imports.set(binding, targets);
    };
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
          !statement.importClause?.isTypeOnly && statement.importClause?.name) {
        registerJsonImport(statement.moduleSpecifier.text, statement.importClause.name.text);
      } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly &&
          ts.isExternalModuleReference(statement.moduleReference) &&
          statement.moduleReference.expression &&
          ts.isStringLiteral(statement.moduleReference.expression)) {
        registerJsonImport(statement.moduleReference.expression.text, statement.name.text);
      } else if (ts.isVariableStatement(statement)) {
        // F22: every declarator can import a JSON catalog, not just declarations[0].
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer &&
              ts.isCallExpression(declaration.initializer) &&
              isNodeRequireCall(declaration.initializer) &&
              declaration.initializer.arguments[0] &&
              ts.isStringLiteral(declaration.initializer.arguments[0])) {
            registerJsonImport(declaration.initializer.arguments[0].text, declaration.name.text);
          }
        }
      }
    }
    // AUD1300-20261015-F10: JSON.parse of a proven, static Node fs path is
    // equivalent to an import, including a raw readFile binding and a load in
    // a local function. Do not activate tracking for unrelated parse calls.
    let hasStaticJsonLoader = false;
    const scanStaticJsonLoader = (node: ts.Node): void => {
      if (hasStaticJsonLoader) return;
      if (ts.isCallExpression(node)) {
        if (isNodeRequireCall(node) && node.arguments.length === 1 &&
            ts.isStringLiteral(node.arguments[0]) &&
            resolveRuntimeDependencies(consumer.path, node.arguments[0].text, indexed)
              .some(target => /\.json$/i.test(target))) {
          hasStaticJsonLoader = true;
          return;
        }
        const fetchUrl = staticViteFetchUrl(node);
        if (fetchUrl !== null && resolveVitePublicAsset(consumer.path, fetchUrl, indexed)
          .some(target => /\.json$/i.test(target))) {
          hasStaticJsonLoader = true;
          return;
        }
        const file = parsedFilesystemJsonPath(node, filesystemBindings, node);
        if (file && resolveRuntimeDependencies(consumer.path, file, indexed)
          .some(target => /\.json$/i.test(target))) {
          hasStaticJsonLoader = true;
          return;
        }
      }
      ts.forEachChild(node, scanStaticJsonLoader);
    };
    if (imports.size === 0) {
      ts.forEachChild(source, scanStaticJsonLoader);
      if (!hasStaticJsonLoader) continue;
    }
    /** Prove that a member/destructuring path reaches actual JSON records.
     * A name match alone never makes an inert sibling property productive. */
    const jsonRecordPathExists = (filePath: string, keys: string[]): boolean => {
      if (!keys.length) return true;
      const file = indexed.get(filePath);
      if (!file) return false;
      let data: unknown;
      try { data = JSON.parse(file.content); } catch { return false; }
      for (const key of keys) {
        if (!data || typeof data !== "object" || !(key in data)) return false;
        data = (data as Record<string, unknown>)[key];
      }
      // Identity vocabularies may be plain JSON arrays rather than nutrition rows.
      if (Array.isArray(data) && data.length > 0 && data.every(row =>
          typeof row === "string" && row.trim().length > 0)) return true;
      return Array.isArray(data) && data.some(row => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return false;
        const keys = Object.keys(row);
        // Generic JSON name-only rows (logs, status, accounts) must not be
        // treated as food records merely because a food module reads them.
        return keys.some(key => /^(?:foodName|foodId|food_id|food_name|productName|alimento|ingredient)$/i.test(key)) ||
          keys.some(key => /^(?:calories|kcal|protein|carbs|fat|nutrition|nutrients|macros|portionGrams|gramsPerServing|processingLevel)$/i.test(key));
      });
    };
    const jsonStaticAccess = (expr: ts.Expression): { root: ts.Expression; keys: string[] } | undefined => {
      let root = unwrap(expr);
      const keys: string[] = [];
      while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) {
        const key = ts.isPropertyAccessExpression(root) ? root.name.text :
          root.argumentExpression && isStaticText(unwrap(root.argumentExpression))
            ? (unwrap(root.argumentExpression) as ts.StringLiteral).text : undefined;
        if (key === undefined) return undefined;
        keys.unshift(key);
        root = unwrap(root.expression);
      }
      return { root, keys };
    };
    const jsonBindingPath = (name: ts.BindingName, sought: string): string[] | undefined => {
      if (ts.isIdentifier(name)) return name.text === sought ? [] : undefined;
      if (!ts.isObjectBindingPattern(name)) return undefined;
      for (const element of name.elements) {
        if (element.dotDotDotToken) continue;
        const keyNode = element.propertyName ?? element.name;
        const key = ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode) ||
          ts.isNoSubstitutionTemplateLiteral(keyNode) ? keyNode.text : undefined;
        if (key === undefined) continue;
        const nested = jsonBindingPath(element.name, sought);
        if (nested) return [key, ...nested];
      }
      return undefined;
    };
    // Preserve provenance for the identity field actually used by the consumer.
    // An unrelated label override must not hide an original name decision.
    const consumedRecordIdentityFields = (use: ts.Node): Set<string> => {
      const fields = new Set<string>();
      const argument = ts.isCallExpression(use) && ts.isPropertyAccessExpression(use.expression)
        ? use.arguments[0] : undefined;
      // F18: decisions may use a named function or an immutable callback alias.
      // Resolve at the call site, honoring parameters, shadowing and const aliases.
      const callback = argument ? resolveJsonCallback(argument, use) : undefined;
      if (!callback?.body) return fields;
      const binding = callback.parameters[0]?.name;
      if (!binding) return fields;
      const row = ts.isIdentifier(binding) ? binding.text : undefined;
      const identity = /^(?:name|title|label|slug|nome|foodName|foodId|alimento|productName)$/;
      // F21: destructured predicates still read source identity fields.
      const destructured = new Map<string, string>();
      if (ts.isObjectBindingPattern(binding)) {
        for (const element of binding.elements) {
          if (!ts.isIdentifier(element.name) || element.dotDotDotToken) continue;
          const key = element.propertyName ?? element.name;
          if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) &&
              identity.test(key.text)) destructured.set(element.name.text, key.text);
        }
      }
      if (!row && destructured.size === 0) return fields;
      const collectFields = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && destructured.has(node.text)) {
          fields.add(destructured.get(node.text)!);
        }
        if (row && ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression) && node.expression.text === row &&
            identity.test(node.name.text)) fields.add(node.name.text);
        if (row && ts.isElementAccessExpression(node) &&
            ts.isIdentifier(node.expression) && node.expression.text === row &&
            node.argumentExpression) {
          const key = unwrap(node.argumentExpression);
          if ((ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
              identity.test(key.text)) fields.add(key.text);
        }
        ts.forEachChild(node, collectFields);
      };
      const visitDecision = (node: ts.Node): void => {
        if (ts.isBinaryExpression(node) &&
            [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
              ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]
              .includes(node.operatorToken.kind)) {
          collectFields(node.left);
          collectFields(node.right);
        } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
            /^(?:includes|startsWith|endsWith)$/.test(node.expression.name.text)) {
          collectFields(node);
        } else if (ts.isSwitchStatement(node)) {
          collectFields(node.expression);
        } else {
          ts.forEachChild(node, visitDecision);
        }
      };
      visitDecision(callback.body);
      return fields;
    };
    // Track catalog provenance through row-preserving pipelines only.
    const preservesJsonIdentity = (
      callback: ts.Expression | undefined, flatten: boolean, consumerUse: ts.Node,
    ): boolean => {
      if (!callback) return false;
      // F20: resolve named projections and immutable aliases at their consumer.
      const fn = resolveJsonCallback(callback, consumerUse);
      if (!fn?.body) return false;
      const parameter = fn.parameters[0]?.name;
      if (!parameter || !ts.isIdentifier(parameter)) return false;
      const name = parameter.text;
      const statements = ts.isBlock(fn.body) ? fn.body.statements : [];
      const returns = statements.filter(ts.isReturnStatement);
      const body = ts.isBlock(fn.body)
        ? returns.length === 1 ? returns[0].expression : undefined : fn.body;
      if (!body) return false;
      // F11: immutable callback-local aliases retain a record's food identity.
      // Never infer provenance from an unrelated value, mutable alias, or an
      // alias declared after its use.
      const aliases = new Map<string, ts.VariableDeclaration>();
      for (const statement of statements) {
        if (!ts.isVariableStatement(statement) ||
            !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            aliases.set(declaration.name.text, declaration);
          }
        }
      }
      const identity = /^(?:name|title|label|slug|nome|foodName|foodId|alimento|productName)$/;
      const carriesRecordIdentity = (candidate: ts.Expression, seen = new Set<string>(),
        depth = 0): boolean => {
        if (depth > 8) return false;
        const value = unwrap(candidate);
        if (ts.isIdentifier(value)) {
          if (seen.has(value.text)) return false;
          const alias = aliases.get(value.text);
          if (!alias?.initializer || alias.getStart(source) >= value.getStart(source)) return false;
          const next = new Set(seen);
          next.add(value.text);
          return carriesRecordIdentity(alias.initializer, next, depth + 1);
        }
        if (ts.isPropertyAccessExpression(value)) {
          return ts.isIdentifier(value.expression) && value.expression.text === name &&
            identity.test(value.name.text);
        }
        if (ts.isElementAccessExpression(value) && value.argumentExpression &&
            isStaticText(unwrap(value.argumentExpression))) {
          return ts.isIdentifier(value.expression) && value.expression.text === name &&
            identity.test((unwrap(value.argumentExpression) as ts.StringLiteral).text);
        }
        if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
            /^(?:trim|trimStart|trimEnd|toLowerCase|toUpperCase|normalize)$/.test(value.expression.name.text) &&
            value.arguments.length <= (value.expression.name.text === "normalize" ? 1 : 0) &&
            value.arguments.every(arg => isStaticText(unwrap(arg)))) {
          return carriesRecordIdentity(value.expression.expression, seen, depth + 1);
        }
        return false;
      };
      const preserves = (candidate: ts.Expression): boolean => {
        const expr = unwrap(candidate);
        if (ts.isIdentifier(expr)) return expr.text === name;
        if (!ts.isObjectLiteralExpression(expr)) return false;
        // F14: evaluate object members in runtime order, not with .some().
        // { ...row, name: other } no longer carries the row's name, while
        // { name: other, ...row } and { ...row, name: row.name } still do.
        // A later opaque spread may also replace the identity: do not infer
        // provenance through it without another explicit identity assignment.
        let carriesSpread = false;
        const overrides = new Map<string, boolean>();
        for (const property of expr.properties) {
          if (ts.isSpreadAssignment(property)) {
            const spread = unwrap(property.expression);
            if (ts.isIdentifier(spread) && spread.text === name) {
              carriesSpread = true;
              overrides.clear();
            } else {
              carriesSpread = false;
              overrides.clear();
            }
            continue;
          }
          const keyNode = property.name;
          if (!keyNode) continue;
          // A computed identifier is not its property name. Resolve immutable
          // lexical constants (also chained aliases), respecting shadowing.
          const staticKey = (expr: ts.Expression, seen = new Set<string>(),
            depth = 0): string | undefined => {
            if (depth > 8) return undefined;
            const value = unwrap(expr);
            if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
              return value.text;
            }
            if (!ts.isIdentifier(value) || seen.has(value.text)) return undefined;
            const next = new Set(seen);
            next.add(value.text);
            for (let scope: ts.Node | undefined = keyNode; scope; scope = scope.parent) {
              if (ts.isFunctionLike(scope) && scope.parameters.some(p =>
                  ts.isIdentifier(p.name) && p.name.text === value.text)) return undefined;
              if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
              for (const statement of scope.statements) {
                if (!ts.isVariableStatement(statement)) continue;
                for (const decl of statement.declarationList.declarations) {
                  if (!ts.isIdentifier(decl.name) || decl.name.text !== value.text) continue;
                  if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
                      !decl.initializer || decl.getStart(source) >= keyNode.getStart(source)) {
                    return undefined;
                  }
                  return staticKey(decl.initializer, next, depth + 1);
                }
              }
            }
            return undefined;
          };
          const key = ts.isComputedPropertyName(keyNode)
            ? staticKey(keyNode.expression)
            : ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode) ||
              ts.isNoSubstitutionTemplateLiteral(keyNode) ? keyNode.text : undefined;
          if (key === undefined && ts.isComputedPropertyName(keyNode)) {
            // An unknown key can replace the consumed identity at runtime.
            carriesSpread = false;
            overrides.clear();
            continue;
          }
          if (!key || !identity.test(key)) continue;
          // Accessors/methods also replace the preceding spread's identity.
          const value = ts.isPropertyAssignment(property)
            ? property.initializer : ts.isShorthandPropertyAssignment(property)
              ? property.name : undefined;
          overrides.set(key, !!value && carriesRecordIdentity(value));
        }
        const consumed = consumedRecordIdentityFields(consumerUse);
        if (consumed.size > 0) {
          // F19: a decision is catalog-driven if *any* identity field it
          // actually reads still has catalog provenance. Other identity fields
          // may have been overwritten without erasing that surviving source.
          return [...consumed].some(key => overrides.has(key)
            ? overrides.get(key) === true : carriesSpread);
        }
        if ([...overrides.values()].some(Boolean)) return true;
        return carriesSpread && ![...overrides.values()].some(value => !value);
      };
      const value = unwrap(body);
      return flatten
        ? ts.isArrayLiteralExpression(value) && value.elements.length > 0 &&
          value.elements.every(element => preserves(element))
        : preserves(value);
    };
    // A projection can preserve the identity field without preserving its row:
    // rows.map(row => row.name).includes(input) is still catalog-driven.
    const callbackProjectsJsonIdentity = (
      callback: ts.Expression | undefined, flatten: boolean, fromRecords: boolean,
      consumerUse: ts.Node,
    ): boolean => {
      if (!callback) return false;
      const fn = resolveJsonCallback(callback, consumerUse);
      if (!fn?.body) return false;
      const parameter = fn.parameters[0]?.name;
      if (!parameter) return false;
      const name = ts.isIdentifier(parameter) ? parameter.text : "";
      const identity = /^(?:name|label|slug|nome|foodName|foodId|alimento|productName)$/;
      // AUD1300-20261015-F07: a record projection may destructure the
      // identity field and rename it before applying a transparent normalizer.
      // Only bindings of known identity properties carry JSON provenance.
      const identityBindings = new Set<string>();
      if (ts.isObjectBindingPattern(parameter)) {
        for (const binding of parameter.elements) {
          if (!ts.isIdentifier(binding.name)) continue;
          const property = binding.propertyName ?? binding.name;
          const identityProperty = ts.isIdentifier(property) || ts.isStringLiteral(property)
            ? property.text
            : ts.isComputedPropertyName(property) && ts.isStringLiteral(property.expression)
              ? property.expression.text : "";
          if (identity.test(identityProperty)) identityBindings.add(binding.name.text);
        }
      }
      if (!name && identityBindings.size === 0) return false;
      const body = ts.isBlock(fn.body) ? fn.body.statements : undefined;
      const returns = body?.filter(ts.isReturnStatement) ?? [];
      const result = body ? (returns.length === 1 ? returns[0].expression : undefined) : fn.body;
      if (!result) return false;
      // AUD1300-20261015-F09: callback-local immutable aliases of a JSON
      // identity must retain provenance. Only top-level const bindings declared
      // before their use qualify; calls and mutable/shadowed names are opaque.
      const aliases = new Map<string, ts.VariableDeclaration>();
      for (const statement of body ?? []) {
        if (!ts.isVariableStatement(statement) ||
            !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            aliases.set(declaration.name.text, declaration);
          }
        }
      }
      const carriesIdentity = (candidate: ts.Expression, depth = 0): boolean => {
        if (depth > 8) return false;
        const value = unwrap(candidate);
        if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
          const left = unwrap(value.left);
          const right = unwrap(value.right);
          if (ts.isStringLiteral(left) && left.text === "") return carriesIdentity(value.right, depth + 1);
          if (ts.isStringLiteral(right) && right.text === "") return carriesIdentity(value.left, depth + 1);
        }
        if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) &&
            value.expression.text === "String" && unshadowedIntrinsic("String", value) &&
            value.arguments.length === 1) return carriesIdentity(value.arguments[0], depth + 1);
        if (ts.isIdentifier(value)) {
          if (fromRecords ? identityBindings.has(value.text) : value.text === name) return true;
          const alias = aliases.get(value.text);
          return !!alias?.initializer && alias.getStart(source) < value.getStart(source) &&
            carriesIdentity(alias.initializer, depth + 1);
        }
        if (!fromRecords) return ts.isCallExpression(value) &&
          ts.isPropertyAccessExpression(value.expression) &&
          /^(?:trim|trimStart|trimEnd|toLowerCase|toUpperCase|normalize)$/.test(value.expression.name.text) &&
          value.arguments.length <= (value.expression.name.text === "normalize" ? 1 : 0) &&
          value.arguments.every(arg => isStaticText(unwrap(arg))) &&
          carriesIdentity(value.expression.expression, depth + 1);
        if (ts.isPropertyAccessExpression(value)) return ts.isIdentifier(value.expression) &&
          value.expression.text === name && identity.test(value.name.text);
        if (ts.isElementAccessExpression(value)) return ts.isIdentifier(value.expression) &&
          value.expression.text === name && value.argumentExpression &&
          isStaticText(unwrap(value.argumentExpression)) &&
          identity.test(value.argumentExpression.getText(source).replace(/^['"]|['"]$/g, ""));
        if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
            /^(?:trim|trimStart|trimEnd|toLowerCase|toUpperCase|normalize)$/.test(value.expression.name.text) &&
            value.arguments.length <= (value.expression.name.text === "normalize" ? 1 : 0) &&
            value.arguments.every(arg => isStaticText(unwrap(arg)))) {
          return carriesIdentity(value.expression.expression, depth + 1);
        }
        return false;
      };
      const value = unwrap(result);
      return flatten
        ? ts.isArrayLiteralExpression(value) && value.elements.length > 0 &&
          value.elements.every(entry => carriesIdentity(entry))
        : carriesIdentity(value);
    };
    type JsonTraceKind = "records" | "identity";
    // Only single-return local helpers are transparent. Parameter bindings are
    // tied to their exact declaration and original call-site, not textual names.
    // This prevents shadowed or independently sourced data from inheriting JSON.
    const jsonCallFrames: Array<Map<ts.ParameterDeclaration, { value: ts.Expression; use: ts.Node }>> = [];
    const jsonReturn = (fn: ts.FunctionLikeDeclaration): ts.Expression | undefined => {
      if (!fn.body) return undefined;
      if (!ts.isBlock(fn.body)) return fn.body;
      const returns = fn.body.statements.filter(ts.isReturnStatement);
      return returns.length === 1 ? returns[0].expression : undefined;
    };
    const jsonCallable = (expression: ts.Expression, site: ts.Node,
      depth = 0): ts.FunctionLikeDeclaration | undefined => {
      if (depth > 10) return undefined;
      const value = unwrap(expression);
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
      if (ts.isCallExpression(value)) {
        const outer = jsonCallable(value.expression, site, depth + 1);
        const result = outer && jsonReturn(outer);
        return result && (ts.isArrowFunction(unwrap(result)) ||
          ts.isFunctionExpression(unwrap(result)))
          ? unwrap(result) as ts.FunctionLikeDeclaration : undefined;
      }
      if (!ts.isIdentifier(value)) return undefined;
      for (let scope: ts.Node | undefined = site; scope; scope = scope.parent) {
        if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
            ts.isIdentifier(param.name) && param.name.text === value.text)) return undefined;
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (ts.isFunctionDeclaration(statement) && statement.name?.text === value.text) return statement;
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== value.text) continue;
            return statement.declarationList.flags & ts.NodeFlags.Const &&
              declaration.initializer && declaration.getStart(source) < site.getStart(source)
              ? jsonCallable(declaration.initializer, declaration, depth + 1) : undefined;
          }
        }
      }
      return undefined;
    };
    const jsonLocalProperty = (expression: ts.Expression, keys: string[], site: ts.Node,
      depth = 0): { expression: ts.Expression; use: ts.Node } | undefined => {
      if (!keys.length || depth > 10) return undefined;
      const value = unwrap(expression);
      if (ts.isIdentifier(value)) {
        for (let scope: ts.Node | undefined = site; scope; scope = scope.parent) {
          if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
              ts.isIdentifier(param.name) && param.name.text === value.text)) return undefined;
          if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
          for (const statement of scope.statements) {
            if (!ts.isVariableStatement(statement)) continue;
            for (const declaration of statement.declarationList.declarations) {
              if (!ts.isIdentifier(declaration.name) || declaration.name.text !== value.text) continue;
              if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
                  !declaration.initializer || declaration.getStart(source) >= site.getStart(source))
                return undefined;
              // A const object can still have its fields reassigned. A definite
              // top-level write before the decision replaces the old source;
              // conditional writes leave the imported source possible.
              let assignment: { expression: ts.Expression; use: ts.Node } | undefined;
              for (const operation of scope.statements) {
                if (operation.getStart(source) <= declaration.getStart(source) ||
                    operation.getStart(source) >= site.getStart(source) ||
                    !ts.isExpressionStatement(operation) ||
                    !ts.isBinaryExpression(operation.expression) ||
                    operation.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
                const access = jsonStaticAccess(operation.expression.left);
                if (access && ts.isIdentifier(access.root) && access.root.text === value.text &&
                    access.keys.join(".") === keys.join(".")) {
                  assignment = { expression: operation.expression.right, use: operation };
                }
              }
              return assignment ?? jsonLocalProperty(declaration.initializer, keys,
                declaration, depth + 1);
            }
          }
        }
      }
      if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
          ts.isIdentifier(value.expression.expression) && value.expression.expression.text === "Object" &&
          value.expression.name.text === "assign" && unshadowedIntrinsic("Object", value) &&
          value.arguments.length >= 2 && value.arguments.every(argument =>
            ts.isObjectLiteralExpression(unwrap(argument)))) {
        for (const argument of [...value.arguments].reverse()) {
          const member = jsonLocalProperty(argument, keys, site, depth + 1);
          if (member) return member;
        }
        return undefined;
      }
      if (!ts.isObjectLiteralExpression(value)) return undefined;
      const key = keys[0];
      const property = value.properties.find(prop => ts.isPropertyAssignment(prop) &&
        (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ||
          ts.isNumericLiteral(prop.name)) && prop.name.text === key);
      if (!property || !ts.isPropertyAssignment(property)) return undefined;
      if (keys.length === 1) return { expression: property.initializer, use: property };
      return jsonLocalProperty(property.initializer, keys.slice(1), property, depth + 1);
    };
    const resolveJsonExpression = (
      expression: ts.Expression, use: ts.Node, visited = new Set<ts.VariableDeclaration>(),
      depth = 0, kind: JsonTraceKind = "records", decisionUse: ts.Node = use,
    ): string[] => {
      if (depth > 12) return [];
      const value = unwrap(expression);
      if (ts.isAwaitExpression(value)) return resolveJsonExpression(
        value.expression, use, visited, depth + 1, kind, decisionUse);
      if (ts.isIdentifier(value)) return resolveJsonBinding(value.text, use, visited, depth + 1, kind, decisionUse);
      // fetch('/catalog.json').then(response => response.json()) is the same
      // local source as await fetch('/catalog.json'); response.json().
      if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
          value.expression.name.text === "then" && value.arguments.length >= 1) {
        const origin = unwrap(value.expression.expression);
        const callback = unwrap(value.arguments[0]);
        if (ts.isCallExpression(origin) && isNativeViteFetch(origin) &&
            (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
            callback.parameters.length === 1 && ts.isIdentifier(callback.parameters[0].name)) {
          const output = ts.isBlock(callback.body) && callback.body.statements.length === 1 &&
            ts.isReturnStatement(callback.body.statements[0])
            ? callback.body.statements[0].expression :
            ts.isBlock(callback.body) ? undefined : callback.body;
          const call = output && unwrap(output);
          if (call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
              call.expression.name.text === "json" && call.arguments.length === 0 &&
              ts.isIdentifier(call.expression.expression) &&
              call.expression.expression.text === callback.parameters[0].name.text) {
            const targets = resolveVitePublicAsset(consumer.path,
              staticViteFetchUrl(origin)!, indexed)
              .filter(target => /\.json$/i.test(target));
            if (targets.length) return targets;
          }
        }
      }
      // Browser response.json() preserves the identity of a Vite public JSON
      // asset when its response is proven to originate from a static fetch.
      // Only immutable lexical response bindings may carry that provenance.
      if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
          value.expression.name.text === "json" && value.arguments.length === 0) {
        const response = unwrap(value.expression.expression);
        const fetchOrigin = (candidate: ts.Expression, location: ts.Node,
          seen = new Set<ts.VariableDeclaration>(), steps = 0): string[] => {
          if (steps > 8) return [];
          const origin = unwrap(candidate);
          if (ts.isAwaitExpression(origin)) return fetchOrigin(origin.expression, location, seen, steps + 1);
          if (ts.isCallExpression(origin) && isNativeViteFetch(origin)) {
            return resolveVitePublicAsset(consumer.path,
              staticViteFetchUrl(origin)!, indexed)
              .filter(target => /\.json$/i.test(target));
          }
          if (!ts.isIdentifier(origin)) return [];
          for (let scope: ts.Node | undefined = location; scope; scope = scope.parent) {
            if (ts.isFunctionLike(scope) && scope.parameters.some(parameter =>
              ts.isIdentifier(parameter.name) && parameter.name.text === origin.text)) return [];
            if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
            for (const statement of scope.statements) {
              if (!ts.isVariableStatement(statement)) continue;
              for (const declaration of statement.declarationList.declarations) {
                if (!ts.isIdentifier(declaration.name) || declaration.name.text !== origin.text) continue;
                if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
                    !declaration.initializer || seen.has(declaration) ||
                    declaration.getStart(source) >= location.getStart(source)) return [];
                seen.add(declaration);
                return fetchOrigin(declaration.initializer, declaration, seen, steps + 1);
              }
            }
          }
          return [];
        };
        const targets = fetchOrigin(response, value);
        if (targets.length) return targets;
      }
      if (ts.isCallExpression(value)) {
        const fn = jsonCallable(value.expression, use);
        const returned = fn && jsonReturn(fn);
        if (fn && returned && fn.parameters.length === value.arguments.length) {
          const frame = new Map<ts.ParameterDeclaration, { value: ts.Expression; use: ts.Node }>();
          fn.parameters.forEach((parameter, index) =>
            frame.set(parameter, { value: value.arguments[index], use }));
          jsonCallFrames.push(frame);
          try {
            return resolveJsonExpression(returned, returned, new Set(visited), depth + 1, kind, decisionUse);
          } finally { jsonCallFrames.pop(); }
        }
      }
      // AUD1300-20261015-F08: a catalog is governed whenever any reachable
      // expression branch can supply its records or projected identity.
      // A conditional is a possible-origin union, not a definite overwrite.
      if (ts.isConditionalExpression(value)) {
        return [...new Set([
          ...resolveJsonExpression(value.whenTrue, value.whenTrue, new Set(visited), depth + 1, kind, decisionUse),
          ...resolveJsonExpression(value.whenFalse, value.whenFalse, new Set(visited), depth + 1, kind, decisionUse),
        ])];
      }
      if (ts.isBinaryExpression(value) &&
          [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.QuestionQuestionToken].includes(value.operatorToken.kind)) {
        return [...new Set([
          ...resolveJsonExpression(value.left, value.left, new Set(visited), depth + 1, kind, decisionUse),
          ...resolveJsonExpression(value.right, value.right, new Set(visited), depth + 1, kind, decisionUse),
        ])];
      }
      // Set copies the same records or identity values without changing their provenance.
      if (ts.isNewExpression(value) && ts.isIdentifier(value.expression) &&
          value.expression.text === "Set" && unshadowedIntrinsic("Set", value) &&
          value.arguments?.length === 1) {
        return resolveJsonExpression(value.arguments[0], value, visited, depth + 1, kind, decisionUse);
      }
      // Map keyed by a projected food identity carries that key to .has().
      if (kind === "identity" && ts.isNewExpression(value) &&
          ts.isIdentifier(value.expression) && value.expression.text === "Map" &&
          unshadowedIntrinsic("Map", value) && value.arguments?.length === 1) {
        const entries = unwrap(value.arguments[0]);
        if (ts.isCallExpression(entries) && ts.isPropertyAccessExpression(entries.expression) &&
            entries.expression.name.text === "map" && entries.arguments.length === 1) {
          const fn = resolveJsonCallback(entries.arguments[0], entries);
          const result = fn && jsonReturn(fn);
          const row = fn?.parameters[0]?.name;
          const pair = result && unwrap(result);
          if (row && ts.isIdentifier(row) && pair && ts.isArrayLiteralExpression(pair) &&
              pair.elements.length === 2 && ts.isPropertyAccessExpression(unwrap(pair.elements[0])) &&
              ts.isIdentifier((unwrap(pair.elements[0]) as ts.PropertyAccessExpression).expression) &&
              ((unwrap(pair.elements[0]) as ts.PropertyAccessExpression).expression as ts.Identifier).text === row.text &&
              /^(?:name|label|slug|nome|foodName|foodId|alimento|productName)$/.test(
                (unwrap(pair.elements[0]) as ts.PropertyAccessExpression).name.text)) {
            return resolveJsonExpression(entries.expression.expression, entries, visited,
              depth + 1, "records", decisionUse);
          }
        }
      }
      // JSON round-trip carries records only if both calls use the unshadowed intrinsic.
      if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
          value.expression.expression.getText(source) === "JSON" &&
          value.expression.name.text === "parse" && value.arguments.length === 1 &&
          unshadowedIntrinsic("JSON", value)) {
        const encoded = unwrap(value.arguments[0]);
        if (ts.isCallExpression(encoded) && ts.isPropertyAccessExpression(encoded.expression) &&
            encoded.expression.expression.getText(source) === "JSON" &&
            encoded.expression.name.text === "stringify" && encoded.arguments.length === 1 &&
            unshadowedIntrinsic("JSON", encoded)) {
          return resolveJsonExpression(encoded.arguments[0], encoded, visited, depth + 1,
            kind, decisionUse);
        }
      }
      // F41: array spread does not discard provenance of its constituent
      // records. Treat only actual SpreadElements as source expressions.
      if (ts.isArrayLiteralExpression(value)) {
        return [...new Set(value.elements.flatMap(element => ts.isSpreadElement(element)
          ? resolveJsonExpression(element.expression, use, new Set(visited), depth + 1, kind, decisionUse)
          : []))];
      }
      // Array.from may copy records or project the food identity through a mapper.
      if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
          value.expression.expression.getText(source) === "Array" &&
          value.expression.name.text === "from" &&
          (value.arguments.length === 1 || value.arguments.length === 2)) {
        let shadowed = false;
        for (let scope: ts.Node | undefined = value; scope; scope = scope.parent) {
          if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
            ts.isIdentifier(param.name) && param.name.text === "Array")) { shadowed = true; break; }
          if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
          if (scope.statements.some(statement =>
            ts.isVariableStatement(statement) && statement.declarationList.declarations.some(decl =>
              ts.isIdentifier(decl.name) && decl.name.text === "Array") ||
            ts.isImportDeclaration(statement) && statement.importClause?.name?.text === "Array")) {
            shadowed = true; break;
          }
        }
        if (!shadowed) {
          if (value.arguments.length === 1) return resolveJsonExpression(
            value.arguments[0], use, visited, depth + 1, kind, decisionUse);
          if (kind === "identity" && callbackProjectsJsonIdentity(value.arguments[1], false,
              true, decisionUse)) return resolveJsonExpression(value.arguments[0], use,
                visited, depth + 1, "records", decisionUse);
          if (kind === "records" && preservesJsonIdentity(value.arguments[1], false,
              decisionUse)) return resolveJsonExpression(value.arguments[0], use,
                visited, depth + 1, "records", decisionUse);
        }
      }
      // A direct filesystem JSON parse can flow through aliases, projections
      // and conditional origins using exactly the same decision-use analysis
      // as an ES import. Unknown providers/paths are never treated as proof.
      const parsedFile = parsedFilesystemJsonPath(value, filesystemBindings, use);
      if (parsedFile) return resolveRuntimeDependencies(consumer.path, parsedFile, indexed)
        .filter(target => /\.json$/i.test(target));
      // AUD1300-F22: a JSON require is a source expression, including when
      // its variable is not the first declarator of a statement. Binding
      // lookup must resolve this origin before inspecting map/filter chains.
      // A local require parameter/declaration never proves a Node JSON import.
      if (ts.isCallExpression(value) && isNodeRequireCall(value) &&
          value.arguments.length === 1 && ts.isStringLiteral(value.arguments[0])) {
        return resolveRuntimeDependencies(consumer.path, value.arguments[0].text, indexed)
          .filter(target => /\.json$/i.test(target));
      }
      // Object.values({ items: rows })[0] preserves rows. Only a statically
      // proven single property is safe; do not misattribute another index.
      if (kind === "records" && ts.isElementAccessExpression(value) &&
          value.argumentExpression && ts.isNumericLiteral(unwrap(value.argumentExpression)) &&
          (unwrap(value.argumentExpression) as ts.NumericLiteral).text === "0" &&
          ts.isCallExpression(value.expression) &&
          ts.isPropertyAccessExpression(value.expression.expression) &&
          ts.isIdentifier(value.expression.expression.expression) &&
          value.expression.expression.expression.text === "Object" &&
          value.expression.expression.name.text === "values" &&
          value.expression.arguments.length === 1 && unshadowedIntrinsic("Object", value)) {
        const target = unwrap(value.expression.arguments[0]);
        const object = ts.isIdentifier(target) ? (() => {
          for (let scope: ts.Node | undefined = value; scope; scope = scope.parent) {
            if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
            for (const statement of scope.statements) {
              if (!ts.isVariableStatement(statement)) continue;
              for (const decl of statement.declarationList.declarations) {
                if (ts.isIdentifier(decl.name) && decl.name.text === target.text) {
                  return statement.declarationList.flags & ts.NodeFlags.Const && decl.initializer &&
                    decl.getStart(source) < value.getStart(source) ? unwrap(decl.initializer) : null;
                }
              }
            }
          }
          return null;
        })() : target;
        if (object && ts.isObjectLiteralExpression(object) && object.properties.length === 1 &&
            ts.isPropertyAssignment(object.properties[0])) {
          return resolveJsonExpression(object.properties[0].initializer, object.properties[0],
            visited, depth + 1, "records", decisionUse);
        }
      }
      // F27: a productive catalog may be nested under data.rows, including
      // equivalent literal computed keys. Verify the complete JSON path.
      if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
        const access = jsonStaticAccess(value);
        if (!access?.keys.length) return [];
        const local = jsonLocalProperty(access.root, access.keys, use);
        if (local) return resolveJsonExpression(local.expression, local.use,
          new Set(visited), depth + 1, kind, decisionUse);
        return resolveJsonExpression(access.root, use, new Set(visited), depth + 1, kind, decisionUse)
          .filter(target => jsonRecordPathExists(target, access.keys));
      }
      if (!ts.isCallExpression(value) ||
          (!ts.isPropertyAccessExpression(value.expression) &&
            !ts.isElementAccessExpression(value.expression))) return [];
      const access = value.expression;
      const method = ts.isPropertyAccessExpression(access)
        ? access.name.text
        : access.argumentExpression &&
          (ts.isStringLiteral(unwrap(access.argumentExpression)) ||
            ts.isNoSubstitutionTemplateLiteral(unwrap(access.argumentExpression)))
          ? (unwrap(access.argumentExpression) as ts.StringLiteral).text : "";
      const receiver = access.expression;
      // F56: matched, nonempty join/split delimiters keep catalog provenance.
      // A collision in one name may split that name, but other identities still
      // survive and influence the food decision. Never discard the entire
      // catalog because one record contains the delimiter.
      // Mismatched/empty delimiters and opaque transformations remain excluded.
      if (kind === "identity" && method === "split" && value.arguments.length === 1 &&
          ts.isCallExpression(receiver)) {
        const joined = receiver;
        const joinAccess = joined.expression;
        const joinMethod = ts.isPropertyAccessExpression(joinAccess) ? joinAccess.name.text :
          ts.isElementAccessExpression(joinAccess) && joinAccess.argumentExpression &&
            isStaticText(unwrap(joinAccess.argumentExpression))
            ? (unwrap(joinAccess.argumentExpression) as ts.StringLiteral).text : "";
        if (joinMethod === "join" && joined.arguments.length <= 1 &&
            (ts.isPropertyAccessExpression(joinAccess) ||
              ts.isElementAccessExpression(joinAccess))) {
          const splitSeparator = immutableDecisionString(value.arguments[0], value, source);
          const joinSeparator = joined.arguments.length
            ? immutableDecisionString(joined.arguments[0], joined, source) : ",";
          if (splitSeparator !== null && splitSeparator.length > 0 &&
              splitSeparator === joinSeparator) {
            return resolveJsonExpression(joinAccess.expression, joined,
              new Set(visited), depth + 1, "identity", decisionUse);
          }
        }
      }
      // F13: Object.values(arrayOrRecord) preserves the records, unlike
      // Object.keys (indexes) or Object.entries (tuples). Only propagate record
      // provenance; treating an array of objects as projected identity strings
      // would incorrectly block inert .includes("name") checks.
      if (kind === "records" && method === "values" &&
          ts.isIdentifier(receiver) &&
          receiver.text === "Object" &&
          value.arguments.length === 1) {
        // A shadowed local/parameter/import named Object is not the intrinsic.
        const shadowsObject = (): boolean => {
          for (let scope: ts.Node | undefined = value; scope; scope = scope.parent) {
            if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
              ts.isIdentifier(param.name) && param.name.text === "Object")) return true;
            if (ts.isCatchClause(scope) && scope.variableDeclaration &&
                ts.isIdentifier(scope.variableDeclaration.name) &&
                scope.variableDeclaration.name.text === "Object") return true;
            if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
            for (const statement of scope.statements) {
              if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(decl =>
                  ts.isIdentifier(decl.name) && decl.name.text === "Object")) return true;
              if (ts.isFunctionDeclaration(statement) && statement.name?.text === "Object") return true;
              if (ts.isImportDeclaration(statement) && statement.importClause &&
                  (statement.importClause.name?.text === "Object" ||
                    (statement.importClause.namedBindings &&
                      (ts.isNamespaceImport(statement.importClause.namedBindings)
                        ? statement.importClause.namedBindings.name.text === "Object"
                        : statement.importClause.namedBindings.elements.some(binding =>
                            binding.name.text === "Object"))))) return true;
            }
          }
          return false;
        };
        if (!shadowsObject()) return resolveJsonExpression(
          value.arguments[0], use, visited, depth + 1, "records", decisionUse);
      }
      if (method === "reduce" && kind === "records" && value.arguments.length === 2 &&
          ts.isArrayLiteralExpression(unwrap(value.arguments[1])) &&
          (unwrap(value.arguments[1]) as ts.ArrayLiteralExpression).elements.length === 0) {
        const fn = resolveJsonCallback(value.arguments[0], value);
        const accumulator = fn?.parameters[0]?.name;
        const row = fn?.parameters[1]?.name;
        if (fn && accumulator && row && ts.isIdentifier(accumulator) && ts.isIdentifier(row)) {
          const result = jsonReturn(fn);
          const isAcc = (x: ts.Expression) => ts.isIdentifier(unwrap(x)) &&
            (unwrap(x) as ts.Identifier).text === accumulator.text;
          const isRow = (x: ts.Expression) => ts.isIdentifier(unwrap(x)) &&
            (unwrap(x) as ts.Identifier).text === row.text;
          const spreadResult = result && ts.isArrayLiteralExpression(unwrap(result)) &&
            (unwrap(result) as ts.ArrayLiteralExpression).elements.some(e =>
              ts.isSpreadElement(e) && isAcc(e.expression)) &&
            (unwrap(result) as ts.ArrayLiteralExpression).elements.some(e => isRow(e));
          const block = fn.body && ts.isBlock(fn.body) ? fn.body : undefined;
          const pushed = block && block.statements.length === 2 && result && isAcc(result) &&
            ts.isExpressionStatement(block.statements[0]) &&
            ts.isCallExpression(block.statements[0].expression) &&
            ts.isPropertyAccessExpression(block.statements[0].expression.expression) &&
            block.statements[0].expression.expression.name.text === "push" &&
            isAcc(block.statements[0].expression.expression.expression) &&
            block.statements[0].expression.arguments.length === 1 &&
            isRow(block.statements[0].expression.arguments[0]);
          if (spreadResult || pushed) return resolveJsonExpression(receiver, use, visited,
            depth + 1, "records", decisionUse);
        }
        return [];
      }
      if (!/^(?:map|flatMap|filter|slice|toSorted|toReversed|toSpliced|sort|reverse|copyWithin|concat)$/.test(method)) return [];
      // concat can carry records from either side; changes in ordering and
      // shallow copying never alter the origin of a record.
      if (method === "concat") {
        return [...new Set([receiver, ...value.arguments].flatMap(item =>
          resolveJsonExpression(item, use, new Set(visited), depth + 1, kind, decisionUse)))];
      }
      if (kind === "identity") {
        if (method === "map" || method === "flatMap") {
          if (callbackProjectsJsonIdentity(value.arguments[0], method === "flatMap", true, decisionUse)) {
            return resolveJsonExpression(receiver, use, visited, depth + 1, "records", decisionUse);
          }
          if (!callbackProjectsJsonIdentity(value.arguments[0], method === "flatMap", false, decisionUse)) return [];
        }
        return resolveJsonExpression(receiver, use, visited, depth + 1, "identity", decisionUse);
      }
      if ((method === "map" || method === "flatMap") &&
          !preservesJsonIdentity(value.arguments[0], method === "flatMap", decisionUse)) return [];
      return resolveJsonExpression(receiver, use, visited, depth + 1, "records", decisionUse);
    };
    // AUD1300-F02: trace immutable aliases and transforms before the decision,
    // including .map()/.reduce(); module and local bindings must not be confused.
    const resolveJsonBinding = (
      name: string, use: ts.Node, seen = new Set<ts.VariableDeclaration>(), depth = 0,
      kind: JsonTraceKind = "records", decisionUse: ts.Node = use,
    ): string[] => {
      if (depth > 12) return [];
      for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
        if ((ts.isFunctionDeclaration(scope) || ts.isMethodDeclaration(scope) ||
            ts.isArrowFunction(scope) || ts.isFunctionExpression(scope)) &&
            scope.parameters.some(parameter =>
              ts.isIdentifier(parameter.name) && parameter.name.text === name)) {
          const param = scope.parameters.find(parameter =>
            ts.isIdentifier(parameter.name) && parameter.name.text === name)!;
          const binding = [...jsonCallFrames].reverse().map(frame => frame.get(param))
            .find(Boolean);
          if (binding) return resolveJsonExpression(binding.value, binding.use,
            new Set(seen), depth + 1, kind, decisionUse);
          // A Promise.then callback receives the resolved value of the previous
          // promise. Follow only the parameter bound directly to that callback.
          const parent = ts.isParenthesizedExpression(scope.parent)
            ? scope.parent.parent : scope.parent;
          if ((ts.isArrowFunction(scope) || ts.isFunctionExpression(scope)) &&
              ts.isCallExpression(parent) && parent.arguments[0] &&
              unwrap(parent.arguments[0]) === scope &&
              ts.isPropertyAccessExpression(parent.expression) &&
              parent.expression.name.text === "then" && scope.parameters.length === 1) {
            return resolveJsonExpression(parent.expression.expression, parent,
              new Set(seen), depth + 1, kind, decisionUse);
          }
          return [];
        }
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name)) {
              const keys = jsonBindingPath(decl.name, name);
              if (!keys?.length) continue;
              if (!decl.initializer || seen.has(decl) ||
                  decl.getStart(source) >= use.getStart(source)) return [];
              const access = jsonStaticAccess(decl.initializer);
              if (!access) return [];
              const local = jsonLocalProperty(access.root, [...access.keys, ...keys], decl);
              if (local) return resolveJsonExpression(local.expression, local.use,
                new Set(seen), depth + 1, kind, decisionUse);
              const roots = resolveJsonExpression(access.root, decl, new Set(seen), depth + 1,
                kind, decisionUse);
              return roots.filter(target => jsonRecordPathExists(target, [...access.keys, ...keys]));
            }
            if (decl.name.text !== name) continue;
            if (!decl.initializer || seen.has(decl) ||
                decl.getStart(source) >= use.getStart(source)) return [];
            seen.add(decl);
            // Track *possible* provenance across conditional branches. A source
            // is dropped only by a definite write before the decision; an if
            // without else still leaves the imported value on its other path.
            type Origin = { value: ts.Expression; location: ts.Node };
            let origins: Origin[] = [{ value: decl.initializer, location: decl }];
            const declarationList = decl.parent;
            if (ts.isVariableDeclarationList(declarationList) &&
                !(declarationList.flags & ts.NodeFlags.Const)) {
              type Write = { position: number; values: ts.Expression[]; definite: boolean };
              const writes: Write[] = [];
              // Both arms of an exhaustive if/else can overwrite the import
              // even though neither individual write is unconditionally run.
              // Do not claim this for a single-arm if or a conditional last write.
              const containsAliasWrite = (candidate: ts.Node): boolean => {
                if (ts.isFunctionLike(candidate)) return false;
                if (ts.isBinaryExpression(candidate) && ts.isIdentifier(candidate.left) &&
                    candidate.left.text === name && /=$/.test(candidate.operatorToken.getText(source))) return true;
                return ts.forEachChild(candidate, containsAliasWrite) ?? false;
              };
              const guaranteedOverwrites = (candidate: ts.Statement): ts.Expression[] | undefined => {
                if (ts.isBlock(candidate)) {
                  // Inner redeclarations shadow the outer mutable alias; their
                  // assignments cannot prove that its imported source was dropped.
                  if (candidate.statements.some(statement => ts.isVariableStatement(statement) &&
                      statement.declarationList.declarations.some(binding =>
                        ts.isIdentifier(binding.name) && binding.name.text === name))) return undefined;
                  for (let i = candidate.statements.length - 1; i >= 0; i--) {
                    const statement = candidate.statements[i];
                    if (containsAliasWrite(statement)) return guaranteedOverwrites(statement);
                  }
                  return undefined;
                }
                if (ts.isExpressionStatement(candidate) && ts.isBinaryExpression(candidate.expression) &&
                    ts.isIdentifier(candidate.expression.left) &&
                    candidate.expression.left.text === name &&
                    candidate.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
                  return [candidate.expression.right];
                }
                if (ts.isIfStatement(candidate) && candidate.elseStatement) {
                  const left = guaranteedOverwrites(candidate.thenStatement);
                  const right = guaranteedOverwrites(candidate.elseStatement);
                  return left && right ? [...left, ...right] : undefined;
                }
                return undefined;
              };
              const useStart = use.getStart(source);
              const containsUse = (node: ts.Node): boolean => {
                for (let parent: ts.Node | undefined = use; parent; parent = parent.parent) {
                  if (parent === node) return true;
                }
                return false;
              };
              const scanWrites = (candidate: ts.Node, definite: boolean): void => {
                if (candidate.getStart(source) >= useStart) return;
                if (ts.isFunctionLike(candidate)) return;
                if (ts.isIfStatement(candidate) && candidate.elseStatement &&
                    !containsUse(candidate) && candidate.end <= useStart) {
                  const values = guaranteedOverwrites(candidate);
                  if (values) {
                    writes.push({ position: candidate.getStart(source), values, definite });
                    return;
                  }
                }
                if (ts.isBlock(candidate) && candidate !== scope &&
                    candidate.statements.some(statement => ts.isVariableStatement(statement) &&
                      statement.declarationList.declarations.some(binding =>
                        ts.isIdentifier(binding.name) && binding.name.text === name))) return;
                if (ts.isBinaryExpression(candidate) &&
                    ts.isIdentifier(candidate.left) && candidate.left.text === name) {
                  const operator = candidate.operatorToken.getText(source);
                  if (/=$/.test(operator)) {
                    writes.push({ position: candidate.getStart(source),
                      values: operator === "=" ? [candidate.right] : [], definite });
                    return;
                  }
                }
                const conditional = ts.isIfStatement(candidate) || ts.isSwitchStatement(candidate) ||
                  ts.isTryStatement(candidate) || ts.isForStatement(candidate) ||
                  ts.isForOfStatement(candidate) || ts.isForInStatement(candidate) ||
                  ts.isWhileStatement(candidate) || ts.isDoStatement(candidate) ||
                  ts.isConditionalExpression(candidate);
                ts.forEachChild(candidate, child =>
                  scanWrites(child, definite && (!conditional || containsUse(child))));
              };
              for (const statement of scope.statements) {
                if (statement.getStart(source) <= decl.getStart(source) ||
                    statement.getStart(source) >= useStart) continue;
                scanWrites(statement, true);
              }
              for (const write of writes.sort((a, b) => a.position - b.position)) {
                const replacement: Origin[] = write.values.map(value =>
                  ({ value, location: value }));
                origins = write.definite ? replacement : origins.concat(replacement);
              }
            }
            return [...new Set(origins.flatMap(origin =>
              resolveJsonExpression(origin.value, origin.location, new Set(seen), depth + 1, kind, decisionUse)))];
          }
        }
      }
      return imports.get(name) ?? [];
    };
    // JSON with generic name/label/calories is governed once a productive
    // food decision consumes its identity. Keep account/exercise decisions out.
    const foodJsonDecisionContext = (node: ts.Node): boolean => {
      const declaration = enclosingDeclaration(node);
      const foodDomain = /food|aliment|nutrition|nutrient|meal|ingredient|portion|porc|serving/i;
      const unrelatedDecision = /exercise|activity|workout|fitness|account|status/i;
      // AUD1300-20261015-F01: an account/ directory can contain a genuine
      // food decision. Evaluate the decision before applying path heuristics;
      // account/status/activity decisions are exempt, not entire directories.
      if (foodDomain.test(declaration)) return true;
      // Exempt unrelated named decisions before identity-field heuristics.
      // Otherwise exercise(foodName) taints imported JSON with false debts.
      if (unrelatedDecision.test(declaration)) return false;
      // Structured input fields count only when the decision consumes that
      // specific food field, not when a type merely declares foodName.
      if (/\b(?:foodName|foodId|foodLabel|foodKey|alimento|alimentoId|ingredientName|productName)\b/i
        .test(node.getText(source))) return true;
      // A typed food parameter must actually reach the current decision.
      // Its mere presence must not taint a sibling status lookup.
      for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) {
        if (!ts.isFunctionLike(parent)) continue;
        const decision = node.getText(source);
        const candidates = parent.parameters.filter(parameter => ts.isIdentifier(parameter.name) &&
          /^(?:foodName|foodId|foodLabel|foodKey|alimento|alimentoId|ingredientName|productName)$/i
            .test(parameter.name.text));
        for (const parameter of candidates) {
          const parameterName = (parameter.name as ts.Identifier).text;
          if (new RegExp("\\b" + parameterName + "\\b").test(decision)) return true;
          if (parent.body && ts.isBlock(parent.body)) {
            for (const statement of parent.body.statements) {
              if (!ts.isVariableStatement(statement) ||
                  !(statement.declarationList.flags & ts.NodeFlags.Const) ||
                  statement.getStart(source) >= node.getStart(source)) continue;
              for (const declaration of statement.declarationList.declarations) {
                if (!ts.isIdentifier(declaration.name) || !declaration.initializer ||
                    !ts.isIdentifier(unwrap(declaration.initializer)) ||
                    (unwrap(declaration.initializer) as ts.Identifier).text !== parameterName) continue;
                const alias = declaration.name.text;
                if (new RegExp("\\b" + alias + "\\b").test(decision) &&
                    !(ts.isCallExpression(node) && node.arguments.some(argument =>
                      (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
                      argument.parameters.some(p => ts.isIdentifier(p.name) && p.name.text === alias)))) return true;
              }
            }
          }
        }
        break;
      }
      // Directory names alone are not exclusions: an account/foodService.ts
      // may still make a food decision with an anonymous/generic handler.
      const filename = consumer.path.split("/").pop() ?? "";
      return foodDomain.test(consumer.path) &&
        !unrelatedDecision.test(filename);
    };
    const isJsonIdentityDecision = (predicate: string, receiver?: string): boolean => {
      const identity = "(?:name|title|label|slug|nome|foodName|foodId|alimento|productName)";
      const bound = receiver
        ? "\\b" + receiver.replace(/[^A-Za-z0-9_]/g, "\\$&") + "\\s*"
        : "[A-Za-z_$][\\w$]*\\s*";
      const fieldAccess = new RegExp(bound +
        "(?:\\.\\s*" + identity + "\\b|\\[\\s*['\"]" + identity + "['\"]\\s*\\])");
      return fieldAccess.test(predicate) &&
        /===?|!==?|\.includes\s*\(|\.startsWith\s*\(|\.endsWith\s*\(|\.test\s*\(/.test(predicate);
    };
    // Follow immutable callback aliases used by JSON collection decisions.
    // A parameter or mutable binding must not inherit a similarly named predicate.
    const resolveJsonCallback = (value: ts.Expression, use: ts.Node,
      visited = new Set<ts.VariableDeclaration>(), depth = 0,
    ): ts.FunctionLikeDeclaration | undefined => {
      if (depth > 12) return undefined;
      const expr = unwrap(value);
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return expr;
      if (!ts.isIdentifier(expr)) return undefined;
      for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
        if ((ts.isFunctionDeclaration(scope) || ts.isMethodDeclaration(scope) ||
            ts.isArrowFunction(scope) || ts.isFunctionExpression(scope)) &&
            scope.parameters.some(parameter => ts.isIdentifier(parameter.name) &&
              parameter.name.text === expr.text)) return undefined;
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (ts.isFunctionDeclaration(statement) && statement.name?.text === expr.text) return statement;
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== expr.text) continue;
            if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
                !declaration.initializer || visited.has(declaration) ||
                declaration.getStart(source) >= use.getStart(source)) return undefined;
            const next = new Set(visited);
            next.add(declaration);
            return resolveJsonCallback(declaration.initializer, declaration, next, depth + 1);
          }
        }
      }
      return undefined;
    };
    // A destructured callback or for-of binding has no ".name" token in its
    // decision body, but the bound identity still originates from the JSON.
    // AUD1300-JSON-NORMALIZED-06: follow only transparent identity normalizers.
    const isDestructuredJsonIdentityDecision = (name: ts.BindingName, node: ts.Node): boolean => {
      if (!ts.isObjectBindingPattern(name)) return false;
      const identities = new Set<string>();
      for (const element of name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const property = (element.propertyName ?? element.name).getText(source)
          .replace(/^['"]|['"]$/g, "");
        if (/^(?:name|label|slug|nome|foodName|foodId|alimento|productName)$/.test(property)) {
          identities.add(element.name.text);
        }
      }
      if (!identities.size) return false;
      const isIdentity = (value: ts.Expression, depth = 0): boolean => {
        if (depth > 12) return false;
        const expr = unwrap(value);
        if (ts.isIdentifier(expr)) return identities.has(expr.text);
        if (!ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) return false;
        const method = expr.expression.name.text;
        const noArgs = /^(?:trim|trimStart|trimEnd|toLowerCase|toUpperCase)$/.test(method) &&
          expr.arguments.length === 0;
        const unicode = method === "normalize" && expr.arguments.length <= 1 &&
          (expr.arguments.length === 0 || isStaticText(unwrap(expr.arguments[0])));
        return (noArgs || unicode) && isIdentity(expr.expression.expression, depth + 1);
      };
      let decision = false;
      const scan = (candidate: ts.Node): void => {
        if (decision) return;
        if (ts.isBinaryExpression(candidate) &&
            [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
              ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]
              .includes(candidate.operatorToken.kind) &&
            (isIdentity(candidate.left) || isIdentity(candidate.right))) {
          decision = true;
          return;
        }
        ts.forEachChild(candidate, scan);
      };
      scan(node);
      return decision;
    };
    const projectedIdentityDecision = (name: string, predicate: ts.Node): boolean => {
      const isIdentity = (candidate: ts.Expression, depth = 0): boolean => {
        if (depth > 8) return false;
        const value = unwrap(candidate);
        if (ts.isIdentifier(value)) return value.text === name;
        return ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
          /^(?:trim|trimStart|trimEnd|toLowerCase|toUpperCase|normalize)$/.test(value.expression.name.text) &&
          value.arguments.length <= (value.expression.name.text === "normalize" ? 1 : 0) &&
          value.arguments.every(arg => isStaticText(unwrap(arg))) &&
          isIdentity(value.expression.expression, depth + 1);
      };
      let decision = false;
      const scan = (candidate: ts.Node): void => {
        if (decision) return;
        if (ts.isBinaryExpression(candidate) &&
            [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
              ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]
              .includes(candidate.operatorToken.kind) &&
            (isIdentity(candidate.left) || isIdentity(candidate.right))) {
          decision = true;
        } else if (ts.isSwitchStatement(candidate) && isIdentity(candidate.expression)) {
          decision = true;
        } else if (ts.isCallExpression(candidate) &&
            ts.isPropertyAccessExpression(candidate.expression) &&
            /^(?:includes|startsWith|endsWith)$/.test(candidate.expression.name.text) &&
            isIdentity(candidate.expression.expression)) {
          decision = true;
        } else {
          ts.forEachChild(candidate, scan);
        }
      };
      scan(predicate);
      return decision;
    };
    // AUD1300-F28: a JSON record remains productive when extracted with
    // array destructuring and its identity is compared without .find/.some.
    // Require an immutable lexical chain and an actual food decision; otherwise
    // display-only or unrelated data could be incorrectly classified.
    const jsonArrayIdentityFields = /^(?:name|label|slug|nome|foodName|foodId|alimento|productName)$/;
    const containsBinding = (pattern: ts.BindingName, sought: string): boolean => {
      if (ts.isIdentifier(pattern)) return pattern.text === sought;
      return pattern.elements.some(element =>
        ts.isBindingElement(element) && containsBinding(element.name, sought));
    };
    const findLexicalJsonBinding = (
      sought: string, use: ts.Node,
    ): ts.VariableDeclaration | null => {
      for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
        if (ts.isFunctionLike(scope) &&
            scope.parameters.some(parameter => containsBinding(parameter.name, sought))) return null;
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (ts.isFunctionDeclaration(statement) && statement.name?.text === sought) return null;
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            if (!containsBinding(declaration.name, sought)) continue;
            return declaration.getStart(source) < use.getStart(source) ? declaration : null;
          }
        }
      }
      return null;
    };
    const isStableJsonBinding = (declaration: ts.VariableDeclaration): boolean =>
      ts.isVariableDeclarationList(declaration.parent) &&
      !!(declaration.parent.flags & ts.NodeFlags.Const) && !!declaration.initializer;
    // Mutable extraction is still attributable until a definite overwrite.
    // Ignore speculative branch writes: an original JSON record can survive.
    const hasDefiniteRowOverwrite = (declaration: ts.VariableDeclaration, use: ts.Node,
      sought: string): boolean => {
      let scope: ts.Node | undefined = declaration;
      while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
      if (!scope) return true;
      const replaces = (statement: ts.Statement): boolean => {
        if (ts.isBlock(statement)) return statement.statements.some(replaces);
        return ts.isExpressionStatement(statement) &&
          ((ts.isBinaryExpression(statement.expression) &&
            ts.isIdentifier(statement.expression.left) &&
            statement.expression.left.text === sought &&
            statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
            (ts.isPrefixUnaryExpression(statement.expression) &&
              ts.isIdentifier(statement.expression.operand) &&
              statement.expression.operand.text === sought));
      };
      for (const statement of scope.statements) {
        if (statement.getStart(source) <= declaration.getStart(source) ||
            statement.getStart(source) >= use.getStart(source)) continue;
        if (replaces(statement)) return true;
        if (ts.isIfStatement(statement) && statement.elseStatement &&
            replaces(statement.thenStatement) && replaces(statement.elseStatement)) return true;
      }
      return false;
    };
    const traceableRowBinding = (declaration: ts.VariableDeclaration, use: ts.Node,
      sought: string): boolean =>
      !!declaration.initializer && ts.isVariableDeclarationList(declaration.parent) &&
      (!!(declaration.parent.flags & ts.NodeFlags.Const) ||
        !hasDefiniteRowOverwrite(declaration, use, sought));
    const staticIndex = (value: ts.Expression): string | null => {
      const index = unwrap(value);
      if (ts.isNumericLiteral(index) && /^\d+$/.test(index.text)) return index.text;
      if (ts.isStringLiteral(index) && /^\d+$/.test(index.text)) return index.text;
      return null;
    };
    const indexedFoodRecordExists = (target: string, index: string, receiver: ts.Expression): boolean => {
      const file = indexed.get(target);
      if (!file) return false;
      let data: unknown;
      try { data = JSON.parse(file.content); } catch { return false; }
      const access = jsonStaticAccess(receiver);
      for (const key of access?.keys ?? []) {
        if (!data || typeof data !== "object" || !(key in data)) return false;
        data = (data as Record<string, unknown>)[key];
      }
      if (!Array.isArray(data)) return false;
      const record: unknown = data[Number(index)];
      return !!record && typeof record === "object" && !Array.isArray(record) &&
        Object.keys(record).some(key =>
          /^(?:calories|kcal|protein|carbs|fat|nutrition|nutrients|macros|portionGrams|gramsPerServing|foodName|foodId|ingredient)$/i.test(key));
    };
    const indexedJsonRow = (expression: ts.Expression, use: ts.Node): string[] => {
      const value = unwrap(expression);
      let root: ts.Expression | null = null;
      let index: string | null = null;
      if (ts.isElementAccessExpression(value) && value.argumentExpression) {
        root = value.expression;
        index = staticIndex(value.argumentExpression);
      } else if (ts.isCallExpression(value) &&
          ts.isPropertyAccessExpression(value.expression) &&
          value.expression.name.text === "at" && value.arguments.length === 1) {
        root = value.expression.expression;
        index = staticIndex(value.arguments[0]);
      }
      if (!root || index === null) return [];
      return resolveJsonExpression(root, use).filter(target =>
        indexedFoodRecordExists(target, index, root));
    };
    const extractedJsonRow = (
      expression: ts.Expression, use: ts.Node, depth = 0,
    ): string[] => {
      if (depth > 12) return [];
      const value = unwrap(expression);
      // A direct array-index or .at() access is the same JSON record as an
      // indexed local alias. Require a real indexed nutrition row.
      const direct = indexedJsonRow(value, use);
      if (direct.length) return direct;
      if (!ts.isIdentifier(value)) return [];
      const declaration = findLexicalJsonBinding(value.text, use);
      if (!declaration || !traceableRowBinding(declaration, use, value.text)) return [];
      if (ts.isArrayBindingPattern(declaration.name)) {
        const extracted = declaration.name.elements.some(element =>
          ts.isBindingElement(element) && ts.isIdentifier(element.name) &&
          element.name.text === value.text);
        return extracted && declaration.initializer
          ? resolveJsonExpression(declaration.initializer, declaration) : [];
      }
      if (ts.isObjectBindingPattern(declaration.name)) {
        const extracted = declaration.name.elements.find(element =>
          ts.isIdentifier(element.name) && element.name.text === value.text &&
          element.propertyName &&
          (ts.isNumericLiteral(element.propertyName) ||
            ts.isStringLiteral(element.propertyName)) &&
          /^\d+$/.test(element.propertyName.text));
        return extracted && declaration.initializer
          ? resolveJsonExpression(declaration.initializer, declaration).filter(target =>
            indexedFoodRecordExists(target,
              extracted.propertyName!.getText(source).replace(/[\"']/g, ""),
              declaration.initializer!)) : [];
      }
      if (!declaration.initializer || !ts.isIdentifier(declaration.name)) return [];
      const indexed = indexedJsonRow(declaration.initializer, declaration);
      return indexed.length ? indexed :
        extractedJsonRow(declaration.initializer, declaration, depth + 1);
    };
    const extractedJsonIdentity = (
      expression: ts.Expression, use: ts.Node, depth = 0,
    ): string[] => {
      if (depth > 12) return [];
      const value = unwrap(expression);
      if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
          /^(?:trim|trimStart|trimEnd|toLowerCase|toUpperCase|normalize)$/.test(value.expression.name.text) &&
          value.arguments.length <= (value.expression.name.text === "normalize" ? 1 : 0) &&
          value.arguments.every(arg => isStaticText(unwrap(arg)))) {
        return extractedJsonIdentity(value.expression.expression, use, depth + 1);
      }
      if ((ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value))) {
        const field = ts.isPropertyAccessExpression(value) ? value.name.text :
          value.argumentExpression && isStaticText(unwrap(value.argumentExpression))
            ? (unwrap(value.argumentExpression) as ts.StringLiteral).text : "";
        return jsonArrayIdentityFields.test(field)
          ? extractedJsonRow(value.expression, use, depth + 1) : [];
      }
      if (!ts.isIdentifier(value)) return [];
      const declaration = findLexicalJsonBinding(value.text, use);
      if (!declaration || !isStableJsonBinding(declaration)) return [];
      if (ts.isObjectBindingPattern(declaration.name)) {
        const field = declaration.name.elements.find(element => ts.isIdentifier(element.name) &&
          element.name.text === value.text &&
          (ts.isIdentifier(element.propertyName ?? element.name) ||
            ts.isStringLiteral(element.propertyName ?? element.name)) &&
          jsonArrayIdentityFields.test((element.propertyName ?? element.name).getText(source)
            .replace(/^["']|["']$/g, "")));
        return field && declaration.initializer
          ? indexedJsonRow(declaration.initializer, declaration) : [];
      }
      if (ts.isArrayBindingPattern(declaration.name)) {
        const projected = declaration.name.elements.some(element =>
          ts.isBindingElement(element) && ts.isObjectBindingPattern(element.name) &&
          element.name.elements.some(field => {
            if (!ts.isIdentifier(field.name) || field.name.text !== value.text) return false;
            const key = field.propertyName ?? field.name;
            return (ts.isIdentifier(key) || ts.isStringLiteral(key)) &&
              jsonArrayIdentityFields.test(key.text);
          }));
        return projected && declaration.initializer
          ? resolveJsonExpression(declaration.initializer, declaration) : [];
      }
      return declaration.initializer && ts.isIdentifier(declaration.name)
        ? extractedJsonIdentity(declaration.initializer, declaration, depth + 1) : [];
    };
    const visitDestructuredJsonDecision = (node: ts.Node): void => {
      if (!foodJsonDecisionContext(node)) return;
      let targets: string[] = [];
      if (ts.isBinaryExpression(node) &&
          [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]
            .includes(node.operatorToken.kind)) {
        targets = [...extractedJsonIdentity(node.left, node),
          ...extractedJsonIdentity(node.right, node)];
      } else if (ts.isSwitchStatement(node)) {
        targets = extractedJsonIdentity(node.expression, node);
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          /^(?:includes|startsWith|endsWith)$/.test(node.expression.name.text)) {
        targets = extractedJsonIdentity(node.expression.expression, node);
      }
      for (const target of targets) jsonRecordsConsumedByFood.add(target);
    };
    const visitJsonUse = (node: ts.Node): void => {
      visitDestructuredJsonDecision(node);
      // F23: property and literal-computed collection methods share one rule.
      const call = ts.isCallExpression(node) ? node : undefined;
      const access = call?.expression;
      const receiver = access && (ts.isPropertyAccessExpression(access) ||
        ts.isElementAccessExpression(access)) ? access.expression : undefined;
      const computed = access && ts.isElementAccessExpression(access) &&
        access.argumentExpression ? unwrap(access.argumentExpression) : undefined;
      const method = access && ts.isPropertyAccessExpression(access) ? access.name.text :
        computed && (ts.isStringLiteral(computed) || ts.isNoSubstitutionTemplateLiteral(computed))
          ? computed.text : "";
      if (call && receiver && /^(?:find|filter|some|map|reduce|forEach|every)$/.test(method) &&
          call.arguments[0]) {
        const targets = resolveJsonExpression(receiver, node);
        if (targets.length) {
          const predicateNode = call.arguments[0];
          const callback = resolveJsonCallback(predicateNode, node);
          const predicate = callback?.getText(source) ?? predicateNode.getText(source);
          const destructured = callback && callback.parameters[0] &&
            isDestructuredJsonIdentityDecision(callback.parameters[0].name, callback.body ?? callback);
          const foodDecision = foodJsonDecisionContext(node) &&
            (isJsonIdentityDecision(predicate) || !!destructured);
          if (foodDecision) for (const target of targets) jsonRecordsConsumedByFood.add(target);
        }
      }
      // Projected JSON identities are food knowledge only when actually used
      // in a productive decision. Pure display projections remain inert.
      if (call && receiver &&
          /^(?:includes|indexOf|lastIndexOf|has|find|some|every|filter)$/.test(method) &&
          call.arguments[0] && foodJsonDecisionContext(node)) {
        const targets = resolveJsonExpression(receiver, node,
          new Set<ts.VariableDeclaration>(), 0, "identity");
        if (targets.length) {
          const callback = /^(?:find|some|every|filter)$/.test(method)
            ? resolveJsonCallback(call.arguments[0], node) : undefined;
          const parameter = callback?.parameters[0]?.name;
          const identityDecision = /^(?:includes|indexOf|lastIndexOf|has)$/.test(method) ||
            !!(callback && parameter && ts.isIdentifier(parameter) && callback.body &&
              projectedIdentityDecision(parameter.text, callback.body));
          if (identityDecision) for (const target of targets) jsonRecordsConsumedByFood.add(target);
        }
      }
      // A loop deciding from a JSON row is equivalent to .find/.some. Without
      // this edge an anonymous name+calories catalog escapes gate 17/5.
      if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
        const declaration = node.initializer.declarations[0];
        const iterated = unwrap(node.expression);
        const targets = resolveJsonExpression(iterated, node);
        const identityUse = declaration && (ts.isIdentifier(declaration.name)
          ? isJsonIdentityDecision(node.statement.getText(source), declaration.name.text)
          : isDestructuredJsonIdentityDecision(declaration.name, node.statement));
        if (targets.length && declaration && foodJsonDecisionContext(node) && identityUse) {
          for (const target of targets) {
            jsonRecordsConsumedByFood.add(target);
          }
        }
        if (declaration && ts.isIdentifier(declaration.name) && foodJsonDecisionContext(node) &&
            projectedIdentityDecision(declaration.name.text, node.statement)) {
          for (const target of resolveJsonExpression(iterated, node,
            new Set<ts.VariableDeclaration>(), 0, "identity")) {
            jsonRecordsConsumedByFood.add(target);
          }
        }
      }
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) &&
          node.argumentExpression && foodIndexContext(node.argumentExpression, node, source)) {
        for (const target of resolveJsonBinding(node.expression.text, node)) {
          jsonRecordsConsumedByFood.add(target);
        }
      }
      ts.forEachChild(node, visitJsonUse);
    };
    ts.forEachChild(source, visitJsonUse);
  }
  const importedNumericMaps = findCrossModuleNumericFoodMaps(files, runtime, indexed);
  const staticCollectionRule = FOOD_WAVE_ONE_RULES.find(rule =>
    rule.detectorKey === "food-static-collection" && rule.failureClass === "I");
  for (const file of files) {
    if (!runtime.has(file.path.replace(/\\/g, "/"))) continue;
    if (/\.json$/i.test(file.path)) {
      // Merely downloading a public asset (for status/diagnostics/display)
      // is not proof that its contents govern a food decision. Unlike a
      // code import, an HTTP fetch does not itself read the JSON records.
      if (file.path.startsWith("client/public/") &&
          !jsonRecordsConsumedByFood.has(file.path) &&
          !importedNumericMaps.foodIndexedJson.has(file.path)) continue;
      results.push(...findJsonFoodCatalog(file,
        [...(importerContext.get(file.path) ?? [])].join(" "),
        importedNumericMaps.foodIndexedJson.has(file.path.replace(/\\/g, "/")),
        jsonRecordsConsumedByFood.has(file.path.replace(/\\/g, "/"))));
      continue;
    }
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    const filesystemBindings = filesystemReadBindings(source);
    function visit(node: ts.Node): void {
      if (staticCollectionRule && (isOpaqueFoodJsonLoad(node, source, filesystemBindings) ||
          isOpaqueFoodDynamicImport(node, source))) {
        const symbol = "opaque-runtime-food-data-load";
        results.push({
          ruleId: staticCollectionRule.id, file: file.path,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          symbol,
          fingerprint: staticCollectionRule.id + ":" + file.path + ":" + symbol + ":" + stableHash(node.getText(source)),
          failureClass: staticCollectionRule.failureClass,
          description: staticCollectionRule.description,
        });
      }
      for (const rule of FOOD_WAVE_ONE_RULES) {
        // New channel names must never bypass the single food decision owner.
        const ownerDeclaration = rule.kind === "function" &&
          rule.ownerFunction === "food-resolution";
        // Exemption is the currently published owner contract, not a folder
        // or an arbitrary version name. New V1/V2/V3 resolver entrypoints must
        // be audited even if colocated with Food Intelligence modules.
        const canonicalOwner = file.path === "server/foodItemResolution.ts" &&
          ts.isFunctionDeclaration(node) &&
          node.name?.text === "resolveCanonicalFoodQuantity";
        if (ownerDeclaration ? canonicalOwner : !matches(rule.pathPattern, file.path)) continue;
        const finding = ruleEvidence(node, source, rule);
        if (!finding || isCanonicalLinguisticGrammar(file.path, rule, finding)) continue;
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
  // F36: follow productive consumers through lexical bindings, sibling functions,
  // helpers and runtime imports. A declaration is reported at its source so a
  // formerly inert catalog that becomes productive cannot be silently exempted.
  const consumedMealChoices = findConsumedMealChoiceCatalogs(
    files, runtime, indexed, resolveRuntimeDependencies, stableHash,
    dependencyGraph, results,
  );
  for (const candidate of consumedMealChoices) {
    // Local recommendations already detected above must keep one finding only.
    if (!results.some(existing => existing.ruleId === candidate.ruleId &&
        existing.file === candidate.file && existing.line === candidate.line &&
        existing.symbol === candidate.symbol)) results.push(candidate);
  }
  results.push(...importedNumericMaps.findings);
  results.push(...findImportedLexicalFoodFindings(files, runtime, indexed, resolveRuntimeDependencies, stableHash));
  results.push(...findTransitiveAlternativeResolverFindings(
    dependencyGraph, runtime, isProductionFoodSource, stableHash,
    files, resolveRuntimeDependencies,
  ));
  return results.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}

type FoodOwnerFunction = "lexical-knowledge" | "attribute-materiality" |
  "portion-knowledge" | "food-knowledge" | "food-resolution" |
  "decision-roundtrip" | "nutrition-source-selection";

function ownerFunction(finding: FoodFinding): FoodOwnerFunction {
  const declared = FOOD_WAVE_ONE_RULES.find(rule => rule.id === finding.ruleId && rule.ownerFunction);
  if (declared?.ownerFunction) return declared.ownerFunction;
  if (/alias|lexic|vocab|synonym|normaliz|replacement|token/i.test(finding.symbol)) {
    return "lexical-knowledge";
  }
  if (/portion|por[cç]|serving/i.test(finding.symbol)) return "portion-knowledge";
  return "food-knowledge";
}

export function findCompetingOwnerInventory(files: FoodArchitectureFile[]) {
  return findFoodStaticCandidates(files).map(finding => {
    const channel = /whatsapp|image|audio|ocr|vision|handler|router/i.test(finding.file);
    const layer = channel ? "channel" : finding.file.startsWith("client/")
      ? "client" : finding.file.startsWith("shared/") ? "shared" : "server-domain";
    return {
      ...finding,
      ownerFunction: ownerFunction(finding),
      observedOwnerSurface: layer,
      candidateOwner: finding.file + "#" + finding.symbol,
      suspectedChannelOwner: channel,
      // Candidate classification: an AST finding does not prove actual runtime
      // ownership. Keep the human review status explicit.
      status: "requires-review" as const,
    };
  });
}

export function groupCompetingFoodOwners(inventory: ReturnType<typeof findCompetingOwnerInventory>) {
  const groups = new Map<FoodOwnerFunction, typeof inventory>();
  for (const candidate of inventory) {
    const group = groups.get(candidate.ownerFunction) ?? [];
    group.push(candidate);
    groups.set(candidate.ownerFunction, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([decisionFunction, findings]) => {
      const owners = [...new Set(findings.map(item => item.candidateOwner))].sort();
      const surfaces = [...new Set(findings.map(item => item.observedOwnerSurface))].sort();
      return {
        decisionFunction, expectedBoundary: "canonical-food-domain",
        observedSurfaces: surfaces, candidateOwners: owners,
        candidateCount: owners.length,
        crossSurfaceCandidates: surfaces.length > 1,
        // Pair evidence is derived from distinct source files, not duplicated
        // AST findings in the same owner. Pairs remain suspects until reviewed.
        suspectedCompetingPairs: [...new Set(findings.map(item => item.file))].sort()
          .flatMap((left, index, locations) => locations.slice(index + 1)
            .map(right => ({ left, right, status: "requires-behavioral-review" as const }))),
        status: "requires-behavioral-review" as const,
      };
    });
}

/** The non-lexicon, non-materiality wave-one detectors. */
export function findFoodIntelligenceViolations(files: FoodArchitectureFile[]) {
  const lexicalRuleIds = new Set(FOOD_WAVE_ONE_RULES
    .filter(rule => rule.ownerFunction === "lexical-knowledge" ||
      rule.ownerFunction === "attribute-materiality")
    .map(rule => rule.id));
  return findFoodStaticCandidates(files).filter(finding => !lexicalRuleIds.has(finding.ruleId));
}
