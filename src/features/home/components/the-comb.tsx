import { type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { cellLabel, cellText, type CellText } from '@features/home/cell-text';
import { useReducedMotion } from '@hooks/use-reduced-motion';
import {
  ALL_PROJECTS, type CellState, type CombCell, COMB_H, COMB_W, type CombInput, type CombLayout, drawComb,
  type Flyer, flyerCount, hitTest, isCalm, layoutComb, stepFlyers, stillFlyers, SWARM, syncFlyers,
} from '@lib/swarm/comb';
import type { SwarmPalette } from '@lib/swarm/palette';
import { useSwarmPalette } from '@stores/appearance-store';
import { type CombEntity, useCombEntities, useOpenEntity, useProjects } from '@stores/hive-store';
import { useSelectPlace, useSetSessionsProject } from '@stores/ui-store';

interface Scene {
  layout: CombLayout;
  palette: SwarmPalette;
  needs: number;
  flyers: Flyer[];
  t: number;
}

export const toCombInput = (e: CombEntity): CombInput => ({
  id: e.id, name: e.name, project: e.project, state: e.state,
  progress: e.total ? (e.done ?? 0) / e.total : undefined,
});

const WORD_CLASS: Record<CellState, string> = {
  morphing: 'text-green', summons: 'text-amber', failed: 'text-red', burrowed: 'text-subtle', terminal: 'text-muted',
};

function CombTooltip({ text, left, top }: { text: CellText; left: number; top: number }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 grid max-w-[240px] gap-0.5 rounded-lg border border-border bg-panel-2 px-2.5 py-2 text-[12px] text-ink shadow-lg"
      style={{ left, top }}
    >
      <b>{text.title}</b>
      {text.word && text.state ? (
        <span className={WORD_CLASS[text.state]}>{`${text.word} · ${text.context}`}</span>
      ) : null}
      <span className={text.word ? undefined : 'text-muted'}>{text.line}</span>
    </div>
  );
}

/** Draw the scene at the canvas's current backing size. */
function paint(canvas: HTMLCanvasElement, scene: Scene): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0) return;
  const k = canvas.width / COMB_W;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawComb(ctx, scene.layout, scene.flyers, scene.t, scene.palette);
}

/**
 * The comb's canvas host (HIVE-199).
 *
 * Owns the animation loop, and runs it only while the canvas is on screen, the
 * document is visible and Home is mounted. Data and the palette reach the loop
 * through a ref, so a session changing state or a theme switch repaints the
 * next frame without restarting anything. Under reduced motion there is no
 * loop at all: one still frame, the flyers placed as after four seconds of
 * flight, redrawn when the data or the palette changes.
 */
export function TheComb({ label }: { label: string }) {
  const entities = useCombEntities();
  const projects = useProjects();
  const palette = useSwarmPalette();
  const reduced = useReducedMotion();

  const layout = useMemo(
    () => layoutComb(entities.map(toCombInput), projects.map(({ id, name }) => ({ id, name }))),
    [entities, projects],
  );
  const needs = useMemo(() => entities.filter((e) => e.state === 'summons').length, [entities]);

  const openEntity = useOpenEntity();
  const selectPlace = useSelectPlace();
  const setSessionsProject = useSetSessionsProject();
  const [hover, setHover] = useState<{ cell: CombCell; k: number } | null>(null);

  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const projectName = useCallback(
    (id: string) => projects.find((p) => p.id === id)?.name ?? id,
    [projects],
  );

  /** A cell opens what it stands for: the session or agent, or the list it folds (decisions D6, D7). */
  const activate = (cell: CombCell): void => {
    if (cell.kind === 'entity') {
      openEntity(cell.id);
    } else if (cell.project === SWARM) {
      selectPlace('agents');
    } else {
      setSessionsProject(cell.project === ALL_PROJECTS ? null : cell.project);
      selectPlace('sessions');
    }
  };

  /** The cell under the pointer, in logical units, and the CSS-px-per-unit scale. */
  const pick = (event: MouseEvent<HTMLCanvasElement>): { cell: CombCell | null; k: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    const k = rect.width / COMB_W;
    if (k <= 0) return { cell: null, k };
    return { cell: hitTest(layout, (event.clientX - rect.left) / k, (event.clientY - rect.top) / k), k };
  };

  const now = Date.now();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene>({ layout, palette, needs, flyers: [], t: 0 });

  useLayoutEffect(() => {
    Object.assign(scene.current, { layout, palette, needs });
    const canvas = canvasRef.current;
    if (!reduced || !canvas) return;
    scene.current.flyers = stillFlyers(layout, needs);
    scene.current.t = 4;
    paint(canvas, scene.current);
  }, [layout, palette, needs, reduced]);

  // The backing store follows the element; device pixel ratio capped at 2.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const resize = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(((canvas.clientWidth * COMB_H) / COMB_W) * dpr);
      paint(canvas, scene.current);
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduced) return undefined;
    let frame = 0;
    let last: number | null = null;
    let onScreen = typeof IntersectionObserver === 'undefined';
    let visible = !document.hidden;

    function tick(now: number): void {
      frame = 0;
      const s = scene.current;
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      s.t += Math.min(dt, 1 / 15);
      const flyers = syncFlyers(s.flyers, flyerCount(s.layout, s.needs), Math.random);
      s.flyers = stepFlyers(flyers, s.layout, dt, Math.random, isCalm(s.layout, s.needs));
      paint(canvas!, s);
      schedule();
    }
    function schedule(): void {
      if (frame === 0 && onScreen && visible) frame = requestAnimationFrame(tick);
    }
    function stop(): void {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      last = null;
    }
    const onVisibility = (): void => {
      visible = !document.hidden;
      if (visible) schedule();
      else stop();
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            onScreen = entries.some((entry) => entry.isIntersecting);
            if (onScreen) schedule();
            else stop();
          });
    observer?.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduced]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className={cn('block aspect-[1376/520] w-full', hover && 'cursor-pointer')}
        onMouseMove={(event) => {
          const { cell, k } = pick(event);
          setHover(cell ? { cell, k } : null);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(event) => {
          const { cell } = pick(event);
          if (cell) activate(cell);
        }}
      />
      {hover ? (
        <CombTooltip
          text={cellText(hover.cell, byId.get(hover.cell.id), projectName, now)}
          left={Math.min(hover.cell.x + 18, COMB_W - 250) * hover.k}
          top={Math.max(0, hover.cell.y - 10) * hover.k}
        />
      ) : null}
      <ul className="sr-only" aria-label="The comb's cells">
        {layout.cells.map((cell) => (
          <li key={cell.id}>
            <button type="button" onClick={() => activate(cell)}>
              {cellLabel(cellText(cell, byId.get(cell.id), projectName, now))}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
