import { act, fireEvent, render, screen } from '@testing-library/react';
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
    expect(handle).toHaveAttribute('aria-valuenow', '31');

    handle.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onWidth.mock.calls[0]?.[0]).toBeCloseTo(320);
  });

  it('runs the session rail the other way, and double-click resets it', async () => {
    const onWidth = vi.fn();
    render(<RailHandle rowRef={measuredRow()} rail="session" label="Resize" width={320} onWidth={onWidth} />);
    const handle = screen.getByRole('slider', { name: 'Resize' });
    expect(handle).toHaveAttribute('aria-valuenow', '67');

    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onWidth.mock.calls[0]?.[0]).toBeCloseTo(340);

    await userEvent.dblClick(handle);
    expect(onWidth).toHaveBeenLastCalledWith(320);
  });

  it('puts the seam’s centre under the cursor on a drag, on either rail', () => {
    const onList = vi.fn();
    const onSession = vi.fn();
    render(<RailHandle rowRef={measuredRow()} rail="list" label="List" width={300} onWidth={onList} />);
    render(<RailHandle rowRef={measuredRow()} rail="session" label="Session" width={320} onWidth={onSession} />);

    fireEvent.pointerDown(screen.getByRole('slider', { name: 'List' }));
    fireEvent.pointerMove(window, { clientX: 400 });
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(screen.getByRole('slider', { name: 'Session' }));
    fireEvent.pointerMove(window, { clientX: 600 });
    fireEvent.pointerUp(window);

    // The handle is 12px: its centre at 400 leaves 394 of list, at 600 leaves 394 of session.
    expect(onList.mock.calls[0]?.[0]).toBeCloseTo(394);
    expect(onSession.mock.calls[0]?.[0]).toBeCloseTo(394);
  });
});
