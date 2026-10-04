import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SwarmCreature } from '@components/ui/swarm-creature';
import * as brood from '@lib/swarm/brood';
import { HOVER } from '@lib/swarm/hover';
import { SPIRE } from '@lib/swarm/spire';
import { recordingContext } from '@tests/support/canvas-2d';
import { expectNoHexColour } from '@tests/support/light';

/**
 * `matchMedia` is not implemented in happy-dom, so every test that cares about
 * it has to install one. Returning `matches` from the argument lets a test say
 * "the user asked for reduced motion" without reaching into the component.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
        listeners.add(fn),
      removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) =>
        listeners.delete(fn),
    })),
  );

  return listeners;
}

/** Records what the loop does with the screen, without ever running a frame. */
class FakeIntersectionObserver {
  static last: FakeIntersectionObserver | undefined;
  observe = vi.fn();
  disconnect = vi.fn();
  constructor() {
    FakeIntersectionObserver.last = this;
  }
}

const raf = vi.fn((_cb: FrameRequestCallback) => 1);

beforeEach(() => {
  raf.mockClear();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  const rec = recordingContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.ctx as never);
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => 104 });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => 96 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SwarmCreature', () => {
  it('is hidden from assistive technology', () => {
    stubMatchMedia(false);
    render(<SwarmCreature creature="overlord" />);

    const img = screen.getByRole('presentation', { hidden: true });

    expect(img).toHaveAttribute('aria-hidden', 'true');
    expect(img).toHaveAttribute('alt', '');
  });

  it('renders at the height it was given', () => {
    stubMatchMedia(false);
    render(<SwarmCreature creature="hive" size={120} />);

    expect(screen.getByRole('presentation', { hidden: true })).toHaveStyle({
      height: '120px',
    });
  });

  it('names which creature it is, so casting stays reviewable', () => {
    stubMatchMedia(false);
    render(<SwarmCreature creature="hive" />);

    expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute(
      'data-creature',
      'hive',
    );
  });

  /** The hive and the overlord keep their sprite until they are ported too. */
  it('still draws the hive as an image', () => {
    stubMatchMedia(false);
    render(<SwarmCreature creature="hive" />);

    const img = screen.getByRole('presentation', { hidden: true });
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).not.toContain('still');
  });

  it('holds a sprite still when the user asked for less motion', () => {
    stubMatchMedia(true);
    render(<SwarmCreature creature="overlord" />);

    expect(screen.getByRole('presentation', { hidden: true }).getAttribute('src')).toContain('still');
  });

  describe('a Brood creature', () => {
    it('draws the spire on a canvas, as tall as its size and as wide as its box', () => {
      stubMatchMedia(false);
      const { container } = render(<SwarmCreature creature="spire" size={96} />);

      const canvas = container.querySelector('[data-creature]')!;
      expect(canvas.tagName).toBe('CANVAS');
      expect(canvas).toHaveAttribute('data-creature', 'spire');
      expect(canvas).toHaveAttribute('aria-hidden', 'true');
      expect(canvas).toHaveStyle({ height: '96px', width: `${(96 * SPIRE.box[2]) / SPIRE.box[3]}px` });
    });

    it('draws the mutalisk on a canvas at its own aspect', () => {
      stubMatchMedia(false);
      const { container } = render(<SwarmCreature creature="mutalisk" size={120} />);

      const canvas = container.querySelector('[data-creature]')!;
      expect(canvas).toHaveAttribute('data-creature', 'mutalisk');
      expect(canvas).toHaveStyle({ height: '120px', width: `${(120 * HOVER.box[2]) / HOVER.box[3]}px` });
    });

    it('animates only once it is on screen', () => {
      stubMatchMedia(false);
      render(<SwarmCreature creature="spire" />);

      expect(FakeIntersectionObserver.last?.observe).toHaveBeenCalled();
      expect(raf).not.toHaveBeenCalled();
    });

    it('paints its rest frame once under reduced motion, and schedules no frame', () => {
      stubMatchMedia(true);
      const paint = vi.spyOn(brood, 'paintCreature');
      render(<SwarmCreature creature="spire" />);

      expect(paint).toHaveBeenCalledTimes(1);
      const [, creature, t, w, h] = paint.mock.calls[0]!;
      expect(creature).toBe(SPIRE);
      expect(t).toBe(SPIRE.rest);
      expect([w, h]).toEqual([104, 96]);
      expect(raf).not.toHaveBeenCalled();
    });

    it('carries no colour literal into the page', () => {
      stubMatchMedia(false);
      const { container } = render(<SwarmCreature creature="mutalisk" />);

      expectNoHexColour(container);
    });
  });
});
