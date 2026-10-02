import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { useReducedMotion } from '@hooks/use-reduced-motion';
import {
  COMB_H, COMB_W, type CombInput, type CombLayout, drawComb, type Flyer,
  flyerCount, isCalm, layoutComb, stepFlyers, stillFlyers, syncFlyers,
} from '@lib/swarm/comb';
import type { SwarmPalette } from '@lib/swarm/palette';
import { useSwarmPalette } from '@stores/appearance-store';
import { type CombEntity, useCombEntities, useProjects } from '@stores/hive-store';

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
      <canvas ref={canvasRef} role="img" aria-label={label} className="block aspect-[1376/520] w-full" />
    </div>
  );
}
