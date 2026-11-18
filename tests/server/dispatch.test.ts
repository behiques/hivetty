// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { dispatch, UPDATE_MESSAGE } from '../../server/dispatch';

function deps() {
  return {
    health: vi.fn(() => 7),
    oneShot: vi.fn(() => 4),
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
    await expect(dispatch(argv('--pair', 'laptop'), d)).resolves.toBe(4);
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

  it('sends --login and --logout to the account command', async () => {
    const d = deps();
    await expect(dispatch(argv('--login'), d)).resolves.toBe(5);
    await expect(dispatch(argv('--logout'), d)).resolves.toBe(5);
    expect(d.account).toHaveBeenNthCalledWith(1, { kind: 'login', force: false });
    expect(d.account).toHaveBeenNthCalledWith(2, { kind: 'logout' });
  });

  it('serves with no flag, and stays up', async () => {
    const d = deps();
    await expect(dispatch(argv(), d)).resolves.toBeNull();
    expect(d.serve).toHaveBeenCalledTimes(1);
  });

  it('serves with --server alone', async () => {
    const d = deps();
    await expect(dispatch(argv('--server'), d)).resolves.toBeNull();
    expect(d.serve).toHaveBeenCalledTimes(1);
  });
});
