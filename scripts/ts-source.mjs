/**
 * Reads constants out of TypeScript source with the compiler's own parser.
 *
 * The sibling checks in `verify-boundaries.mjs` compare lists that live in
 * `.ts` files (the channel table, the bridge keys, the e2e key list). Running
 * those files would need a build; a regex over them would match commented-out
 * entries and miss multi-line ones. A syntax tree has neither problem.
 */

import ts from 'typescript';

/** Parse `text` as a TypeScript module. `fileName` only labels errors. */
export function parseSource(text, fileName = 'source.ts') {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

/** Strip `as const`, `satisfies T`, parentheses and type assertions. */
export function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The initializer of the top-level `const <name> = …`, unwrapped, or `null`.
 * Exported or not: the caller decides whether that matters.
 */
export function findConstInitializer(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer ? unwrapExpression(declaration.initializer) : null;
      }
    }
  }
  return null;
}

/** The text of a string literal or no-substitution template, else `null`. */
export function stringValue(node) {
  const inner = unwrapExpression(node);
  if (inner && (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner))) {
    return inner.text;
  }
  return null;
}

/** A property's key as written: `foo`, `'foo'`, or `null` for a computed key. */
export function propertyKey(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

export { ts };
