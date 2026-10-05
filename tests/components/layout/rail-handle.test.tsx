import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RailHandle } from '@components/layout/rail-handle';

/** A 1,000px row the observer reports once, which the setup stub never does. */
function measuredRow() {
  const row = document.createElement('div');
  row.getBoundingClientRect = () => ({ width: 1000, height: 500, left: 0, top: 0 }) as DOMRect;
  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = row;
  return ref;
}

describe('RailHandle', () => {
  let observed: (() => void) | undefined;

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          observed = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns a list-rail arrow key into pixels of the row', async () => {
    const onWidth = vi.fn();
    render(<RailHandle rowRef={measuredRow()} rail="list" label="Resize" width={300} onWidth={onWidth} />);
    act(() => observed?.());
    const handle = screen.getByRole('slider', { name: 'Resize' });
    expect(handle).toHaveAttribute('aria-valuenow', '30');

    handle.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onWidth.mock.calls[0]?.[0]).toBeCloseTo(320);
  });

  it('runs the session rail the other way, and double-click resets it', async () => {
    const onWidth = vi.fn();
    render(<RailHandle rowRef={measuredRow()} rail="session" label="Resize" width={320} onWidth={onWidth} />);
    const handle = screen.getByRole('slider', { name: 'Resize' });
    expect(handle).toHaveAttribute('aria-valuenow', '68');

    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onWidth.mock.calls[0]?.[0]).toBeCloseTo(340);

    await userEvent.dblClick(handle);
    expect(onWidth).toHaveBeenLastCalledWith(320);
  });
});
