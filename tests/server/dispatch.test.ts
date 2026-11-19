// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { dispatch, UPDATE_MESSAGE } from '../../server/dispatch';
import { KEY_EXIT, type KeyResult } from '../../server/secrets/key';

const KEY = Buffer.alloc(32, 7);
const NO_KEY_RESULT: KeyResult = { ok: false, message: 'no key' };

function deps(key: KeyResult = { ok: true, key: KEY }) {
  return {
    health: vi.fn(() => 7),
    genKey: vi.fn(() => 'FRESH'),
    key,
    oneShot: vi.fn(() => 6),
    account: vi.fn(() => Promise.resolve(5)),
    serve: vi.fn(),
    print: vi.fn(),
  };
}

const argv = (...args: string[]) => ['/usr/bin/node', '/app/out/server/index.js', ...args];

describe('dispatch (HIVE-422)', () => {
  it('answers --health and runs nothing else', async () => {
    const d = deps();
    await expect(dispatch(argv('--health'), d)).resolves.toBe(7);
    expect(d.health).toHaveBeenCalledTimes(1);
    expect(d.oneShot).not.toHaveBeenCalled();
    expect(d.account).not.toHaveBeenCalled();
    expect(d.serve).not.toHaveBeenCalled();
    expect(d.print).not.toHaveBeenCalled();
  });

  it('answers --health even beside another command', async () => {
    const d = deps();
    await expect(dispatch(argv('--pair', 'x', '--health'), d)).resolves.toBe(7);
    expect(d.oneShot).not.toHaveBeenCalled();
  });

  it('refuses --update with the package-manager message and exit 2', async () => {
    const d = deps();
    await expect(dispatch(argv('--update'), d)).resolves.toBe(2);
    expect(d.print).toHaveBeenCalledWith(UPDATE_MESSAGE);
    expect(UPDATE_MESSAGE).toBe('Update through your package manager or image tag.');
  });

  it('runs --pair <name> as a one-shot and returns its code', async () => {
    const d = deps();
    await expect(dispatch(argv('--pair', 'laptop'), d)).resolves.toBe(6);
    expect(d.oneShot).toHaveBeenCalledWith({ kind: 'pair', name: 'laptop' });
  });

  it('passes --pair with no name as usage', async () => {
    const d = deps();
    await dispatch(argv('--pair'), d);
    expect(d.oneShot).toHaveBeenCalledWith(expect.objectContaining({ kind: 'usage' }));
  });

  it('runs --devices and --revoke as one-shots', async () => {
    const d = deps();
    await dispatch(argv('--devices'), d);
    await dispatch(argv('--revoke', 'laptop'), d);
    expect(d.oneShot).toHaveBeenNthCalledWith(1, { kind: 'devices' });
    expect(d.oneShot).toHaveBeenNthCalledWith(2, { kind: 'revoke', name: 'laptop' });
  });

  it('sends --login and --logout to the account command, with the key', async () => {
    const d = deps();
    await expect(dispatch(argv('--login'), d)).resolves.toBe(5);
    await expect(dispatch(argv('--logout'), d)).resolves.toBe(5);
    expect(d.account).toHaveBeenNthCalledWith(1, { kind: 'login', force: false }, KEY);
    expect(d.account).toHaveBeenNthCalledWith(2, { kind: 'logout' }, KEY);
  });

  it('serves with no flag, with the key, and stays up', async () => {
    const d = deps();
    await expect(dispatch(argv(), d)).resolves.toBeNull();
    expect(d.serve).toHaveBeenCalledTimes(1);
    expect(d.serve).toHaveBeenCalledWith(KEY);
  });

  it('serves with --server alone', async () => {
    const d = deps();
    await expect(dispatch(argv('--server'), d)).resolves.toBeNull();
    expect(d.serve).toHaveBeenCalledTimes(1);
  });
});

describe('dispatch and the secret key (HIVE-424)', () => {
  it.each<KeyResult>([{ ok: true, key: KEY }, NO_KEY_RESULT])(
    '--gen-key prints one fresh key and exits 0 (key ok: $ok)',
    async (key) => {
      const d = deps(key);
      await expect(dispatch(argv('--gen-key'), d)).resolves.toBe(0);
      expect(d.print).toHaveBeenCalledTimes(1);
      expect(d.print).toHaveBeenCalledWith('FRESH');
      expect(d.health).not.toHaveBeenCalled();
      expect(d.oneShot).not.toHaveBeenCalled();
      expect(d.account).not.toHaveBeenCalled();
      expect(d.serve).not.toHaveBeenCalled();
    },
  );

  it('--health wins over --gen-key and prints nothing', async () => {
    const d = deps();
    await expect(dispatch(argv('--health', '--gen-key'), d)).resolves.toBe(7);
    expect(d.print).not.toHaveBeenCalled();
    expect(d.genKey).not.toHaveBeenCalled();
  });

  it.each([[[]], [['--server']], [['--login']], [['--logout']]])(
    'with no key, %j prints the reason and exits 4 without starting anything',
    async (args: string[]) => {
      const d = deps(NO_KEY_RESULT);
      await expect(dispatch(argv(...args), d)).resolves.toBe(KEY_EXIT);
      expect(KEY_EXIT).toBe(4);
      expect(d.print).toHaveBeenCalledWith('no key');
      expect(d.serve).not.toHaveBeenCalled();
      expect(d.account).not.toHaveBeenCalled();
    },
  );

  it('with no key, the one-shots, --health and --update behave as before', async () => {
    const d = deps(NO_KEY_RESULT);
    await expect(dispatch(argv('--pair', 'x'), d)).resolves.toBe(6);
    await expect(dispatch(argv('--devices'), d)).resolves.toBe(6);
    await expect(dispatch(argv('--health'), d)).resolves.toBe(7);
    await expect(dispatch(argv('--update'), d)).resolves.toBe(2);
    expect(d.print).toHaveBeenCalledTimes(1);
    expect(d.print).toHaveBeenCalledWith(UPDATE_MESSAGE);
  });
});
