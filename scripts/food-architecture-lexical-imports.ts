/**
 * ADR Food Intelligence V2 wave one: resolve generic lexical tables from their
 * productive decision use, rather than guessing food knowledge from file names.
 * All candidates are static data; no food vocabulary is embedded in the gate.
 */
import ts from "typescript";
import type { FoodArchitectureFile, FoodFinding } from "./food-intelligence-architecture";

type LexicalTable = { file: string; symbol: string; content: string };
type ModuleTables = { locals: Map<string, LexicalTable>; exports: Map<string, LexicalTable> };
type ResolveDeps = (from: string, specifier: string, indexed: Map<string, FoodArchitectureFile>) => string[];

function unwrap(value: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) ||
         ts.isSatisfiesExpression(value)) value = value.expression;
  return value;
}

function lexicalLiteral(value: ts.Expression): boolean {
  const expr = unwrap(value);
  const text = (v: ts.Node) => ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v);
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.length > 0 && expr.elements.every(element => text(unwrap(element)));
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.length > 0 && expr.properties.every(property =>
      ts.isPropertyAssignment(property) && text(unwrap(property.initializer)));
  }
  if (ts.isNewExpression(expr) && /^(?:Set|Map)$/.test(expr.expression.getText()) &&
      expr.arguments?.length === 1 && ts.isArrayLiteralExpression(unwrap(expr.arguments[0]))) {
    const values = unwrap(expr.arguments[0]) as ts.ArrayLiteralExpression;
    if (expr.expression.getText() === "Set") {
      return values.elements.length > 0 && values.elements.every(element => text(unwrap(element)));
    }
    return values.elements.length > 0 && values.elements.every(element => {
      const pair = unwrap(element);
      return ts.isArrayLiteralExpression(pair) && pair.elements.length === 2 &&
        pair.elements.every(item => text(unwrap(item)));
    });
  }
  return false;
}

/** A declaration in a shared module becomes food lexicon only at a real
 * consuming food decision, not from its generic identifier or contents. */
