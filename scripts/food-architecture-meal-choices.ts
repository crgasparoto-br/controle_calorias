/** Gate 17: static meal suggestions are knowledge when a productive recommendation
 * reaches them, even through module-level constants, aliases and imported helpers.
 * Trace lexical bindings instead of guessing food names or filename exemptions. */
import ts from "typescript";
import type { FoodArchitectureFile, FoodFinding } from "./food-intelligence-architecture";

const mealKey = /^(?:breakfast|lunch|dinner|snack|supper|general|pre[_-]?workout|post[_-]?workout|cafe[_ -]?da[_ -]?manha|almoco|jantar|lanche|ceia)$/i;
const uiAction = /^(?:editar|excluir|abrir|fechar|salvar|cancelar|copiar|visualizar|imprimir|selecionar|remover|apagar|voltar|proximo|próximo)\b/i;
const foodDomain = /food|alimen|meal|nutri|ingred|recipe|receita/i;
const unwrap = (expr: ts.Expression): ts.Expression => {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return unwrap(expr.expression);
  }
  if (ts.isCallExpression(expr) && expr.expression.getText() === "Object.freeze" &&
      expr.arguments.length === 1) return unwrap(expr.arguments[0]);
  return expr;
};

/** Read both ordinary and computed property names without relying on a known
 * vocabulary of meal contexts. A computed key may be chosen at runtime; its
 * literal suggestion values still require a productive consumer before gating. */
const mealChoicePropertyKey = (name: ts.PropertyName): string | undefined => {
  const key = ts.isComputedPropertyName(name) ? unwrap(name.expression) : name;
  if (ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) {
    return key.text;
  }
  if (ts.isComputedPropertyName(name)) return key.getText().trim() || undefined;
  return undefined;
};

/** Shape only: neither a filename nor a fixed dictionary of foods proves use. */
export function isLiteralMealChoiceData(expression: ts.Expression): boolean {
  const object = unwrap(expression);
  if (!ts.isObjectLiteralExpression(object) || object.properties.length === 0) return false;
  let values = 0;
  let actions = 0;
  const collect = (literal: ts.ObjectLiteralExpression, depth: number): void => {
    if (depth > 8) return;
    for (const property of literal.properties) {
      // A mixed menu can spread governed choices or contain dynamic entries.
      // Neither may hide literal suggestions, including inline object spreads.
      if (ts.isSpreadAssignment(property)) {
        const spread = unwrap(property.expression);
        if (ts.isObjectLiteralExpression(spread)) collect(spread, depth + 1);
        continue;
      }
      if (!ts.isPropertyAssignment(property)) continue;
      const key = mealChoicePropertyKey(property.name);
      // Productive consumption determines food knowledge, not a closed list of
      // meal names or a requirement that every property be literal.
      if (!key?.trim()) continue;
      const options = unwrap(property.initializer);
      if (!ts.isArrayLiteralExpression(options)) continue;
      for (const element of options.elements) {
        const value = unwrap(element);
        if (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value)) continue;
        values++;
        if (uiAction.test(value.text)) actions++;
      }
    }
  };
  collect(object, 0);
  return values > 0 && actions !== values;
}

type Callable = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
type Definition = { kind: "catalog" | "function" | "namespace"; file: string; id: string };
type Catalog = { file: string; name: string; node: ts.VariableDeclaration; subject: string;
  keys: ReadonlySet<string>; hasMealContext: boolean };
type NamedFunction = { file: string; name: string; node: Callable };

