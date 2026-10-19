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

/** A const binding is not a frozen object. Trace aliases and reject mutations or
 * escapes anywhere in the owning scope, including writes after a wrapper was
 * declared (the wrapper can be invoked later). Keep lexical shadowing distinct. */
function stableOptionBinding(declaration: ts.VariableDeclaration, use: ts.Node): boolean {
  if (!ts.isIdentifier(declaration.name)) return false;
  let owner: ts.Node | undefined = declaration;
  while (owner && !ts.isBlock(owner) && !ts.isSourceFile(owner)) owner = owner.parent;
  if (!owner) return false;
  const aliases = new Set([declaration.name.text]);
  const sameBinding = (node: ts.Node, name: string): boolean => {
    for (let scope: ts.Node | undefined = node; scope && scope !== owner; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(p => declaresBinding(p.name, name))) return false;
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          declaresBinding(scope.variableDeclaration.name, name)) return false;
      if ((ts.isBlock(scope) || ts.isSourceFile(scope)) && scope.statements.some(stmt =>
        (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.some(d =>
          declaresBinding(d.name, name))) ||
        ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name?.text === name)))
        return false;
    }
    return true;
  };
  const root = (node: ts.Node): ts.Identifier | undefined => {
    if (ts.isIdentifier(node)) return node;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return root(node.expression);
    if (ts.isParenthesizedExpression(node)) return root(node.expression);
    return undefined;
  };
  const references = (node: ts.Node): boolean => {
    const id = root(node);
    return !!id && aliases.has(id.text) && sameBinding(id, id.text);
  };
  // Object identity can propagate through aliases and inert containers. Track
  // containers separately: putting a RequestInit in an array does not mutate
  // it, but a subsequent write/escape through that array invalidates the proof.
  const containers = new Set<string>();
  const containsOption = (expr: ts.Expression, depth = 0): boolean => {
    if (depth > 10) return false;
    const value = unwrap(expr);
    if (references(value)) return true;
    if (ts.isIdentifier(value)) return containers.has(value.text) && sameBinding(value, value.text);
    if (ts.isArrayLiteralExpression(value)) return value.elements.some(e =>
      (ts.isSpreadElement(e) ? containsOption(e.expression, depth + 1) :
        ts.isExpression(e) && containsOption(e, depth + 1)));
    if (ts.isObjectLiteralExpression(value)) return value.properties.some(p =>
      ts.isPropertyAssignment(p) ? containsOption(p.initializer, depth + 1) :
      ts.isShorthandPropertyAssignment(p) ? containsOption(p.name, depth + 1) :
      ts.isSpreadAssignment(p) && containsOption(p.expression, depth + 1));
    return false;
  };
  const isContainerReference = (expr: ts.Expression): boolean => {
    const id = root(unwrap(expr));
    return !!id && containers.has(id.text) && sameBinding(id, id.text);
  };
  const immutable = (node: ts.VariableDeclaration): boolean =>
    ts.isVariableDeclarationList(node.parent) && !!(node.parent.flags & ts.NodeFlags.Const);
  const isOptionAlias = (node: ts.VariableDeclaration): boolean =>
    ts.isIdentifier(node.name) && !!node.initializer && immutable(node) &&
    (ts.isIdentifier(unwrap(node.initializer)) && references(unwrap(node.initializer)) ||
      (ts.isPropertyAccessExpression(unwrap(node.initializer)) ||
        ts.isElementAccessExpression(unwrap(node.initializer))) &&
        isContainerReference(unwrap(node.initializer)));
  // A scalar read cannot leak the RequestInit identity. Check that the
  // accessed value in the original static object is a primitive, rather than
  // treating every property access (including headers) as a safe read.
  const primitiveRead = (expression: ts.Expression): boolean => {
    const keys: string[] = [];
    let current = unwrap(expression);
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      const key = ts.isPropertyAccessExpression(current) ? current.name.text :
        current.argumentExpression && isStaticText(unwrap(current.argumentExpression))
          ? (unwrap(current.argumentExpression) as ts.StringLiteral).text : null;
      if (key === null) return false;
      keys.unshift(key);
      current = unwrap(current.expression);
    }
    if (!ts.isIdentifier(current) || !references(current) || !keys.length) return false;
    let value: ts.Expression | undefined = declaration.initializer;
    for (const key of keys) {
      if (!value || !ts.isObjectLiteralExpression(unwrap(value))) return false;
      const property: ts.ObjectLiteralElementLike | undefined =
        (unwrap(value) as ts.ObjectLiteralExpression).properties.find(p =>
          ts.isPropertyAssignment(p) &&
          (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === key);
      if (!property || !ts.isPropertyAssignment(property)) return false;
      value = property.initializer;
    }
    if (!value) return false;
    const leaf = unwrap(value);
    return isStaticText(leaf) || ts.isNumericLiteral(leaf) ||
      leaf.kind === ts.SyntaxKind.TrueKeyword || leaf.kind === ts.SyntaxKind.FalseKeyword ||
      leaf.kind === ts.SyntaxKind.NullKeyword;
  };
  const scalarDestructuring = (node: ts.VariableDeclaration): boolean => {
    if (!node.initializer || !ts.isObjectBindingPattern(node.name) ||
        !ts.isIdentifier(unwrap(node.initializer)) || !references(unwrap(node.initializer))) return false;
    return node.name.elements.every(element => {
      if (element.dotDotDotToken || element.initializer) return false;
      const key = element.propertyName || element.name;
      if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return false;
      return primitiveRead(ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier(declaration.name.getText()), key.text));
    });
  };
  let changed = true;
  while (changed) {
    changed = false;
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node !== declaration && node.initializer && immutable(node)) {
        if (ts.isIdentifier(node.name)) {
          if (isOptionAlias(node) && !aliases.has(node.name.text)) {
            aliases.add(node.name.text); changed = true;
          } else if (containsOption(node.initializer) && !references(unwrap(node.initializer)) &&
              !primitiveRead(node.initializer) && !containers.has(node.name.text)) {
            containers.add(node.name.text); changed = true;
          }
        } else if (ts.isArrayBindingPattern(node.name) &&
            ts.isArrayLiteralExpression(unwrap(node.initializer))) {
          const elements = (unwrap(node.initializer) as ts.ArrayLiteralExpression).elements;
          for (const [index, el] of node.name.elements.entries()) {
            if (ts.isBindingElement(el) && ts.isIdentifier(el.name) &&
                index < elements.length && ts.isExpression(elements[index]) &&
                containsOption(elements[index]) && !aliases.has(el.name.text)) {
              aliases.add(el.name.text); changed = true;
            }
          }
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(owner);
  }
  // Native fetch reads RequestInit without mutating it. Reusing the same
  // statically proven object in several native reads is not an escape.
  const nativeRead = (call: ts.CallExpression): boolean => {
    const target = unwrap(call.expression);
    if (ts.isIdentifier(target)) return target.text === "fetch" &&
      unshadowedIntrinsic("fetch", call);
    if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) return false;
    const receiver = unwrap(target.expression);
    const property = ts.isPropertyAccessExpression(target) ? target.name.text :
      target.argumentExpression && isStaticText(unwrap(target.argumentExpression))
        ? (unwrap(target.argumentExpression) as ts.StringLiteral).text : null;
    return property === "fetch" && ts.isIdentifier(receiver) &&
      (receiver.text === "window" || receiver.text === "globalThis") &&
      unshadowedIntrinsic(receiver.text, call);
  };
  let unsafe = false;
  const visit = (node: ts.Node): void => {
    if (unsafe || node === declaration) return;
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        references(node.left)) { unsafe = true; return; }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
        references(node.operand)) { unsafe = true; return; }
    if (ts.isDeleteExpression(node) && references(node.expression)) { unsafe = true; return; }
    if (ts.isNewExpression(node) && node.arguments?.some(arg =>
        references(arg) || isContainerReference(arg) || containsOption(arg))) {
      unsafe = true; return;
    }
    if (ts.isCallExpression(node)) {
      if ((ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) &&
          (references(node.expression.expression) || isContainerReference(node.expression.expression))) {
        unsafe = true; return;
      }
      for (const [i, arg] of node.arguments.entries()) {
        if (!references(arg) && !isContainerReference(arg) && !containsOption(arg)) continue;
        // Native fetch is the only trusted external consumer of RequestInit.
        if (i === 1 && references(arg) && (node === use ||
            (node.arguments.length === 2 && nativeRead(node)))) continue;
        unsafe = true; return;
      }
    }
    if (ts.isVariableDeclaration(node) && node !== declaration && node.initializer &&
        (references(node.initializer) || isContainerReference(node.initializer) ||
          containsOption(node.initializer))) {
      // Reading a proven scalar is not a mutable alias/escape. Keep containers
      // in local immutable declarations, then reject their actual mutations.
      if (!primitiveRead(node.initializer) && !scalarDestructuring(node) &&
          !isOptionAlias(node) &&
          !(immutable(node) && (ts.isArrayLiteralExpression(unwrap(node.initializer)) ||
            ts.isObjectLiteralExpression(unwrap(node.initializer)) ||
            ts.isIdentifier(unwrap(node.initializer)) && isContainerReference(unwrap(node.initializer)) ||
            (ts.isArrayBindingPattern(node.name) &&
              ts.isArrayLiteralExpression(unwrap(node.initializer)))))) {
        unsafe = true; return;
      }
    }
    if (ts.isReturnStatement(node) && node.expression &&
        !primitiveRead(node.expression) &&
        (references(node.expression) || isContainerReference(node.expression) ||
          containsOption(node.expression))) { unsafe = true; return; }
    if ((ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) &&
        references(node.expression)) { unsafe = true; return; }
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        isContainerReference(node.left)) { unsafe = true; return; }
    if (ts.isDeleteExpression(node) && isContainerReference(node.expression)) {
      unsafe = true; return;
    }
    if (ts.isPrefixUnaryExpression(node) && isContainerReference(node.operand)) {
      unsafe = true; return;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return !unsafe;
}

