import { format } from 'node:util';

type Method = 'log' | 'info' | 'warn' | 'error';
type Target = Pick<Console, Method>;

const METHODS: readonly Method[] = ['log', 'info', 'warn', 'error'];
const TAGGED = /^\[[^\]\s]+\]/;
/** Targets already wrapped, so a second install adds nothing. */
const installed = new WeakMap<object, () => void>();

/**
 * HIVE-422: every console line the server writes starts with an ISO time and a `[tag]`, `[hive]` when the line has
 * none of its own, so a container's log reads one way. Returns the uninstall.
 */
export function installLogPrefix(target: Target = console, now: () => Date = () => new Date()): () => void {
  const existing = installed.get(target);
  if (existing) return existing;
  const originals = METHODS.map((method) => [method, target[method]] as const);
  for (const [method, original] of originals) {
    target[method] = (...args: unknown[]): void => {
      const stamp = now().toISOString();
      const text = format(...args)
        .split('\n')
        .map((line) => (TAGGED.test(line) ? `${stamp} ${line}` : `${stamp} [hive] ${line}`))
        .join('\n');
      original.call(target, text);
    };
  }
  const uninstall = (): void => {
    for (const [method, original] of originals) target[method] = original;
    installed.delete(target);
  };
  installed.set(target, uninstall);
  return uninstall;
}
