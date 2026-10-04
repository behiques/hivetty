import { describe, expect, it } from 'vitest';

import { hoverSim } from '@lib/swarm/hover';

const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('the hover mutalisk’s simulation', () => {
  it('records once and memoises it', () => {
    expect(hoverSim()).toBe(hoverSim());
  });

  it('closes its loop: frame(0) and frame(3.9999) agree within 0.5 units on every node', () => {
    const { frame, N } = hoverSim();
    const a = frame(0).ns;
    const b = frame(3.9999).ns;
    expect(a).toHaveLength(N);
    for (let i = 0; i < N; i++) expect(dist(a[i]!, b[i]!)).toBeLessThan(0.5);
  });

  it('wraps time onto the loop', () => {
    const { frame } = hoverSim();
    expect(frame(5.25)).toEqual(frame(1.25));
    expect(frame(-0.75)).toEqual(frame(3.25));
  });

  it('holds every simulated vertebra at L from its parent, with no NaN', () => {
    const { frame, L, CH } = hoverSim();
    for (const t of [0, 0.7, 1.9, 2.8, 3.5]) {
      const { ns, st } = frame(t);
      for (const v of [...ns.flat(), ...st]) expect(Number.isFinite(v)).toBe(true);
      // Head, neck and chest (up to CH + 1) are carried by the torso, not constrained.
      for (let i = CH + 2; i < ns.length; i++) expect(dist(ns[i]!, ns[i - 1]!)).toBeCloseTo(L, 1);
    }
  });

  /** Version 15's fix: the last vertebrae carry no momentum, so the tip trails and cannot swirl. */
  it('keeps the tail tip from swirling: its speed relative to node N-8 averages under 20 units/s', () => {
    const { frame, N, TP } = hoverSim();
    const dt = 1 / 120;
    const rel = (t: number): number[] => {
      const { ns } = frame(t);
      const tip = ns[N - 1]!;
      const anchor = ns[N - 8]!;
      return [tip[0] - anchor[0], tip[1] - anchor[1], tip[2] - anchor[2]];
    };
    let sum = 0;
    const steps = TP / dt;
    for (let k = 0; k < steps; k++) sum += dist(rel((k + 1) * dt), rel(k * dt)) / dt;
    expect(sum / steps).toBeLessThan(20);
  });

  it('grows its anatomy seeded, once', () => {
    const sim = hoverSim();
    expect(sim.wings).toHaveLength(2);
    expect(sim.teeth).toHaveLength(18);
    expect(sim.lump).toHaveLength(sim.N);
    expect(sim.skin).toHaveLength(sim.N);
    expect(sim.dust).toHaveLength(26);
    expect(sim.hblots).toHaveLength(9);
  });

  it('beats in phase: the stroke angle, pressure and fold read the artifact’s curves', () => {
    const { thOf, press, foldOf, bv, uOf, ampOf, headYaw } = hoverSim();
    expect(thOf(0)).toBeCloseTo(0.84);
    expect(thOf(0.5, 1)).toBeLessThan(0);
    expect(press(0.2)).toBeGreaterThan(0);
    expect(foldOf(0.4)).toBeGreaterThan(0);
    expect(foldOf(0)).toBe(0);
    expect(bv(0, 0)).toBe(1);
    expect(bv(2.5, 0)).toBeCloseTo(1.13);
    expect(uOf(1, 1)).toBe(0.5);
    expect(uOf(1, -1)).toBeCloseTo(0.48);
    expect(ampOf(2.5, -1)).toBeCloseTo(0.97);
    expect(Number.isFinite(headYaw(1))).toBe(true);
  });
});
