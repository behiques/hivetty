import { describe, expect, it, vi } from 'vitest';

import { createBindings } from '../../../core/ipc/bindings';

function target() {
  return {
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

describe('createBindings', () => {
  it('unbinds every recorded channel exactly once', () => {
    const ipc = target();
    const bindings = createBindings(() => ipc);

    bindings.record('config:get');
    bindings.record('pty:write');

    bindings.unbindAll();

    expect(ipc.removeHandler).toHaveBeenCalledWith('config:get');
    expect(ipc.removeHandler).toHaveBeenCalledWith('pty:write');
    expect(ipc.removeAllListeners).toHaveBeenCalledWith('config:get');
    expect(ipc.removeAllListeners).toHaveBeenCalledWith('pty:write');
    expect(ipc.removeHandler).toHaveBeenCalledTimes(2);
  });

  it('records a channel once however many times it is registered', () => {
    const ipc = target();
    const bindings = createBindings(() => ipc);

    bindings.record('pty:write');
    bindings.record('pty:write');

    expect(bindings.size()).toBe(1);
    bindings.unbindAll();
    expect(ipc.removeHandler).toHaveBeenCalledTimes(1);
  });

  it('is idempotent, so a second unbind is a no-op', () => {
    const ipc = target();
    const bindings = createBindings(() => ipc);

    bindings.record('config:get');
    bindings.unbindAll();
    bindings.unbindAll();

    expect(ipc.removeHandler).toHaveBeenCalledTimes(1);
    expect(bindings.size()).toBe(0);
  });

  // HIVE-422: a server has no ipcMain, so the target may be absent.
  it('clears its record and touches nothing when there is no target', () => {
    const bindings = createBindings(() => undefined);

    bindings.record('config:get');
    expect(() => bindings.unbindAll()).not.toThrow();
    expect(bindings.size()).toBe(0);
  });

  it('reads the target when it unbinds, not when it is built', () => {
    let current: ReturnType<typeof target> | undefined;
    const bindings = createBindings(() => current);
    const late = target();

    bindings.record('pty:write');
    current = late;
    bindings.unbindAll();

    expect(late.removeHandler).toHaveBeenCalledWith('pty:write');
  });
});
