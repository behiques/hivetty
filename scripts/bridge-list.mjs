/**
 * The e2e bridge list matches `BRIDGE_KEYS` (HIVE-417).
 *
 * `tests/electron/preload/bridge.test.ts` pins the preload to the arrays in
 * `tests/support/bridge-keys.ts`. The built-app spec
 * `tests/e2e/electron/security.spec.ts` asserts the same surface against its
 * own hand-commented lists, one `expect(surface.<ns>).toEqual([...])` per
 * namespace (`top` is `window.hive` itself). Nothing tied the two, so #238
 * added a key to `BRIDGE_KEYS` and the preload, the unit test went green, and
 * the e2e list stayed one key short until the built app ran.
 *
 * Both files are parsed with the TypeScript compiler, so a key named inside a
 * comment (the spec's lists are mostly comments) never counts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findConstInitializer, parseSource, stringValue, ts } from './ts-source.mjs';

export const BRIDGE_KEYS_PATH = 'tests/support/bridge-keys.ts';
export const SECURITY_SPEC_PATH = 'tests/e2e/electron/security.spec.ts';

/** The string members of an array literal; throws on anything else. */
function stringMembers(array, where) {
  return array.elements.map((element) => {
    const value = stringValue(element);
    if (value === null) throw new Error(`${where}: non-string entry ${element.getText()}`);
    return value;
  });
}

/** Every top-level `BRIDGE_*` array in bridge-keys.ts, by name. */
export function readBridgeKeyLists(bridgeKeys) {
  const sourceFile = parseSource(bridgeKeys, BRIDGE_KEYS_PATH);
  const lists = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const name = declaration.name.text;
      if (!name.startsWith('BRIDGE_')) continue;
      const array = findConstInitializer(sourceFile, name);
      if (array && ts.isArrayLiteralExpression(array)) {
        lists.set(name, stringMembers(array, `${BRIDGE_KEYS_PATH} ${name}`));
      }
    }
  }
  return lists;
}

/**
 * Every `expect(surface.<ns>).toEqual([...])` in the spec, in source order.
 * Throws when `surface.top` is never asserted: a refactor that renamed
 * `surface` would otherwise leave this check comparing nothing.
 */
export function readSpecSurfaceLists(securitySpec) {
  const found = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'toEqual' &&
      node.arguments.length === 1 &&
      ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      const subject = node.expression.expression;
      if (
        ts.isCallExpression(subject) &&
        ts.isIdentifier(subject.expression) &&
        subject.expression.text === 'expect' &&
        subject.arguments.length === 1 &&
        ts.isPropertyAccessExpression(subject.arguments[0]) &&
        ts.isIdentifier(subject.arguments[0].expression) &&
        subject.arguments[0].expression.text === 'surface'
      ) {
        const namespace = subject.arguments[0].name.text;
        found.push({
          namespace,
          keys: stringMembers(node.arguments[0], `${SECURITY_SPEC_PATH} surface.${namespace}`),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parseSource(securitySpec, SECURITY_SPEC_PATH));
  if (!found.some((list) => list.namespace === 'top')) {
    throw new Error(`${SECURITY_SPEC_PATH}: no expect(surface.top).toEqual([...]) found`);
  }
  return found;
}

/** `top` → `BRIDGE_KEYS`; `changedFiles` → `BRIDGE_CHANGED_FILES_KEYS`. */
function arrayNameFor(namespace) {
  if (namespace === 'top') return 'BRIDGE_KEYS';
  return `BRIDGE_${namespace.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}_KEYS`;
}

/** `BRIDGE_KEYS` → `top`; `BRIDGE_CHANGED_FILES_KEYS` → `changedFiles`. */
function namespaceFor(arrayName) {
  if (arrayName === 'BRIDGE_KEYS') return 'top';
  return arrayName
    .slice('BRIDGE_'.length, -'_KEYS'.length)
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

/**
 * What differs between the spec's lists and bridge-keys.ts; empty when they agree.
 * Every `BRIDGE_*_KEYS` array needs a spec list (acr on #307): comparing only the
 * namespaces the spec already asserted let five namespaces go unchecked.
 */
export function bridgeListProblems({ bridgeKeys, securitySpec }) {
  const lists = readBridgeKeyLists(bridgeKeys);
  const specLists = readSpecSurfaceLists(securitySpec);
  const problems = [];
  for (const { namespace, keys } of specLists) {
    const arrayName = arrayNameFor(namespace);
    const expected = lists.get(arrayName);
    if (!expected) {
      problems.push(`surface.${namespace}: no ${arrayName} in bridge-keys.ts`);
      continue;
    }
    const inSpec = new Set(keys);
    const inBridge = new Set(expected);
    const specMissing = expected.filter((key) => !inSpec.has(key));
    const bridgeMissing = keys.filter((key) => !inBridge.has(key));
    if (specMissing.length) {
      problems.push(
        `surface.${namespace}: in ${arrayName}, missing from security.spec.ts: ${specMissing.join(', ')}`,
      );
    }
    if (bridgeMissing.length) {
      problems.push(
        `surface.${namespace}: in security.spec.ts, missing from ${arrayName}: ${bridgeMissing.join(', ')}`,
      );
    }
  }
  const asserted = new Set(specLists.map((list) => arrayNameFor(list.namespace)));
  for (const arrayName of lists.keys()) {
    if (!/^BRIDGE_(?:\w+_)?KEYS$/.test(arrayName) || asserted.has(arrayName)) continue;
    problems.push(
      `${arrayName}: no expect(surface.${namespaceFor(arrayName)}).toEqual([...]) in security.spec.ts`,
    );
  }
  return problems;
}

/** Read both files from disk. */
export function readBridgeSources(appRoot) {
  return {
    bridgeKeys: readFileSync(join(appRoot, BRIDGE_KEYS_PATH), 'utf8'),
    securitySpec: readFileSync(join(appRoot, SECURITY_SPEC_PATH), 'utf8'),
  };
}
