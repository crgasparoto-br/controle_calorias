/**
 * Static, AST-backed Food Intelligence V2 architecture discovery (ADR §19).
 * Do not confuse a candidate with a proven behavioral violation: the wave-one
 * registry blocks NEW findings after item 25 approval; existing legacy stays visible.
 */
import ts from "typescript";
import path from "node:path";
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
        return nutrientValue && (ts.isNumericLiteral(nutrientValue) ||
          (ts.isPrefixUnaryExpression(nutrientValue) && ts.isNumericLiteral(nutrientValue.operand)));
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
      return value !== undefined && (ts.isNumericLiteral(value) ||
        (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)));
    });
  const hasNestedLiteralNutrition = ["macros", "nutrition", "nutrients"].some(key => {
    const block = fields.get(key);
    return block && ts.isObjectLiteralExpression(block) && block.properties.some(property => {
      if (!ts.isPropertyAssignment(property)) return false;
      const name = property.name.getText().replace(/^['"]|['"]$/g, "").toLowerCase();
      const value = unwrap(property.initializer);
      return /^(?:calories|kcal|protein|carbs|fat|energykcal)$/.test(name) &&
        (ts.isNumericLiteral(value) ||
          (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)));
    });
  });
  return ((hasNamedFood || hasFoodIdentifier) &&
    (hasLiteralNutrition || hasNestedLiteralNutrition)) ||
    isAnonymousFoodNutrition(node, fields, enclosingDeclaration, unwrap);
}

/** Domain-driven numeric maps need evidence of food identity, not food words
 * inside their arbitrary keys. Reuse the same rule for collections and lookups. */
function isLiteralNumericMap(value: ts.Expression): boolean {
  const object = unwrap(value);
  if (ts.isNewExpression(object) && ts.isIdentifier(object.expression) &&
      object.expression.text === "Map" && object.arguments?.length === 1) {
    const entries = unwrap(object.arguments[0]);
    return ts.isArrayLiteralExpression(entries) && entries.elements.length > 0 &&
      entries.elements.every(entry => {
        const pair = unwrap(entry);
        if (!ts.isArrayLiteralExpression(pair) || pair.elements.length !== 2) return false;
        const key = unwrap(pair.elements[0]);
        const number = unwrap(pair.elements[1]);
        return (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
          (ts.isNumericLiteral(number) ||
            (ts.isPrefixUnaryExpression(number) && ts.isNumericLiteral(number.operand)));
      });
  }
  return ts.isObjectLiteralExpression(object) && object.properties.length > 0 &&
    object.properties.every(property => {
      if (!ts.isPropertyAssignment(property)) return false;
      if (!ts.isIdentifier(property.name) &&
          !ts.isStringLiteral(property.name) &&
          !ts.isNumericLiteral(property.name)) return false;
      const numeric = unwrap(property.initializer);
      return ts.isNumericLiteral(numeric) ||
        (ts.isPrefixUnaryExpression(numeric) &&
          ts.isNumericLiteral(numeric.operand));
    });
}

function foodIndexContext(index: ts.Expression, node: ts.Node, source: ts.SourceFile): boolean {
  const name = index.getText(source);
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

function referencesLiteralRegex(target: ts.Expression, node: ts.Node): boolean {
  if (hasLiteralRegex(target)) return true;
  if (!ts.isIdentifier(target)) return false;
  for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === target.text) {
          return !!declaration.initializer && hasLiteralRegex(declaration.initializer);
        }
      }
    }
  }
  return false;
}


/**
 * A comparison of item.name may be a food/portion decision even when neither
 * "item" nor "name" contains "food". Require independently observable domain
 * context; generic usernames, account labels and status checks stay outside.
 */
