/** Gate 17: static meal suggestions are knowledge when a productive recommendation
 * reaches them, even through module-level constants, aliases and imported helpers.
 * Trace lexical bindings instead of guessing food names or filename exemptions. */
import ts from "typescript";
import type { FoodArchitectureFile, FoodFinding } from "./food-intelligence-architecture";

const mealKey = /^(?:breakfast|lunch|dinner|snack|supper|general|pre[_-]?workout|post[_-]?workout|cafe[_ -]?da[_ -]?manha|almoco|jantar|lanche|ceia)$/i;
const uiAction = /^(?:editar|excluir|abrir|fechar|salvar|cancelar|copiar|visualizar|imprimir|selecionar|remover|apagar|voltar|proximo|próximo)\b/i;
const foodDomain = /food|alimen|meal|nutri|ingred|recipe|receita/i;
const recommending = /^(?:suggest|recommend|buildAssistantReply|buildMealSuggestions|buildFoodPlan)/i;
const unwrap = (expr: ts.Expression): ts.Expression => {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return unwrap(expr.expression);
  }
  if (ts.isCallExpression(expr) && expr.expression.getText() === "Object.freeze" &&
      expr.arguments.length === 1) return unwrap(expr.arguments[0]);
  return expr;
};

/** Shape only: neither a filename nor a fixed dictionary of foods proves use. */
export function isLiteralMealChoiceData(expression: ts.Expression): boolean {
  const object = unwrap(expression);
  if (!ts.isObjectLiteralExpression(object) || object.properties.length === 0) return false;
  let values = 0;
  let actions = 0;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) return false;
    const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text : undefined;
    if (!key || !mealKey.test(key)) return false;
    const options = unwrap(property.initializer);
    if (!ts.isArrayLiteralExpression(options) || options.elements.length < 2) return false;
    for (const element of options.elements) {
      const value = unwrap(element);
      if (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value)) return false;
      values++;
      if (uiAction.test(value.text)) actions++;
    }
  }
  return values >= 2 && actions !== values;
}

type Callable = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
type Definition = { kind: "catalog" | "function" | "namespace"; file: string; id: string };
type Catalog = { file: string; name: string; node: ts.VariableDeclaration; subject: string };
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
          catalogs.set(id, { file: location, name: node.name.text, node,
            subject: node.initializer.getText(source) });
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
  const maybeMealKey = /breakfast|lunch|dinner|snack|supper|almoco|jantar|lanche|ceia|pre.?workout|post.?workout|cafe.?da.?manha|general["']?\s*:/i;
  for (const file of files) {
    const location = file.path.replace(/\\/g, "/");
    if (runtime.has(location) && !/\.json$/i.test(location) && maybeMealKey.test(file.content)) {
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
          if (!ts.isIdentifier(decl.name) || !decl.initializer ||
              !(statement.declarationList.flags & ts.NodeFlags.Const)) return [];
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
  const resolveExpression = (expr: ts.Expression, use: ts.Node, seen: Set<string>): Definition[] => {
    const value = unwrap(expr);
    if (ts.isIdentifier(value)) return resolveName(value.text, use, seen);
    if (ts.isPropertyAccessExpression(value)) {
      return resolveExpression(value.expression, use, new Set(seen))
        .filter(ref => ref.kind === "namespace")
        .flatMap(ref => resolveExport(ref.file, value.name.text, new Set(seen)));
    }
    if (ts.isElementAccessExpression(value) && value.argumentExpression) {
      const arg = unwrap(value.argumentExpression);
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        return resolveExpression(value.expression, use, new Set(seen))
          .filter(ref => ref.kind === "namespace")
          .flatMap(ref => resolveExport(ref.file, arg.text, new Set(seen)));
      }
    }
    return [];
  };

  const references = new Map<string, { catalogs: Set<string>; calls: Set<string> }>();
  for (const [id, fn] of functions) {
    const direct = new Set<string>();
    const calls = new Set<string>();
    const walk = (node: ts.Node): void => {
      if (node !== fn.node && ts.isFunctionDeclaration(node)) return;
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
    if (fn.node.body) walk(fn.node.body);
    references.set(id, { catalogs: direct, calls });
  }
  const reachable = new Set<string>();
  const walkCalls = (id: string, seen: Set<string>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const proof = references.get(id);
    if (!proof) return;
    for (const candidate of proof.catalogs) reachable.add(candidate);
    for (const next of proof.calls) walkCalls(next, seen);
  };
  for (const [id, fn] of functions) {
    if (recommending.test(fn.name) && foodDomain.test(fn.name + " " + fn.file)) {
      walkCalls(id, new Set());
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