export function findImportedLexicalFoodFindings(
  files: FoodArchitectureFile[], runtime: Set<string>,
  indexed: Map<string, FoodArchitectureFile>, resolveDeps: ResolveDeps,
  stableHash: (text: string) => string,
): FoodFinding[] {
  const modules = new Map<string, ModuleTables>();
  const sourceOf = (file: FoodArchitectureFile) =>
    ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  for (const file of files) {
    if (!runtime.has(file.path.replace(/\\/g, "/")) || /\.json$/i.test(file.path)) continue;
    const source = sourceOf(file);
    const locals = new Map<string, LexicalTable>(), exports = new Map<string, LexicalTable>();
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const published = statement.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer ||
            !lexicalLiteral(declaration.initializer)) continue;
        const symbol = declaration.name.text;
        const table = { file: file.path, symbol, content: declaration.initializer.getText(source) };
        locals.set(symbol, table);
        if (published) exports.set(symbol, table);
      }
    }
    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        const value = unwrap(statement.expression);
        const table = ts.isIdentifier(value) ? locals.get(value.text) :
          lexicalLiteral(value) ? {file:file.path,symbol:"default",content:value.getText(source)} : undefined;
        if (table) exports.set("default", table);
      }
    }
    modules.set(file.path, { locals, exports });
  }

  // Named and star reexports are resolved to their original source, including
  // barrels; type-only reexports are not runtime links.
  for (let pass = 0; pass < files.length; pass++) {
    let changed = false;
    for (const file of files) {
      const module = modules.get(file.path);
      if (!module) continue;
      const source = sourceOf(file);
      for (const stmt of source.statements) {
        if (!ts.isExportDeclaration(stmt) || stmt.isTypeOnly) continue;
        const targets = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? resolveDeps(file.path, stmt.moduleSpecifier.text, indexed)
            .map(dep => modules.get(dep)?.exports).filter((m): m is Map<string, LexicalTable> => !!m)
          : [module.locals];
        for (const table of targets) {
          if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
            for (const spec of stmt.exportClause.elements) {
              if (spec.isTypeOnly || module.exports.has(spec.name.text)) continue;
              const found = table.get(spec.propertyName?.text ?? spec.name.text);
              if (found) { module.exports.set(spec.name.text, found); changed = true; }
            }
          } else if (!stmt.exportClause && stmt.moduleSpecifier) {
            for (const [name, found] of table) {
              if (name !== "default" && !module.exports.has(name)) {
                module.exports.set(name, found); changed = true;
              }
            }
          }
        }
      }
    }
    if (!changed) break;
  }

  const findings: FoodFinding[] = [];
  for (const file of files) {
    if (!modules.has(file.path)) continue;
    const source = sourceOf(file);
    const imports = new Map<string, LexicalTable>();
    for (const stmt of source.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) ||
          stmt.importClause?.isTypeOnly) continue;
      const dependencies = resolveDeps(file.path, stmt.moduleSpecifier.text, indexed);
      for (const dependency of dependencies) {
        const available = modules.get(dependency)?.exports;
        if (!available) continue;
        const clause = stmt.importClause;
        if (clause?.name && available.has("default")) imports.set(clause.name.text, available.get("default")!);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            if (element.isTypeOnly) continue;
            const table = available.get(element.propertyName?.text ?? element.name.text);
            if (table) imports.set(element.name.text, table);
          }
        }
      }
    }
    const binding = (name: string, use: ts.Node, seen = new Set<ts.VariableDeclaration>()): LexicalTable | undefined => {
      for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
        if ((ts.isFunctionDeclaration(scope) || ts.isArrowFunction(scope) ||
             ts.isMethodDeclaration(scope) || ts.isFunctionExpression(scope)) &&
            scope.parameters.some(param => ts.isIdentifier(param.name) && param.name.text === name)) return undefined;
        if (!ts.isSourceFile(scope) && !ts.isBlock(scope)) continue;
        for (const stmt of scope.statements) {
          if (!ts.isVariableStatement(stmt)) continue;
          for (const decl of stmt.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
            if (seen.has(decl) || !decl.initializer) return undefined;
            seen.add(decl);
            if (lexicalLiteral(decl.initializer)) return {
              file: file.path, symbol: name, content: decl.initializer.getText(source),
            };
            const expr = unwrap(decl.initializer);
            return ts.isIdentifier(expr) ? binding(expr.text, decl, seen) : undefined;
          }
        }
      }
      return imports.get(name);
    };
    const owner = (node: ts.Node): string => {
      for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
        if (ts.isFunctionDeclaration(scope) || ts.isMethodDeclaration(scope)) return scope.name?.getText(source) ?? "";
        if ((ts.isArrowFunction(scope) || ts.isFunctionExpression(scope)) &&
            scope.parent && ts.isVariableDeclaration(scope.parent)) return scope.parent.name.getText(source);
      }
      return "";
    };
    const visit = (node: ts.Node): void => {
    // AUD1300-F01: imported lexical tables consumed via Object.entries/keys
    // must not evade the food/materiality gate just because the consumer does
    // not call includes() on the table itself. Use the resolved source binding.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(source) === "Object" &&
        /^(?:entries|keys|values)$/.test(node.expression.name.text) &&
        node.arguments.length === 1 && ts.isIdentifier(node.arguments[0])) {
      const table = binding(node.arguments[0].text, node);
      // Ordinary local loops are covered by lexical-lookup; local iterator
      // predicates are not, so share this decision sink for both origins.
      const predicateMethod = ts.isPropertyAccessExpression(node.parent) &&
        /^(?:find|some|filter|every)$/.test(node.parent.name.text) &&
        ts.isCallExpression(node.parent.parent);
      if (table && (table.file !== file.path || predicateMethod)) {
        const functionName = owner(node);
        const domain = file.path + " " + functionName;
        const food = /food|aliment|nutrition|nutrient|meal|ingredient|portion|porc|serving|material|qualifier|attribute/i.test(domain);
        const decision = /classif|resolv|decid|normaliz|parse|match|identif|lookup|infer|select|find|detect|material|qualif/i.test(functionName);
        const unrelated = /account|status|permission|role|exercise|activity|workout|fitness|navigation|render|display/i.test(functionName);
        const method = node.expression.name.text;
        let meaningfulUse = false;
        const iterator = node.parent;
        if (ts.isForOfStatement(iterator) && ts.isVariableDeclarationList(iterator.initializer)) {
          const name = iterator.initializer.declarations[0]?.name;
          const key = name && ts.isArrayBindingPattern(name) && method === "entries"
            ? name.elements[0]?.name : name;
          const word = key && ts.isIdentifier(key) ? key.text : "";
          if (word) {
            const scanDecision = (candidate: ts.Node): void => {
              if (ts.isBinaryExpression(candidate) &&
                  [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
                    ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]
                    .includes(candidate.operatorToken.kind) &&
                  ((ts.isIdentifier(candidate.left) && candidate.left.text === word) ||
                   (ts.isIdentifier(candidate.right) && candidate.right.text === word))) meaningfulUse = true;
              if (ts.isCallExpression(candidate) && ts.isPropertyAccessExpression(candidate.expression) &&
                  /^(?:includes|startsWith|endsWith|match|indexOf|replace|replaceAll)$/.test(candidate.expression.name.text) &&
                  candidate.arguments.some(arg => ts.isIdentifier(arg) && arg.text === word)) meaningfulUse = true;
              ts.forEachChild(candidate, scanDecision);
            };
            scanDecision(iterator.statement);
          }
        }
        // Object.entries(vocab).reduce((value, [from, to]) =>
        //   value.replaceAll(from, to), input) is also a food decision.
        if (ts.isPropertyAccessExpression(iterator) &&
            iterator.name.text === "reduce" && ts.isCallExpression(iterator.parent)) {
          const callback = iterator.parent.arguments[0];
          if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
            const tuple = callback.parameters[1]?.name;
            const key = tuple && ts.isArrayBindingPattern(tuple) ? tuple.elements[0]?.name : undefined;
            const word = key && ts.isIdentifier(key) ? key.text : "";
            meaningfulUse = !!word && new RegExp(
              "\\.(?:replace|replaceAll|includes|startsWith|endsWith|indexOf)\\s*\\(\\s*" + word + "\\b"
            ).test(callback.body.getText(source));
          }
        }
        if (ts.isPropertyAccessExpression(iterator) &&
            /^(?:find|some|filter|every)$/.test(iterator.name.text) &&
            ts.isCallExpression(iterator.parent)) {
          const cb = iterator.parent.arguments[0];
          if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
            const first = cb.parameters[0]?.name;
            const candidate = first && method === "entries" && ts.isArrayBindingPattern(first)
              ? first.elements[0]?.name : first && ts.isIdentifier(first) ? first : undefined;
            const name = candidate && ts.isIdentifier(candidate) ? candidate.text : "";
            const code = cb.body.getText(source);
            if (name) {
              const compare = new RegExp("\\b" + name + "\\s*(?:===?|!==?)|(?:===?|!==?)\\s*\\b" + name + "\\b");
              const textDecision = new RegExp("\\.(?:includes|startsWith|endsWith|match|indexOf|replace|replaceAll)\\s*\\(\\s*" + name + "\\b");
              meaningfulUse = compare.test(code) || textDecision.test(code);
            }
          }
        }
        if (!unrelated && food && decision && meaningfulUse) {
          const materiality = /material|neutral|attribute|qualifier|packag|commercial/i.test(domain);
          const channel = /whatsapp|inbound|audio|image|ocr|transcri/i.test(file.path);
          const ruleId = materiality ? "18" : channel ? "11" : "17";
          const symbol = "consumed-lexical-table:" + table.file + "#" + table.symbol;
          findings.push({
            ruleId, file: file.path,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            symbol,
            fingerprint: ruleId + ":" + file.path + ":" + symbol + ":" +
              stableHash(table.content + ":" + node.getText(source) + ":" +
                (ts.isForOfStatement(iterator) ? iterator.statement.getText(source) : iterator.getText(source))),
            failureClass: materiality ? "B" : "A",
            description: "Vocabulário lexical importado usado em iteração decisória alimentar",
          });
        }
      }
    }

      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          /^(?:includes|has|indexOf|some|find|filter)$/.test(node.expression.name.text) &&
          node.arguments.length && ts.isIdentifier(node.expression.expression)) {
        const table = binding(node.expression.expression.text, node);
        const functionName = owner(node);
        const context = file.path + " " + functionName + " " + node.arguments[0].getText(source);
        const food = /food|aliment|nutrition|nutrient|meal|ingredient|portion|porc|serving|material|qualifier|attribute/i.test(context);
        const decision = /classif|resolv|decid|normaliz|parse|match|identif|lookup|infer|select|find|detect|material|qualif/i.test(functionName);
        const channel = /whatsapp|inbound|audio|image|ocr|transcri/i.test(file.path);
        const unrelated = /account|status|permission|role|exercise|activity|workout|fitness|navigation|render|display/i.test(functionName);
        if (table && !unrelated && food && (decision || channel)) {
          const materiality = /material|neutral|attribute|qualifier|packag|commercial/i.test(context);
          const ruleId = materiality ? "18" : channel ? "11" : "17";
          const symbol = "consumed-lexical-table:" + table.file + "#" + table.symbol;
          findings.push({
            ruleId, file: file.path,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            symbol,
            fingerprint: ruleId + ":" + file.path + ":" + symbol + ":" +
              stableHash(table.content + ":" + node.getText(source)),
            failureClass: materiality ? "B" : "A",
            description: "Vocabulário lexical literal consumido por decisão alimentar produtiva",
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }
  return findings;
}