/** Only a statically inert GET RequestInit proves the same local resource.
 * Calls, spreads, accessors, dynamic options and non-GET requests are unknown
 * rather than silently attributed to a food JSON catalog. */
export function isStaticGetRequestInit(input: ts.Expression, use: ts.Node): boolean {
  const seen = new Set<ts.VariableDeclaration>();
  const literal = (expression: ts.Expression, location: ts.Node, depth = 0,
    requireObject = false, topLevel = false): boolean => {
    if (depth > 10) return false;
    const value = unwrap(expression);
    if (ts.isIdentifier(value)) {
      // A statically known, lexically scoped const is as safe as an inline
      // RequestInit. Mutable/shadowed/dynamic options are intentionally unknown.
      for (let scope: ts.Node | undefined = location; scope; scope = scope.parent) {
        if (ts.isFunctionLike(scope) && scope.parameters.some(param =>
          declaresBinding(param.name, value.text))) return false;
        if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          declaresBinding(scope.variableDeclaration.name, value.text)) return false;
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
            if (!declaresBinding(declaration.name, value.text)) continue;
            if (!ts.isIdentifier(declaration.name) ||
                !(statement.declarationList.flags & ts.NodeFlags.Const) ||
                !declaration.initializer || seen.has(declaration) ||
                declaration.getStart() >= location.getStart()) return false;
            seen.add(declaration);
            try {
              return stableOptionBinding(declaration, use) &&
                literal(declaration.initializer, declaration, depth + 1, requireObject, topLevel);
            } finally { seen.delete(declaration); }
          }
          if ((ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) &&
              statement.name?.text === value.text) return false;
          if (ts.isImportDeclaration(statement) && statement.importClause &&
              (statement.importClause.name?.text === value.text ||
                (statement.importClause.namedBindings &&
                  (ts.isNamespaceImport(statement.importClause.namedBindings)
                    ? statement.importClause.namedBindings.name.text === value.text
                    : statement.importClause.namedBindings.elements.some(el => el.name.text === value.text)))))
            return false;
        }
      }
      return false;
    }
    if (!requireObject && (isStaticText(value) || ts.isNumericLiteral(value) ||
        value.kind === ts.SyntaxKind.TrueKeyword ||
        value.kind === ts.SyntaxKind.FalseKeyword ||
        value.kind === ts.SyntaxKind.NullKeyword)) return true;
    if (!requireObject && ts.isArrayLiteralExpression(value)) return value.elements.every(element =>
      !ts.isSpreadElement(element) && literal(element, element, depth + 1));
    if (!ts.isObjectLiteralExpression(value)) return false;
    return value.properties.every(property => {
      if (!ts.isPropertyAssignment(property)) return false;
      const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text : null;
      if (key === null) return false;
      if (topLevel && (key === "body" || key === "duplex")) return false;
      if (topLevel && key === "method") {
        const method = unwrap(property.initializer);
        if (!isStaticText(method) || method.text.toUpperCase() !== "GET") return false;
      }
      return literal(property.initializer, property, depth + 1);
    });
  };
  return literal(input, use, 0, true, true);
}

