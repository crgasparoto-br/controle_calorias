/**
 * Static, AST-backed Food Intelligence V2 architecture discovery (ADR §19).
 * Do not confuse a candidate with a proven behavioral violation: the wave-one
 * registry blocks NEW findings after item 25 approval; existing legacy stays visible.
 */
import ts from "typescript";
import path from "node:path";
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

export function isProductionFoodSource(file: string): boolean {
  const p = file.replace(/\\/g, "/");
  return (p.startsWith("server/") || p.startsWith("shared/") || p.startsWith("client/src/")) &&
    /\.(?:[cm]?[jt]sx?|json)$/.test(p) &&
    !/\.d\.ts$|\.(?:test|spec|fixture|fixtures|mock|stories|generated)\.(?:[cm]?[jt]sx?|json)$|(?:^|\/)(?:__tests__|__fixtures__|__mocks__|fixtures|generated|__generated__|mocks|stories)(?:\/|$)/i.test(p);
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

/** Domain-driven numeric maps need evidence of food identity, not food words
 * inside their arbitrary keys. Reuse the same rule for collections and lookups. */
function isLiteralNumericMap(value: ts.Expression): boolean {
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
        return (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
          isLiteralNumericFoodValue(number);
      });
  }
  return ts.isObjectLiteralExpression(object) && object.properties.length > 0 &&
    object.properties.some(property => {
      if (!ts.isPropertyAssignment(property)) return false;
      if (!ts.isIdentifier(property.name) &&
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
  if (!/food|aliment|meal|nutrition|nutrient|ingredient|portion|porc|serving|recipe|receita/i.test(domain) ||
      /exercise|activity|workout|fitness|burnedcalories/i.test(domain)) return false;
  return /food|aliment|ingredient|product|portion|porc|serving|recipe|receita/i.test(name) ||
    /^(?:name|nome|item\.name|item\[['"]name['"]\])$/.test(name);
}

function isFoodNumericMapUse(node: ts.VariableDeclaration, source: ts.SourceFile): boolean {
  if (!node.initializer || !ts.isIdentifier(node.name) ||
      !isLiteralNumericMap(node.initializer)) return false;
  const symbol = node.name.text;
  const context = source.fileName + " " + enclosingDeclaration(node);
  if (/exercise|activity|workout|fitness|burnedcalories/i.test(context)) return false;
  if (/food|alimento|portion|porc|serving|nutrition|nutrient|macro|gram|catalog/i.test(symbol) &&
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
  if (ts.isNewExpression(expr) && expr.expression.getText() === "RegExp" &&
      expr.arguments?.length && isStaticText(unwrap(expr.arguments[0]))) {
    return (unwrap(expr.arguments[0]) as ts.StringLiteral).text;
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

function referencesLiteralWords(target: ts.Expression, node: ts.Node): boolean {
  if (hasLiteralWords(target)) return true;
  if (!ts.isIdentifier(target)) return false;
  // Resolve a lexical declaration in the closest enclosing scope. Unknown
  // external/generated values are not assumed to be literal vocabulary.
  for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === target.text) {
          return !!declaration.initializer && hasLiteralWords(declaration.initializer);
        }
      }
    }
  }
  return false;
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
  // Structural numeric maps are portion/nutrition knowledge even when the
  // declaration is called just `table` or `lookup`. Trust the declared gate
  // class rather than guessing its domain from an arbitrary variable name.
  if (rule.id !== "17" || rule.kind === "numeric-map") return rule.failureClass;
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

function ruleEvidence(node: ts.Node, source: ts.SourceFile, rule: FoodWaveOneRule): {
  symbol: string; subject: string;
} | null {
  if (rule.kind === "numeric-map") {
    if (ts.isVariableDeclaration(node) && isFoodNumericMapUse(node, source)) {
      return { symbol: node.name.getText(source) + ":numeric-food-map",
        subject: node.initializer!.getText(source) };
    }
    // Avoid evasion by returning an indexed inline numeric object directly.
    if (ts.isElementAccessExpression(node) && node.argumentExpression &&
        isLiteralNumericMap(node.expression) &&
        foodIndexContext(node.argumentExpression, node, source)) {
      return { symbol: "inline-numeric-food-map", subject: node.getText(source) };
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "get" && node.arguments[0] &&
        isLiteralNumericMap(node.expression.expression) &&
        foodIndexContext(node.arguments[0], node, source)) {
      return { symbol: "inline-numeric-food-map", subject: node.getText(source) };
    }
  }
  if (rule.kind === "collection" && ts.isVariableDeclaration(node) &&
    node.initializer && isLiteralCollection(node.initializer)) {
    const symbol = node.name.getText(source);
    const mappedLexicon = rule.id === "11" && isLexicalMap(node.initializer, unwrap) &&
      // The path alone does not make an ordinary UI/status dictionary a food lexicon.
      /food|alimento|lexic|normaliz|language|vocab|synonym|alias/i.test(
        symbol + " " + enclosingDeclaration(node));
    if (rule.id === "17" &&
        (isPresentationOnlyCollection(node, source) ||
          isPresentationOnlyFilter(node, source, unwrap))) return null;
    // Inline food rows are visited separately by isInlineFoodKnowledge.
    // A generic { name: user.name, calories: 100 } collection must not be
    // reclassified as food solely because those two property names coexist.
    if ((matches(rule.symbolPattern, symbol) || mappedLexicon) &&
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
    if (isStaticText(value) && isPresentationOnlyScalar(symbol, value.text, source.fileName) &&
        !isDecisionBearingFoodScalar(node, source)) return null;
    const numericLiteral = staticNutritionNumber(value) !== null;
    const scalarDomain = source.fileName + " " + enclosingDeclaration(node);
    const domainNumericFoodValue = rule.id === "17" && numericFoodField &&
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
        (rule.id === "11" ? channelContext && domainContext :
          rule.id === "17" ? domainContext : materialityDecision) &&
        (rule.id !== "18" || materialityDecision)) {
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
    const relevant = rule.id === "11"
      ? /normaliz|language|lexic|food|aliment|word|term|input|text|token/i.test(context)
      : rule.id === "18"
        ? matches(rule.symbolPattern, context + " " + source.fileName)
        : isFoodDomainSource(source.fileName) || matches(rule.symbolPattern, context);
    if (!unrelated && relevant) {
      return { symbol: (enclosingDeclaration(node) || "expression") + ":lexical-dictionary",
        subject: node.getText(source) + " " + node.expression.getText(source) };
    }
  }
  if (rule.kind === "literal-membership" && ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["includes", "has", "indexOf"].includes(node.expression.name.text) &&
      node.arguments.length > 0 &&
      referencesLiteralWords(node.expression.expression, node)) {
    const context = enclosingDeclaration(node) + " " + node.arguments[0].getText(source);
    const sourceDecision = rule.id === "18" && isFoodDomainSource(source.fileName);
    if (matches(rule.symbolPattern, context) || sourceDecision) {
      return { symbol: (enclosingDeclaration(node) || "expression") + ":lexical-membership",
        subject: node.getText(source) };
    }
  }
  if (rule.kind === "literal-regex-test" && ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) && node.arguments.length > 0 &&
      (/^(?:test|exec)$/.test(node.expression.name.text) &&
        referencesLiteralRegex(node.expression.expression, node) ||
       /^(?:match|matchAll|search)$/.test(node.expression.name.text) &&
        referencesLiteralRegex(node.arguments[0], node))) {
    const regexSource = /^(?:test|exec)$/.test(node.expression.name.text)
      ? node.expression.expression : node.arguments[0];
    const context = enclosingDeclaration(node) + " " + node.arguments[0].getText(source) +
      " " + node.expression.expression.getText(source);
    const sourceDecision = isFoodDomainSource(source.fileName) &&
      hasLexicalVocabularyRegex(regexSource, node);
    // Materiality vocabulary in the registry is evidence for this detector,
    // not a product-level nutrition or identity decision.
    const materialityLexeme = rule.id === "18" && !!rule.evidencePattern &&
      (isFoodDomainSource(source.fileName) ||
        (rule.lexicalEvidencePathPattern !== undefined &&
          matches(rule.lexicalEvidencePathPattern, source.fileName))) &&
      matches(rule.evidencePattern,
        localDecisionEvidence(regexSource, node, source));
    const unrelated = /status|account|permission|role|exercise|activity|workout|fitness|render|display/i
      .test(enclosingDeclaration(node));
    if (!unrelated && (matches(rule.symbolPattern, context) || sourceDecision || materialityLexeme)) {
      return { symbol: (enclosingDeclaration(node) || "expression") + ":lexical-regex",
        subject: node.getText(source) };
    }
  }
  if (rule.kind === "literal-string-method" && ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["includes", "startsWith", "endsWith"].includes(node.expression.name.text) &&
      node.arguments.length === 1 && isStaticText(unwrap(node.arguments[0]))) {
    const literal = (unwrap(node.arguments[0]) as ts.StringLiteral).text;
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
    const relevant = rule.id === "18"
      ? matches(rule.evidencePattern, literal) ||
        /material|qualifier|attribute|packag|commercial/i.test(owner + " " + receiver)
      : rule.id === "11"
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
      if (!namedRule && !(rule.id === "2" &&
          /resolv|select|identify|infer|classif|lookup|match|choose|decid|pick|find/i.test(symbol) &&
          foodBodyDecision)) return null;
      // Account/status resolvers without food-specific decisions stay outside
      // gate 2 even if they have a generic resolver-like name.
      if (rule.id === "2" &&
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
    const relevant = rule.id === "17"
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
      .includes(node.operatorToken.kind) &&
    (isStaticText(node.left) || isStaticText(node.right))) {
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
    const operand = isStaticText(node.left) ? node.right.getText(source) : node.left.getText(source);
    const relevant = rule.id === "17"
      ? matches(rule.symbolPattern, operand) || hasFoodNameDecisionContext(
        isStaticText(node.left) ? node.right : node.left, node, source) ||
        hasGenericFoodIdentityDecisionContext(isStaticText(node.left) ? node.right : node.left, node, source)
      : matches(rule.symbolPattern, functionName) || matches(rule.symbolPattern, operand);
    if (relevant) {
      return { symbol: (functionName || "expression") + ":" + operand + ":lexical-branch",
        subject: node.getText(source) };
    }
  }
  if (rule.kind === "call" && ts.isCallExpression(node)) {
    const symbol = node.expression.getText(source);
    const argumentsText = node.arguments.map(a => a.getText(source)).join(" ");
    const provenance = rule.id === "3" ?
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
  const rules: Array<{ id: FoodWaveOneRuleId; failureClass: FoodFinding["failureClass"] }> =
    foodRows ? [{ id: "17", failureClass: "I" }, { id: "5", failureClass: "C" }] :
      [{ id: "17", failureClass: "A" }];
  if (lexicalRows && channelSource && !rules.some(rule => rule.id === "11")) {
    rules.push({ id: "11", failureClass: "A" });
  }
  return rules.map(rule => ({
    ruleId: rule.id, file: file.path, line: 1,
    symbol: foodRows ? "json-food-catalog" : "json-food-lexicon",
    fingerprint: rule.id + ":" + file.path + ":" +
      (foodRows ? "json-food-catalog:" : "json-food-lexicon:") + digest,
    failureClass: rule.failureClass,
    description: foodRows ? "Catálogo alimentar JSON em fonte produtiva (" + foodRows + " registros)" :
      "Léxico alimentar JSON governável em fonte produtiva (" + lexicalRows + " mapas)",
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
  sync: Set<string>; any: Set<string>;
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
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) &&
          init.expression.text === "require" && init.arguments[0] &&
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
  return { sync, any };
}

function filesystemExpressionName(expression: ts.Node): string {
  if (ts.isIdentifier(expression)) return expression.text;
  // CommonJS supports direct member calls and assignments without an
  // intermediate namespace variable: require("node:fs").readFileSync(...).
  // Only a literal fs provider is trusted, never require(variable) or a
  // similarly named third-party module.
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) &&
      expression.expression.text === "require" && expression.arguments.length === 1 &&
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
  return ts.isCallExpression(provider) && ts.isIdentifier(provider.expression) &&
    provider.expression.text === "require" && provider.arguments.length === 1 &&
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
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
    node.expression.text === "require" && node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0]) && modules.includes(node.arguments[0].text);
  const provider = expression.expression;
  return isRequireOf(provider, ["node:fs/promises", "fs/promises"]) ||
    (ts.isPropertyAccessExpression(provider) && provider.name.text === "promises" &&
      isRequireOf(provider.expression, ["node:fs", "fs"]));
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
  if (!ts.isCallExpression(parsed) || parsed.expression.getText() !== "JSON.parse" ||
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
        read = declaration.initializer ? unwrapAwait(declaration.initializer) : read;
        break;
      }
    }
  }
  if (!ts.isCallExpression(read) ||
      !(bindings.any.has(filesystemExpressionName(read.expression)) ||
        isDirectFilesystemSyncReader(read.expression) ||
        isDirectFilesystemAsyncReader(read.expression)) ||
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
  if (!ts.isCallExpression(node) || node.expression.getText(source) !== "JSON.parse" ||
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
      !(bindings.any.has(filesystemExpressionName(read.expression)) ||
        isDirectFilesystemSyncReader(read.expression) ||
        isDirectFilesystemAsyncReader(read.expression)) ||
      staticFilesystemPath(read.arguments[0]) !== null) return false;
  const decision = enclosingDeclaration(node);
  const pathExpression = read.arguments[0].getText(source);
  if (/account|status|settings|featureflag|permission|admin|exercise|workout|activity/i.test(
    decision + " " + pathExpression)) return false;
  return /food|aliment|meal|nutrition|nutrient|ingredient|portion|porc|serving|recipe|catalog|lexic|alias|material/i.test(
    source.fileName + " " + decision + " " + pathExpression);
}

function isOpaqueFoodDynamicImport(node: ts.Node, source: ts.SourceFile): boolean {
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword ||
      !node.arguments[0] || isStaticText(unwrap(node.arguments[0]))) return false;
  const decision = enclosingDeclaration(node);
  const dynamicPath = node.arguments[0].getText(source);
  return /food|aliment|meal|nutrition|nutrient|ingredient|portion|porc|serving|recipe|catalog|lexic|alias|material/i.test(
    source.fileName + " " + decision + " " + dynamicPath) &&
    !/account|status|settings|featureflag|permission|admin|exercise|workout|activity/i.test(
      decision + " " + dynamicPath);
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
            !isLiteralNumericMap(declaration.initializer)) continue;
        const record = { symbol: declaration.name.text, source: declaration.initializer.getText(source) };
        localNumericMaps.set(declaration.name.text, record);
        if (isExported) maps.set(declaration.name.text, record);
      }
    }
    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        const value = unwrap(statement.expression);
        const record = ts.isIdentifier(value) ? localNumericMaps.get(value.text) :
          isLiteralNumericMap(value) ? { symbol: "default", source: value.getText(source) } : undefined;
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
        for (const ruleId of ["17", "5"] as const) {
          const symbol = "imported-numeric-food-map:" + reference.file + "#" + reference.declaration.symbol;
          results.push({
            ruleId, file: consumer.path,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            symbol, fingerprint: ruleId + ":" + consumer.path + ":" + symbol + ":" + stableHash(subject),
            failureClass: "C", description: "Mapa numerico de alimento/porcao vindo de outro modulo",
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { findings: results, foodIndexedJson };
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
    const addDependency = (specifier: string, importSource = ""): void => {
      for (const candidate of resolveRuntimeDependencies(file.path, specifier, indexed)) {
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
            (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        addDependency(node.arguments[0].text, node.getText(source));
      }
      if (ts.isCallExpression(node) &&
          (filesystemBindings.any.has(filesystemExpressionName(node.expression)) ||
            isDirectFilesystemSyncReader(node.expression) ||
            isDirectFilesystemAsyncReader(node.expression)) &&
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
    const imports = new Map<string, string[]>();
    for (const statement of source.statements) {
      let specifier: string | undefined;
      let binding: string | undefined;
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
          !statement.importClause?.isTypeOnly && statement.importClause?.name) {
        specifier = statement.moduleSpecifier.text;
        binding = statement.importClause.name.text;
      } else if (ts.isVariableStatement(statement)) {
        const declaration = statement.declarationList.declarations[0];
        if (declaration && ts.isIdentifier(declaration.name) && declaration.initializer &&
            ts.isCallExpression(declaration.initializer) &&
            ts.isIdentifier(declaration.initializer.expression) &&
            declaration.initializer.expression.text === "require" &&
            declaration.initializer.arguments[0] &&
            ts.isStringLiteral(declaration.initializer.arguments[0])) {
          specifier = declaration.initializer.arguments[0].text;
          binding = declaration.name.text;
        }
      }
      if (specifier && binding) {
        const targets = resolveRuntimeDependencies(consumer.path, specifier, indexed)
          .filter(target => /\.json$/i.test(target));
        if (targets.length) imports.set(binding, targets);
      }
    }
    if (imports.size === 0) continue;
    // AUD1300-F02: trace immutable aliases and transforms before the decision,
    // including .map()/.reduce(); module and local bindings must not be confused.
    const resolveJsonBinding = (
      name: string, use: ts.Node, seen = new Set<ts.VariableDeclaration>(), depth = 0,
    ): string[] => {
      if (depth > 12) return [];
      for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
        if ((ts.isFunctionDeclaration(scope) || ts.isMethodDeclaration(scope) ||
            ts.isArrowFunction(scope) || ts.isFunctionExpression(scope)) &&
            scope.parameters.some(parameter =>
              ts.isIdentifier(parameter.name) && parameter.name.text === name)) return [];
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
            if (!decl.initializer || seen.has(decl) ||
                decl.getStart(source) >= use.getStart(source)) return [];
            seen.add(decl);
            let origin: ts.Expression = decl.initializer;
            let originNode: ts.Node = decl;
            // AUD1300-20261015-F02: a mutable alias can cease to refer to the
            // imported JSON. Follow its last unconditional, top-level write
            // before this consumption, rather than trusting the initializer.
            const declarationList = decl.parent;
            if (ts.isVariableDeclarationList(declarationList) &&
                !(declarationList.flags & ts.NodeFlags.Const)) {
              for (const next of scope.statements) {
                if (next.getStart(source) <= decl.getStart(source) ||
                    next.getEnd() > use.getStart(source)) continue;
                if (!ts.isExpressionStatement(next) ||
                    !ts.isBinaryExpression(next.expression) ||
                    next.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
                    !ts.isIdentifier(next.expression.left) ||
                    next.expression.left.text !== name) continue;
                origin = next.expression.right;
                originNode = next.expression.right;
              }
            }
            const value = unwrap(origin);
            if (ts.isIdentifier(value)) return resolveJsonBinding(value.text, originNode, seen, depth + 1);
            if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
                /^(?:map|flatMap|filter|slice|reduce)$/.test(value.expression.name.text) &&
                ts.isIdentifier(value.expression.expression)) {
              return resolveJsonBinding(value.expression.expression.text, originNode, seen, depth + 1);
            }
            return [];
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
      if (unrelatedDecision.test(declaration)) return false;
      return foodDomain.test(consumer.path) &&
        !unrelatedDecision.test(consumer.path);
    };
    const isJsonIdentityDecision = (predicate: string, receiver?: string): boolean => {
      const identity = "(?:name|label|slug|nome|foodName|foodId|alimento|productName)";
      const bound = receiver
        ? "\\b" + receiver.replace(/[^A-Za-z0-9_]/g, "\\$&") + "\\s*"
        : "[A-Za-z_$][\\w$]*\\s*";
      const fieldAccess = new RegExp(bound +
        "(?:\\.\\s*" + identity + "\\b|\\[\\s*['\"]" + identity + "['\"]\\s*\\])");
      return fieldAccess.test(predicate) &&
        /===?|!==?|\.includes\s*\(|\.startsWith\s*\(|\.endsWith\s*\(/.test(predicate);
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
    const visitJsonUse = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          /^(?:find|filter|some|map|reduce|forEach|every)$/.test(node.expression.name.text) &&
          ts.isIdentifier(node.expression.expression) && node.arguments[0]) {
        const targets = resolveJsonBinding(node.expression.expression.text, node);
        if (targets.length) {
          const predicateNode = node.arguments[0];
          const callback = resolveJsonCallback(predicateNode, node);
          const predicate = callback?.getText(source) ?? predicateNode.getText(source);
          const destructured = callback && callback.parameters[0] &&
            isDestructuredJsonIdentityDecision(callback.parameters[0].name, callback.body ?? callback);
          const foodDecision = foodJsonDecisionContext(node) &&
            (isJsonIdentityDecision(predicate) || !!destructured);
          if (foodDecision) for (const target of targets) jsonRecordsConsumedByFood.add(target);
        }
      }
      // A loop deciding from a JSON row is equivalent to .find/.some. Without
      // this edge an anonymous name+calories catalog escapes gate 17/5.
      if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
        const declaration = node.initializer.declarations[0];
        const iterated = unwrap(node.expression);
        const collection = ts.isIdentifier(iterated) ? iterated :
          ts.isCallExpression(iterated) && ts.isPropertyAccessExpression(iterated.expression) &&
          /^(?:map|filter|flatMap|slice)$/.test(iterated.expression.name.text) &&
          ts.isIdentifier(iterated.expression.expression) ? iterated.expression.expression : null;
        const identityUse = declaration && (ts.isIdentifier(declaration.name)
          ? isJsonIdentityDecision(node.statement.getText(source), declaration.name.text)
          : isDestructuredJsonIdentityDecision(declaration.name, node.statement));
        if (collection && declaration && foodJsonDecisionContext(node) && identityUse) {
          for (const target of resolveJsonBinding(collection.text, node)) {
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
  for (const file of files) {
    if (!runtime.has(file.path.replace(/\\/g, "/"))) continue;
    if (/\.json$/i.test(file.path)) {
      results.push(...findJsonFoodCatalog(file,
        [...(importerContext.get(file.path) ?? [])].join(" "),
        importedNumericMaps.foodIndexedJson.has(file.path.replace(/\\/g, "/")),
        jsonRecordsConsumedByFood.has(file.path.replace(/\\/g, "/"))));
      continue;
    }
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    const filesystemBindings = filesystemReadBindings(source);
    function visit(node: ts.Node): void {
      if (isOpaqueFoodJsonLoad(node, source, filesystemBindings) ||
          isOpaqueFoodDynamicImport(node, source)) {
        const symbol = "opaque-runtime-food-data-load";
        results.push({
          ruleId: "17", file: file.path,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          symbol,
          fingerprint: "17:" + file.path + ":" + symbol + ":" + stableHash(node.getText(source)),
          failureClass: "I",
          description: "Fonte alimentar dinamica em runtime sem prova estatica do catalogo",
        });
      }
      for (const rule of FOOD_WAVE_ONE_RULES) {
        // New channel names must never bypass the single food decision owner.
        const ownerDeclaration = (rule.id === "1" || rule.id === "2") &&
          rule.kind === "function";
        // Exemption is the currently published owner contract, not a folder
        // or an arbitrary version name. New V1/V2/V3 resolver entrypoints must
        // be audited even if colocated with Food Intelligence modules.
        const canonicalOwner = file.path === "server/foodItemResolution.ts" &&
          ts.isFunctionDeclaration(node) &&
          node.name?.text === "resolveCanonicalFoodQuantity";
        if (ownerDeclaration ? canonicalOwner : !matches(rule.pathPattern, file.path)) continue;
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
  results.push(...importedNumericMaps.findings);
  results.push(...findImportedLexicalFoodFindings(files, runtime, indexed, resolveRuntimeDependencies, stableHash));
  results.push(...findTransitiveAlternativeResolverFindings(
    dependencyGraph, runtime, isProductionFoodSource, stableHash,
  ));
  return results.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}

type FoodOwnerFunction = "lexical-knowledge" | "attribute-materiality" |
  "portion-knowledge" | "food-knowledge" | "food-resolution" |
  "decision-roundtrip" | "nutrition-source-selection";

function ownerFunction(finding: FoodFinding): FoodOwnerFunction {
  if (finding.ruleId === "18") return "attribute-materiality";
  if (finding.ruleId === "11") return "lexical-knowledge";
  if (finding.ruleId === "3") return "decision-roundtrip";
  if (finding.ruleId === "4") return "nutrition-source-selection";
  if (["1", "2", "10"].includes(finding.ruleId)) return "food-resolution";
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
  return findFoodStaticCandidates(files).filter(finding => finding.ruleId !== "11" && finding.ruleId !== "18");
}
