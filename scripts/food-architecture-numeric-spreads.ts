/** Resolve constant numeric map spreads against the lexical binding at their
 * use site. Dynamic values, shadowing and mutable aliases are not proof of
 * static food knowledge; the consumer must separately prove food identity. */
import ts from "typescript";

export function isImmutableNumericSpread(
  expression: ts.Expression,
  use: ts.Node,
  visited: Set<ts.VariableDeclaration>,
  isNumericMap: (expression: ts.Expression, use: ts.Node, seen: Set<ts.VariableDeclaration>) => boolean,
  depth = 0,
): boolean {
  if (depth > 12) return false;
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)) {
    return isImmutableNumericSpread(expression.expression, use, visited, isNumericMap, depth + 1);
  }
  if (!ts.isIdentifier(expression)) return isNumericMap(expression, use, visited);
  const name = expression.text;
  for (let scope: ts.Node | undefined = use; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(parameter =>
      ts.isIdentifier(parameter.name) && parameter.name.text === name)) return false;
    if (ts.isCatchClause(scope) && scope.variableDeclaration &&
        ts.isIdentifier(scope.variableDeclaration.name) &&
        scope.variableDeclaration.name.text === name) return false;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return false;
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
        if (!(statement.declarationList.flags & ts.NodeFlags.Const) ||
            !declaration.initializer || visited.has(declaration) ||
            declaration.getStart() >= use.getStart()) return false;
        const next = new Set(visited);
        next.add(declaration);
        // Alias and nested spread sources retain provenance only while immutable.
        return isImmutableNumericSpread(declaration.initializer, declaration, next, isNumericMap, depth + 1);
      }
    }
  }
  return false;
}