/** Only transparent wrappers can carry the URL's provenance. Extra arguments
 * must be unused or have an inert default on a call that omits them. */
function forwardsNativeFetch(
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  visited: Set<ts.VariableDeclaration>, depth: number, invocation?: ts.CallExpression,
): boolean {
  if (depth > 12 || !fn.parameters.length || !fn.body ||
      !ts.isIdentifier(fn.parameters[0].name) || fn.parameters[0].dotDotDotToken ||
      fn.parameters[0].initializer || (invocation && invocation.arguments.length !== 1)) return false;
  const extra = fn.parameters.slice(1);
  if (extra.some(p => !ts.isIdentifier(p.name) || !!p.dotDotDotToken ||
      (!p.questionToken && !p.initializer) ||
      (!!p.initializer && !isInertDefault(p.initializer, p)))) return false;

  const constants = new Map<string, ts.Expression>();
  const statements = ts.isBlock(fn.body) ? [...fn.body.statements] : [];
  const final = statements.length ? statements.pop() : undefined;
  if (ts.isBlock(fn.body) && (!final || !ts.isReturnStatement(final))) return false;
  for (const stmt of statements) {
    if (!ts.isVariableStatement(stmt) || !(stmt.declarationList.flags & ts.NodeFlags.Const)) return false;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) return false;
      constants.set(decl.name.text, decl.initializer);
    }
  }
  const returned = ts.isBlock(fn.body) ? (final as ts.ReturnStatement).expression : fn.body;
  if (!returned) return false;
  const returnedValue = unwrap(returned);
  const result = ts.isIdentifier(returnedValue) && constants.has(returnedValue.text)
    ? constants.get(returnedValue.text)! : returnedValue;
  const extractCall = (expr: ts.Expression): ts.CallExpression | undefined => {
    const unwrapped = unwrap(expr);
    const value = unwrap(ts.isAwaitExpression(unwrapped) ? unwrapped.expression : unwrapped);
    if (ts.isCallExpression(value)) return value;
    if (ts.isConditionalExpression(value) && isInertDefault(value.condition, value)) {
      const yes = extractCall(value.whenTrue), no = extractCall(value.whenFalse);
      if (yes && no && yes.getText() === no.getText()) return yes;
    }
    return undefined;
  };
  const call = extractCall(result);
  if (!call || call.arguments.length < 1 || call.arguments.length > 2 ||
      !ts.isIdentifier(unwrap(call.arguments[0])) ||
      (unwrap(call.arguments[0]) as ts.Identifier).text !== fn.parameters[0].name.text) return false;

  const init = call.arguments[1] && unwrap(call.arguments[1]);
  const fallback = init && ts.isIdentifier(init) ? extra.find(p =>
    ts.isIdentifier(p.name) && p.name.text === init.text && !!p.initializer) : undefined;
  const optionsValid = !init || (fallback
    ? isStaticGetRequestInit(fallback.initializer!, fallback)
    : isStaticGetRequestInit(call.arguments[1], call));
  if (!optionsValid) return false;
  // Any local declarations must be either static RequestInit values or the
  // unique returned response; no arbitrary statements or mutations intervene.
  for (const [name, initializer] of constants) {
    if (ts.isIdentifier(returnedValue) && name === returnedValue.text) continue;
    if (!isStaticGetRequestInit(initializer, call)) return false;
  }
  return isNativeViteFetchTarget(call.expression, call, visited, depth + 1, invocation);
}

