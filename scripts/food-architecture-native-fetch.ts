/** Conservative native browser fetch provenance for Vite public catalogs. */
import ts from "typescript";

function unwrap(expr: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isParenthesizedExpression(expr))
    return unwrap(expr.expression);
  return expr;
}

function isStaticText(expr: ts.Expression): expr is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr);
}

/** A binding pattern shadows its local names, not its property keys. */
function declaresBinding(name: ts.BindingName, identifier: string): boolean {
  return ts.isIdentifier(name) ? name.text === identifier :
    name.elements.some(element => ts.isBindingElement(element) &&
      declaresBinding(element.name, identifier));
}

/** Only treat platform intrinsics as such when no lexical declaration shadows them. */
export function unshadowedIntrinsic(name: string, use: ts.Node): boolean {
  for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
        declaresBinding(param.name, name))) return false;
    if (ts.isCatchClause(scope) && scope.variableDeclaration &&
        declaresBinding(scope.variableDeclaration.name, name)) return false;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const stmt of scope.statements) {
      if (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.some(decl =>
          declaresBinding(decl.name, name))) return false;
      if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
          stmt.name?.text === name) return false;
      if (ts.isImportDeclaration(stmt) && stmt.importClause &&
          (stmt.importClause.name?.text === name ||
            (stmt.importClause.namedBindings &&
              (ts.isNamespaceImport(stmt.importClause.namedBindings)
                ? stmt.importClause.namedBindings.name.text === name
                : stmt.importClause.namedBindings.elements.some(el => el.name.text === name))))) return false;
    }
  }
  return true;
}

/** Accept a wrapper only when it forwards its sole argument without
 * rewriting the resource, choosing another provider or performing side effects. */
function forwardsNativeFetch(
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  visited: Set<ts.VariableDeclaration>, depth: number,
): boolean {
  if (depth > 12 || fn.parameters.length !== 1 ||
      !ts.isIdentifier(fn.parameters[0].name) || fn.parameters[0].dotDotDotToken || !fn.body)
    return false;
  const body = ts.isBlock(fn.body) && fn.body.statements.length === 1 &&
      ts.isReturnStatement(fn.body.statements[0])
    ? fn.body.statements[0].expression :
    ts.isBlock(fn.body) ? undefined : fn.body;
  if (!body) return false;
  const result = unwrap(body);
  const call = ts.isAwaitExpression(result) ? unwrap(result.expression) : result;
  return ts.isCallExpression(call) && call.arguments.length === 1 &&
    ts.isIdentifier(unwrap(call.arguments[0])) &&
    (unwrap(call.arguments[0]) as ts.Identifier).text === fn.parameters[0].name.text &&
    isNativeViteFetchTarget(call.expression, call, visited, depth + 1);
}

/** Prove the callee, not just its spelling: immutable aliases, bound native
 * methods and one-return forwarding wrappers preserve fetch provenance.
 * Any mutable, shadowed or ambiguous binding is deliberately unknown. */
export function isNativeViteFetchTarget(
  target: ts.Expression, use: ts.Node,
  visited = new Set<ts.VariableDeclaration>(), depth = 0,
): boolean {
  if (depth > 12) return false;
  const value = unwrap(target);
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
    const receiver = unwrap(value.expression);
    const member = ts.isPropertyAccessExpression(value) ? value.name.text :
      value.argumentExpression && isStaticText(unwrap(value.argumentExpression))
        ? (unwrap(value.argumentExpression) as ts.StringLiteral).text : null;
    return member === "fetch" && ts.isIdentifier(receiver) &&
      (receiver.text === "window" || receiver.text === "globalThis") &&
      unshadowedIntrinsic(receiver.text, use);
  }
  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
      value.expression.name.text === "bind" && value.arguments.length === 1) {
    const receiver = unwrap(value.arguments[0]);
    const native = unwrap(value.expression.expression);
    // A bound global must be provably the same intrinsic receiver.
    const boundReceiver = ts.isPropertyAccessExpression(native) || ts.isElementAccessExpression(native)
      ? unwrap(native.expression) : null;
    return ts.isIdentifier(receiver) &&
      (receiver.text === "window" || receiver.text === "globalThis") &&
      unshadowedIntrinsic(receiver.text, use) &&
      (!boundReceiver || (ts.isIdentifier(boundReceiver) &&
        boundReceiver.text === receiver.text)) &&
      isNativeViteFetchTarget(native, use, visited, depth + 1);
  }
  if (!ts.isIdentifier(value)) return false;
  for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
        declaresBinding(param.name, value.text))) return false;
    if (ts.isCatchClause(scope) && scope.variableDeclaration &&
        declaresBinding(scope.variableDeclaration.name, value.text)) return false;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!declaresBinding(declaration.name, value.text)) continue;
          if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
              !declaration.initializer || visited.has(declaration) ||
              declaration.getStart() >= use.getStart()) return false;
          // Only a const destructured directly from the unshadowed browser
          // global can prove the native method; an arbitrary object cannot.
          if (ts.isObjectBindingPattern(declaration.name)) {
            const owner = unwrap(declaration.initializer);
            return ts.isIdentifier(owner) &&
              (owner.text === "globalThis" || owner.text === "window") &&
              unshadowedIntrinsic(owner.text, declaration) &&
              declaration.name.elements.some(element => {
                if (!ts.isIdentifier(element.name) || element.name.text !== value.text) return false;
                const field = element.propertyName ?? element.name;
                return (ts.isIdentifier(field) || ts.isStringLiteral(field)) && field.text === "fetch";
              });
          }
          if (!ts.isIdentifier(declaration.name)) return false;
          visited.add(declaration);
          const initializer = unwrap(declaration.initializer);
          if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
            return forwardsNativeFetch(initializer, visited, depth + 1);
          return isNativeViteFetchTarget(initializer, declaration, visited, depth + 1);
        }
      }
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === value.text)
        return forwardsNativeFetch(statement, visited, depth + 1);
      if (ts.isClassDeclaration(statement) && statement.name?.text === value.text) return false;
      if (ts.isImportDeclaration(statement) && statement.importClause &&
          (statement.importClause.name?.text === value.text ||
            (statement.importClause.namedBindings &&
              (ts.isNamespaceImport(statement.importClause.namedBindings)
                ? statement.importClause.namedBindings.name.text === value.text
                : statement.importClause.namedBindings.elements.some(el => el.name.text === value.text)))))
        return false;
    }
  }
  return value.text === "fetch" && unshadowedIntrinsic("fetch", use);
}