function hasFoodNameDecisionContext(operand: ts.Expression, node: ts.Node, source: ts.SourceFile): boolean {
  const field = ts.isPropertyAccessExpression(operand) ? operand.name.text :
    ts.isElementAccessExpression(operand) && operand.argumentExpression &&
    ts.isStringLiteral(operand.argumentExpression) ? operand.argumentExpression.text : "";
  if (!/^(?:name|label|title)$/i.test(field)) return false;
  const receiver = ts.isPropertyAccessExpression(operand) || ts.isElementAccessExpression(operand)
    ? operand.expression.getText(source) : "";
  const owner = receiver.split(".")[0].toLowerCase();
  if (/^(?:user|account|profile|customer|member|admin)$/.test(owner)) return false;

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

function isFoodDomainSource(file: string): boolean {
  return /food|aliment|nutrition|nutrient|meal|ingredient|portion|porc|serving|product|materiality/i.test(file);
}

/**
 * A regex used to make a lexical decision may be anonymous (e.g. decide(value)).
 * Limit path-based inference to literal word alternatives or word-boundary terms;
 * numeric/input-format regexes in food modules are not food attributes.
 */
function hasLexicalVocabularyRegex(target: ts.Expression, node: ts.Node): boolean {
  const literalPattern = (value: ts.Expression): string | null => {
    const expr = unwrap(value);
    if (ts.isRegularExpressionLiteral(expr)) return expr.getText();
    if (ts.isNewExpression(expr) && expr.expression.getText() === "RegExp" &&
        expr.arguments?.length && ts.isStringLiteral(unwrap(expr.arguments[0]))) {
      return (unwrap(expr.arguments[0]) as ts.StringLiteral).text;
    }
    return null;
  };
  let pattern = literalPattern(target);
  if (pattern === null && ts.isIdentifier(target)) {
    for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === target.text && decl.initializer) {
            pattern = literalPattern(decl.initializer);
          }
        }
      }
      if (pattern !== null) break;
    }
  }
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
  if (rule.id !== "17") return rule.failureClass;
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
    if (isStaticText(value) && isPresentationOnlyScalar(symbol, value.text, source.fileName)) return null;
    const numericLiteral = ts.isNumericLiteral(value) ||
      (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand));
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
    const number = expression && unwrap(expression);
    if (number && (ts.isNumericLiteral(number) ||
        ts.isPrefixUnaryExpression(number) && ts.isNumericLiteral(number.operand))) {
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
          return { symbol: functionName + ":numeric-return", subject: number.getText(source) };
        }
      }
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
      ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "test" &&
      node.arguments.length > 0 && referencesLiteralRegex(node.expression.expression, node)) {
    const context = enclosingDeclaration(node) + " " + node.arguments[0].getText(source);
    const sourceDecision = rule.id === "18" && isFoodDomainSource(source.fileName) &&
      hasLexicalVocabularyRegex(node.expression.expression, node);
    if (matches(rule.symbolPattern, context) || sourceDecision) {
      return { symbol: (enclosingDeclaration(node) || "expression") + ":lexical-regex",
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
    const symbol = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
      ? node.name?.getText(source)
      : ts.isVariableDeclaration(node) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
          ? node.name.getText(source) : undefined;
    if (symbol && matches(rule.symbolPattern, symbol)) {
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
        hasFoodNameDecisionContext(branch.expression, node, source)
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
        isStaticText(node.left) ? node.right : node.left, node, source)
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
function findJsonFoodCatalog(file: FoodArchitectureFile, consumerEvidence = ""): FoodFinding[] {
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
        lexicalDomain) {
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
      entries.every(([key, entry]) => key.trim().length > 0 &&
        typeof entry === "number" && Number.isFinite(entry)) &&
      /(?:food|alimento).*(?:portion|porc|serving|gram|macro|nutri|catalog)|(?:portion|porc|serving|gram|macro|nutri|catalog).*(?:food|alimento)/i.test(context + " " + consumerEvidence) &&
      !/(?:config|settings|preferences|options)\.json$/i.test(file.path);
    if (foodNumericMap) foodRows++;
    if ((explicitIdentity || genericIdentity) &&
        (specificNutrition || nestedNutrition || governedAttributes ||
          (genericCalories && (explicitIdentity || foodSource)))) foodRows++;
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
  if (isStaticText(value)) return value.text;
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
    return path.posix.join(...literal);
  }
  return null;
}

/** Follow named exported numeric dictionaries into a food-domain consumer. */
function findCrossModuleNumericFoodMaps(
  files: FoodArchitectureFile[], runtime: Set<string>,
  indexed: Map<string, FoodArchitectureFile>,
): FoodFinding[] {
  type ExportedMap = { symbol: string; source: string };
  const exported = new Map<string, Map<string, ExportedMap>>();
  for (const file of files) {
    if (!runtime.has(file.path.replace(/\\/g, "/")) || /\.json$/i.test(file.path)) continue;
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
    if (maps.size) exported.set(file.path, maps);
  }
  const results: FoodFinding[] = [];
  for (const consumer of files) {
    if (!runtime.has(consumer.path.replace(/\\/g, "/")) || /\.json$/i.test(consumer.path)) continue;
    const source = ts.createSourceFile(consumer.path, consumer.content, ts.ScriptTarget.Latest, true);
    const imports = new Map<string, { file: string; declaration: ExportedMap }>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          statement.importClause?.isTypeOnly) continue;
      const bindings = statement.importClause?.namedBindings;
      for (const dependency of resolveRuntimeDependencies(
        consumer.path, statement.moduleSpecifier.text, indexed)) {
        const maps = exported.get(dependency);
        if (!maps) continue;
        if (statement.importClause?.name) {
          const match = maps.get("default");
          if (match) imports.set(statement.importClause.name.text,
            { file: dependency, declaration: match });
        }
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const specifier of bindings.elements) {
          if (specifier.isTypeOnly) continue;
          const match = maps.get(specifier.propertyName?.text ?? specifier.name.text);
          if (match) imports.set(specifier.name.text, { file: dependency, declaration: match });
        }
      }
    }
    if (!imports.size) continue;
    // Common aliases must not allow a consumer to hide the imported dictionary.
    const collectAliases = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
          node.initializer && ts.isIdentifier(unwrap(node.initializer))) {
        const parent = imports.get((unwrap(node.initializer) as ts.Identifier).text);
        if (parent) imports.set(node.name.text, parent);
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(source);
    const visit = (node: ts.Node): void => {
      let localName: string | undefined;
      let index: ts.Expression | undefined;
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
        localName = node.expression.text;
        index = node.argumentExpression;
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "get" && ts.isIdentifier(node.expression.expression)) {
        localName = node.expression.expression.text;
        index = node.arguments[0];
      }
      const reference = localName ? imports.get(localName) : undefined;
      if (reference && index && foodIndexContext(index, node, source)) {
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
  return results;
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
      if (ts.isCallExpression(node) && node.arguments.length > 0 &&
          ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        addDependency(node.arguments[0].text, node.getText(source));
      }
      if (ts.isCallExpression(node) &&
          /^(?:readFileSync|readFile|fs\.readFileSync|fs\.readFile|fs\.promises\.readFile)$/.test(node.expression.getText(source)) &&
          node.arguments[0]) {
        const staticPath = staticFilesystemPath(node.arguments[0]);
        if (staticPath) addDependency(staticPath, node.getText(source));
      }
      ts.forEachChild(node, follow);
    };
    ts.forEachChild(source, follow);
  }
  for (const file of files) {
    if (!runtime.has(file.path.replace(/\\/g, "/"))) continue;
    if (/\.json$/i.test(file.path)) {
      results.push(...findJsonFoodCatalog(file,
        [...(importerContext.get(file.path) ?? [])].join(" ")));
      continue;
    }
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      for (const rule of FOOD_WAVE_ONE_RULES) {
        // New channel names must never bypass the single food decision owner.
        const ownerDeclaration = (rule.id === "1" || rule.id === "2") &&
          rule.kind === "function";
        const canonicalOwner = /^server\/(?:foodItemResolution\.[cm]?[jt]sx?|modules\/foodIntelligenceV[0-9]+\/)/i
          .test(file.path);
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
  results.push(...findCrossModuleNumericFoodMaps(files, runtime, indexed));
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