function isInertDefault(expression: ts.Expression, use: ts.Node): boolean {
  const value = unwrap(expression);
  if (isStaticText(value) || ts.isNumericLiteral(value) ||
      value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword ||
      value.kind === ts.SyntaxKind.NullKeyword) return true;
  return isStaticGetRequestInit(value, use);
}

export function hasStaticNativeFetchRequestInit(node: ts.CallExpression): boolean {
  return node.arguments.length === 1 ||
    (node.arguments.length === 2 && isStaticGetRequestInit(node.arguments[1], node));
}

/** Prove the callee, not just its spelling: immutable aliases, bound native
 * methods and one-return forwarding wrappers preserve fetch provenance.
 * Any mutable, shadowed or ambiguous binding is deliberately unknown. */
export function isNativeViteFetchTarget(
  target: ts.Expression, use: ts.Node,
  visited = new Set<ts.VariableDeclaration>(), depth = 0,
  invocation: ts.CallExpression | undefined = ts.isCallExpression(use) ? use : undefined,
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
      isNativeViteFetchTarget(native, use, visited, depth + 1, invocation);
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
            return forwardsNativeFetch(initializer, visited, depth + 1, invocation);
          return isNativeViteFetchTarget(initializer, declaration, visited, depth + 1, invocation);
        }
      }
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === value.text)
        return forwardsNativeFetch(statement, visited, depth + 1, invocation);
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