export function findConsumedMealChoiceCatalogs(
  files: FoodArchitectureFile[], runtime: Set<string>,
  indexed: Map<string, FoodArchitectureFile>,
  dependencies: (importer: string, specifier: string, indexed: Map<string, FoodArchitectureFile>) => string[],
  hash: (value: string) => string,
  importGraph: Map<string, Set<string>>, previousFindings: readonly FoodFinding[],
): FoodFinding[] {
  const sources = new Map<string, ts.SourceFile>();
  const catalogs = new Map<string, Catalog>();
  const functions = new Map<string, NamedFunction>();
  const byDeclaration = new Map<ts.Node, Definition>();
  const register = (file: FoodArchitectureFile): void => {
    const location = file.path.replace(/\\/g, "/");
    if (sources.has(location)) return;
    const source = ts.createSourceFile(location, file.content, ts.ScriptTarget.Latest, true,
      /\.tsx$|\.jsx$/i.test(location) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    sources.set(location, source);
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (isLiteralMealChoiceData(node.initializer)) {
          const id = location + ":catalog:" + node.getStart(source);
          const literal = unwrap(node.initializer) as ts.ObjectLiteralExpression;
          const hasMealContext = literal.properties.some(property => {
            if (!ts.isPropertyAssignment(property)) return false;
            const key = mealChoicePropertyKey(property.name) ?? "";
            return key.toLowerCase() !== "general" && mealKey.test(key);
          });
          const keys = new Set(literal.properties.map(property =>
            ts.isPropertyAssignment(property)
              ? mealChoicePropertyKey(property.name) ?? "" : "").filter(Boolean));
          catalogs.set(id, { file: location, name: node.name.text, node,
            subject: node.initializer.getText(source), keys, hasMealContext });
          byDeclaration.set(node, { kind: "catalog", file: location, id });
        } else {
          const value = unwrap(node.initializer);
          if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
            const id = location + ":function:" + node.getStart(source);
            functions.set(id, { file: location, name: node.name.text, node: value });
            byDeclaration.set(node, { kind: "function", file: location, id });
          }
        }
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const id = location + ":function:" + node.getStart(source);
        functions.set(id, { file: location, name: node.name.text, node });
        byDeclaration.set(node, { kind: "function", file: location, id });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  };
  // The canonical scanner already inspected all productive files. Parse only
  // plausible catalog sources first and avoid a second AST traversal of the
  // entire repository when the finding is already covered by the local gate.
  // Necessary syntax tokens only: property assignments require ':' and a
  // literal suggestion array requires '['. Whitespace, comments, parentheses,
  // 'as const', and computed keys may separate them without altering the AST.
  // The AST below decides actual catalog shape and productive consumption.
  const mayContainChoice = (content: string): boolean =>
    content.includes(":") && content.includes("[");
  for (const file of files) {
    const location = file.path.replace(/\\/g, "/");
    if (runtime.has(location) && !/\.json$/i.test(location) && mayContainChoice(file.content)) {
      register(file);
    }
  }
  const alreadyFlagged = new Set(previousFindings.filter(f => f.ruleId === "17")
    .map(f => f.file + ":" + f.line + ":" + f.symbol));
  for (const [id, catalog] of catalogs) {
    const source = sources.get(catalog.file)!;
    const key = catalog.file + ":" +
      (source.getLineAndCharacterOfPosition(catalog.node.getStart(source)).line + 1) +
      ":" + catalog.name + ":meal-choice-catalog";
    if (alreadyFlagged.has(key)) catalogs.delete(id);
  }
  if (catalogs.size === 0) return [];

  // Follow runtime imports, including barrel exports and imported helpers.
  const relevant = new Set([...catalogs.values()].map(c => c.file));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [importer, targets] of importGraph) {
      if (relevant.has(importer) || ![...targets].some(target => relevant.has(target))) continue;
      relevant.add(importer);
      changed = true;
    }
  }
  for (const file of files) {
    const location = file.path.replace(/\\/g, "/");
    if (relevant.has(location) && !/\.json$/i.test(location)) register(file);
  }
  const isTypeOnly = (node: ts.ImportSpecifier | ts.ExportSpecifier) => node.isTypeOnly;
  const containsName = (binding: ts.BindingName, name: string): boolean =>
    ts.isIdentifier(binding) ? binding.text === name :
      binding.elements.some(element => ts.isBindingElement(element) && containsName(element.name, name));
  const resolveExport = (file: string, exported: string, seen: Set<string>): Definition[] => {
    const source = sources.get(file);
    const identity = "export:" + file + ":" + exported;
    if (!source || seen.has(identity)) return [];
    seen.add(identity);
    for (const statement of source.statements) {
      if ((ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)) &&
          statement.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isFunctionDeclaration(statement) &&
            ((statement.name?.text === exported) ||
              (exported === "default" && statement.modifiers.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword)))) {
          const found = byDeclaration.get(statement);
          if (found) return [found];
        }
        if (ts.isVariableStatement(statement)) {
          for (const decl of statement.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.name.text === exported) {
              return resolveName(decl.name.text, decl, new Set(seen));
            }
          }
        }
      }
      if (ts.isExportAssignment(statement) && exported === "default" && !statement.isExportEquals) {
        return resolveExpression(statement.expression, statement, new Set(seen));
      }
      if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
      const moduleSpecifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text : undefined;
      const targets = moduleSpecifier ? dependencies(file, moduleSpecifier, indexed) : [];
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const spec of statement.exportClause.elements) {
          if (isTypeOnly(spec) || spec.name.text !== exported) continue;
          const original = spec.propertyName?.text ?? spec.name.text;
          const result = moduleSpecifier
            ? targets.flatMap(target => resolveExport(target, original, new Set(seen)))
            : resolveName(original, statement, new Set(seen));
          if (result.length) return result;
        }
      } else if (!statement.exportClause && moduleSpecifier && exported !== "default") {
        const result = targets.flatMap(target => resolveExport(target, exported, new Set(seen)));
        if (result.length) return result;
      }
    }
    return [];
  };
  const resolveName = (name: string, use: ts.Node, seen: Set<string>): Definition[] => {
    const source = use.getSourceFile();
    const file = source.fileName;
    const identity = "local:" + file + ":" + use.getStart(source) + ":" + name;
    if (seen.has(identity) || seen.size > 90) return [];
    seen.add(identity);
    for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(param => containsName(param.name, name))) return [];
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          containsName(scope.variableDeclaration.name, name)) return [];
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      const statements = scope.statements;
      for (const statement of statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
          const found = byDeclaration.get(statement);
          return found ? [found] : [];
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const decl of statement.declarationList.declarations) {
          if (!containsName(decl.name, name)) continue;
          if (decl.getStart(source) > use.getStart(source)) return []; // TDZ is not a valid alias
          const binding = byDeclaration.get(decl);
          if (binding) return [binding];
          if (!decl.initializer || !(statement.declarationList.flags & ts.NodeFlags.Const)) return [];
          if (ts.isObjectBindingPattern(decl.name)) {
            const element = decl.name.elements.find(item =>
              ts.isIdentifier(item.name) && item.name.text === name);
            if (!element || element.dotDotDotToken || element.initializer) return [];
            const property = element.propertyName ?? element.name;
            if (!ts.isIdentifier(property) && !ts.isStringLiteral(property)) return [];
            const key = property.text;
            return resolveExpression(decl.initializer, decl, new Set(seen)).flatMap(ref =>
              ref.kind === "namespace" ? resolveExport(ref.file, key, new Set(seen)) :
              ref.kind === "catalog" && catalogs.get(ref.id)?.keys.has(key) ? [ref] : []);
          }
          if (ts.isArrayBindingPattern(decl.name)) {
            const element = decl.name.elements.find((item): item is ts.BindingElement =>
              ts.isBindingElement(item) && ts.isIdentifier(item.name) && item.name.text === name);
            return element && !element.dotDotDotToken && !element.initializer
              ? resolveExpression(decl.initializer, decl, new Set(seen))
                .filter(ref => ref.kind === "catalog") : [];
          }
          if (!ts.isIdentifier(decl.name)) return [];
          return resolveExpression(decl.initializer, decl, new Set(seen));
        }
      }
      if (!ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
            !statement.importClause || statement.importClause.isTypeOnly) continue;
        const targets = dependencies(file, statement.moduleSpecifier.text, indexed);
        const clause = statement.importClause;
        if (clause.name?.text === name) {
          return targets.flatMap(target => resolveExport(target, "default", new Set(seen)));
        }
        if (!clause.namedBindings) continue;
        if (ts.isNamespaceImport(clause.namedBindings) && clause.namedBindings.name.text === name) {
          return targets.map(target => ({ kind: "namespace" as const, file: target, id: target }));
        }
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const spec of clause.namedBindings.elements) {
            if (isTypeOnly(spec) || spec.name.text !== name) continue;
            return targets.flatMap(target => resolveExport(target,
              spec.propertyName?.text ?? spec.name.text, new Set(seen)));
          }
        }
      }
    }
    return [];
  };
  /** Object.values() is transparent only when Object resolves to the native global.
   * A local parameter, import, variable or class must not inherit JSON provenance. */
  const isNativeObject = (use: ts.Node): boolean => {
    for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(param => containsName(param.name, "Object"))) return false;
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          containsName(scope.variableDeclaration.name, "Object")) return false;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
          decl => containsName(decl.name, "Object"))) return false;
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
            statement.name?.text === "Object") return false;
        if (ts.isImportEqualsDeclaration(statement) && statement.name.text === "Object") return false;
        if (ts.isImportDeclaration(statement) && statement.importClause &&
            (statement.importClause.name?.text === "Object" ||
              (statement.importClause.namedBindings && (ts.isNamespaceImport(statement.importClause.namedBindings)
                ? statement.importClause.namedBindings.name.text === "Object"
                : statement.importClause.namedBindings.elements.some(el => el.name.text === "Object"))))) return false;
      }
    }
    return true;
  };
  const resolveExpression = (expr: ts.Expression, use: ts.Node, seen: Set<string>): Definition[] => {
    if (seen.size > 90) return [];
    const value = unwrap(expr);
    if (ts.isIdentifier(value)) return resolveName(value.text, use, seen);
    if (ts.isPropertyAccessExpression(value)) {
      const base = resolveExpression(value.expression, use, new Set(seen));
      return base.flatMap(ref => ref.kind === "namespace"
        ? resolveExport(ref.file, value.name.text, new Set(seen))
        : ref.kind === "catalog" && catalogs.get(ref.id)?.keys.has(value.name.text) ? [ref] : []);
    }
    if (ts.isElementAccessExpression(value) && value.argumentExpression) {
      const index = unwrap(value.argumentExpression);
      const constant = ts.isStringLiteral(index) || ts.isNoSubstitutionTemplateLiteral(index);
      const base = resolveExpression(value.expression, use, new Set(seen));
      return base.flatMap(ref => ref.kind === "namespace" && constant
        ? resolveExport(ref.file, index.text, new Set(seen))
        : ref.kind === "catalog" && (!constant || catalogs.get(ref.id)?.keys.has(index.text)) ? [ref] : []);
    }
    if (ts.isCallExpression(value)) {
      const callee = value.expression;
      const valuesReceiver = ts.isPropertyAccessExpression(callee) && callee.name.text === "values"
        ? callee.expression
        : ts.isElementAccessExpression(callee) && callee.argumentExpression &&
          (ts.isStringLiteral(callee.argumentExpression) ||
            ts.isNoSubstitutionTemplateLiteral(callee.argumentExpression)) &&
          callee.argumentExpression.text === "values" ? callee.expression : null;
      if (valuesReceiver && ts.isIdentifier(valuesReceiver) && valuesReceiver.text === "Object" &&
          value.arguments.length === 1 && isNativeObject(value)) {
        return resolveExpression(value.arguments[0], use, new Set(seen))
          .filter(ref => ref.kind === "catalog");
      }
      // These operations retain the source data; an opaque mapper does not.
      if (ts.isPropertyAccessExpression(callee) && ["flat", "slice", "filter"].includes(callee.name.text)) {
        return resolveExpression(callee.expression, use, new Set(seen))
          .filter(ref => ref.kind === "catalog");
      }
    }
    if (ts.isConditionalExpression(value)) {
      return [...resolveExpression(value.whenTrue, use, new Set(seen)),
        ...resolveExpression(value.whenFalse, use, new Set(seen))];
    }
    if (ts.isBinaryExpression(value) && (value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        value.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      return [...resolveExpression(value.left, use, new Set(seen)),
        ...resolveExpression(value.right, use, new Set(seen))];
    }
    return [];
  };

  const references = new Map<string, { catalogs: Set<string>; calls: Set<string> }>();
  for (const [id, fn] of functions) {
    const direct = new Set<string>();
    const calls = new Set<string>();
    const collect = (expression: ts.Expression): void => {
      for (const reference of resolveExpression(expression, expression, new Set())) {
        if (reference.kind === "catalog") direct.add(reference.id);
      }
      const value = unwrap(expression);
      if (ts.isArrayLiteralExpression(value)) value.elements.forEach(element => {
        if (ts.isSpreadElement(element)) collect(element.expression);
        else if (ts.isExpression(element)) collect(element);
      });
      if (ts.isObjectLiteralExpression(value)) value.properties.forEach(property => {
        if (ts.isPropertyAssignment(property)) collect(property.initializer);
        if (ts.isShorthandPropertyAssignment(property)) collect(property.name);
        if (ts.isSpreadAssignment(property)) collect(property.expression);
      });
      if (ts.isConditionalExpression(value)) {
        collect(value.whenTrue);
        collect(value.whenFalse);
      }
      if (ts.isBinaryExpression(value) && (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
        collect(value.left);
        collect(value.right);
      }
    };
    const walk = (node: ts.Node): void => {
      if (node !== fn.node && ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) collect(node.expression);
      // Preserve the pre-existing dynamic-index signal for a genuine local
      // productive consumer, including indirect helper calls.
      if (ts.isElementAccessExpression(node) && node.argumentExpression) {
        const key = unwrap(node.argumentExpression);
        if (!ts.isStringLiteral(key) && !ts.isNoSubstitutionTemplateLiteral(key) &&
            !ts.isNumericLiteral(key)) {
          for (const reference of resolveExpression(node.expression, node, new Set())) {
            if (reference.kind === "catalog") direct.add(reference.id);
          }
        }
      }
      if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) ||
          ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
        for (const reference of resolveExpression(node.expression, node, new Set())) {
          if (reference.kind === "function") calls.add(reference.id);
        }
      }
      ts.forEachChild(node, walk);
    };
    if (fn.node.body) {
      if (ts.isBlock(fn.node.body)) walk(fn.node.body);
      else collect(fn.node.body);
    }
    references.set(id, { catalogs: direct, calls });
  }
  const walkCalls = (id: string, seen: Set<string>): Set<string> => {
    if (seen.has(id)) return new Set();
    seen.add(id);
    const found = new Set<string>();
    const proof = references.get(id);
    if (!proof) return found;
    for (const candidate of proof.catalogs) found.add(candidate);
    for (const next of proof.calls) {
      for (const candidate of walkCalls(next, seen)) found.add(candidate);
    }
    return found;
  };
  const reachable = new Set<string>();
  for (const [id, fn] of functions) {
    const foodContext = foodDomain.test(fn.name + " " + fn.file);
    const foodFunction = foodDomain.test(fn.name);
    const declaration = fn.node.parent;
    const exported = ts.isVariableDeclaration(declaration)
      ? ts.isVariableStatement(declaration.parent.parent) &&
        !!declaration.parent.parent.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)
      : !!fn.node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
    // An uncalled local helper is not a productive consumer merely because
    // its filename mentions meals. Exported handlers and reachable functions
    // with food semantics remain roots regardless of their verb prefix.
    if (!foodFunction && !(exported && /^(server|shared)\//.test(fn.file))) continue;
    for (const candidate of walkCalls(id, new Set())) {
      const catalog = catalogs.get(candidate);
      // Generic 'general' settings/status dictionaries are not food knowledge
      // without evidence that the consumer belongs to the food domain.
      if (catalog && (foodContext || catalog.hasMealContext)) reachable.add(candidate);
    }
  }
  return [...reachable].flatMap(id => {
    const catalog = catalogs.get(id);
    if (!catalog) return [];
    const source = sources.get(catalog.file)!;
    const symbol = catalog.name + ":meal-choice-catalog";
    return [{
      ruleId: "17", file: catalog.file,
      line: source.getLineAndCharacterOfPosition(catalog.node.getStart(source)).line + 1,
      symbol,
      fingerprint: "17:" + catalog.file + ":" + symbol + ":" + hash(catalog.subject),
      failureClass: "I", description: "Catálogo estático de sugestões alimentares consumido em decisão produtiva",
    }];
  });
}
