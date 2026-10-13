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
  return (hasNamedFood || hasFoodIdentifier) && (hasLiteralNutrition || hasNestedLiteralNutrition);
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

function isPresentationOnlyCollection(symbol: string): boolean {
  // Food-related UI navigation is not food knowledge or a nutritional decision.
  return /(?:^|[_-])(?:tabs?|columns?|headers?|menus?|navigation|buttons?|icons?|styles?|statuses?|badges?|toasts?)(?:$|[_-])|(?:Tabs?|Columns?|Headers?|Menus?|Styles?)$/i.test(symbol);
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

function ruleEvidence(node: ts.Node, source: ts.SourceFile, rule: FoodWaveOneRule): {
  symbol: string; subject: string;
} | null {
  if (rule.kind === "collection" && ts.isVariableDeclaration(node) &&
    node.initializer && isLiteralCollection(node.initializer)) {
    const symbol = node.name.getText(source);
    const mappedLexicon = rule.id === "11" && isLexicalMap(node.initializer) &&
      // The path alone does not make an ordinary UI/status dictionary a food lexicon.
      /food|alimento|lexic|normaliz|language|vocab|synonym|alias/i.test(
        symbol + " " + enclosingDeclaration(node));
    if (rule.id === "17" && isPresentationOnlyCollection(symbol)) return null;
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
    if (ts.isStringLiteral(value) && isPresentationOnlyScalar(symbol, value.text, source.fileName)) return null;
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
      referencesLiteralWords(node.expression.expression, node)) {
    const context = enclosingDeclaration(node) + " " + node.arguments[0].getText(source);
    if (matches(rule.symbolPattern, context)) {
      return { symbol: (enclosingDeclaration(node) || "expression") + ":lexical-membership",
        subject: node.getText(source) };
    }
  }
  if (rule.kind === "literal-regex-test" && ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "test" &&
      node.arguments.length > 0 && referencesLiteralRegex(node.expression.expression, node)) {
    const context = enclosingDeclaration(node) + " " + node.arguments[0].getText(source);
    if (matches(rule.symbolPattern, context)) {
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
    const relevant = rule.id === "17"
      ? matches(rule.symbolPattern, operand) || hasFoodNameDecisionContext(
        ts.isStringLiteral(node.left) ? node.right : node.left, node, source)
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

export function findFoodStaticCandidates(files: FoodArchitectureFile[]): FoodFinding[] {
  const results: FoodFinding[] = [];
  // Preserve multiplicity: adding an identical rule in another scope is still new.
  // A fixture or generated TS module imported by production must not escape
  // the gate solely because it lives under a normally excluded folder.
  const indexed = new Map(files.map(file => [file.path.replace(/\\/g, "/"), file]));
  const runtime = new Set(files.filter(file => isProductionFoodSource(file.path))
    .map(file => file.path.replace(/\\/g, "/")));
  const importerContext = new Map<string, Set<string>>();
  const queue = [...runtime];
  for (let i = 0; i < queue.length; i++) {
    const file = indexed.get(queue[i]);
    if (!file) continue;
    if (/\.json$/i.test(file.path)) continue;
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
      const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
      const candidates = [
        base,
        ...extensions.map(extension => base + extension),
        ...extensions.map(extension => base + "/index" + extension),
      ];
      for (const candidate of candidates) {
        if (!indexed.has(candidate)) continue;
        const contexts = importerContext.get(candidate) ?? new Set<string>();
        contexts.add(file.path + " " + [...(importerContext.get(file.path) ?? [])].join(" "));
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
    if (/\.json$/i.test(file.path)) {
      results.push(...findJsonFoodCatalog(file,
        [...(importerContext.get(file.path) ?? [])].join(" ")));
      continue;
    }
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
