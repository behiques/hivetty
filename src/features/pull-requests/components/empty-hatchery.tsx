import { Hexagon, MagnifyingGlass } from '@phosphor-icons/react';
import { useId } from 'react';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { Button } from '@components/ui/button';
import { usePickerActions, usePrPageActions } from '@stores/ui-store';

/** Five spores: x offset and stagger, from the design's `prEmpty`. */
const SPORES: readonly [number, number][] = [
  [-34, 0],
  [22, 1.6],
  [-8, 3.1],
  [40, 4.4],
  [-48, 5.5],
];
const FILL_BOX = { transformBox: 'fill-box' } as const;

/**
 * The empty Hatchery (HIVE-205, D15): no PR open, in draft or merged in the
 * last 24 hours, so no panel and the stage is a dormant egg on the creep.
 * Colours are tokens (D3): the shell on `--cc-chip`, the crack and yolk
 * `--cc-brand`, the pool `--cc-creep`, the spores `--cc-chitin`.
 */
export function EmptyHatchery() {
  const still = useReducedMotion();
  const { setPrSearchOpen } = usePrPageActions();
  const { openPicker } = usePickerActions();
  const id = useId();
  const creep = `${id}-creep`;
  const yolk = `${id}-yolk`;
  const anim = (name: string) => (still ? undefined : name);

  return (
    <section
      aria-label="Pull requests"
      className="flex flex-1 flex-col items-center justify-center gap-1.5 bg-[radial-gradient(ellipse_at_50%_42%,color-mix(in_srgb,var(--cc-creep)_12%,transparent),transparent_55%)] text-center"
    >
      <svg viewBox="-160 -150 320 230" aria-hidden className="-mt-10 h-[380px] w-[540px] max-w-full overflow-visible">
        <defs>
          <radialGradient id={creep}>
            <stop offset="0" style={{ stopColor: 'var(--cc-creep)' }} stopOpacity={0.55} />
            <stop offset="1" style={{ stopColor: 'var(--cc-creep)' }} stopOpacity={0} />
          </radialGradient>
          <radialGradient id={yolk} cx="50%" cy="60%">
            <stop offset="0" style={{ stopColor: 'var(--cc-brand)' }} stopOpacity={0.35} />
            <stop offset="1" style={{ stopColor: 'var(--cc-brand)' }} stopOpacity={0} />
          </radialGradient>
        </defs>
        <ellipse
          cx="0"
          cy="44"
          rx="150"
          ry="26"
          fill={`url(#${creep})`}
          className={anim('animate-cccreep')}
          style={{ ...FILL_BOX, transformOrigin: '50% 50%' }}
        />
        <ellipse cx="0" cy="44" rx="40" ry="7" style={{ fill: 'color-mix(in srgb, var(--cc-bg) 70%, transparent)' }} />
        <g data-part="egg" className={anim('animate-cceggrock')} style={{ ...FILL_BOX, transformOrigin: '50% 100%' }}>
          <path
            d="M0-74c26 0 42 38 42 70a42 42 0 0 1-84 0c0-32 16-70 42-70z"
            style={{ fill: 'var(--cc-chip)', stroke: 'var(--cc-subtle)' }}
            strokeWidth={1.6}
          />
          <ellipse
            cx="0"
            cy="-8"
            rx="26"
            ry="34"
            fill={`url(#${yolk})`}
            opacity={still ? 0.25 : undefined}
            className={anim('animate-cceggglow')}
          />
          <path
            d="M-18-40c5-3 9 0 8 4s-8 5-10 1zM14-18c4-2 7 1 6 4s-6 3-7 0zM-6 14c4-2 7 1 6 4s-6 3-7 0z"
            style={{ fill: 'color-mix(in srgb, var(--cc-subtle) 35%, transparent)' }}
          />
          <path
            data-part="crack"
            d="M-30-22l9 6 7-9 8 8 9-7 8 7 10-5"
            pathLength={100}
            strokeDasharray={100}
            strokeDashoffset={100}
            fill="none"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              stroke: 'var(--cc-brand)',
              filter: 'drop-shadow(0 0 4px color-mix(in srgb, var(--cc-brand) 70%, transparent))',
            }}
            className={anim('animate-cceggcrack')}
          />
        </g>
        {still
          ? null
          : SPORES.map(([x, delay]) => (
              <circle
                key={x}
                data-part="spore"
                cx={x}
                cy={-30}
                r={2}
                opacity={0}
                className="animate-ccspore"
                style={{
                  fill: 'color-mix(in srgb, var(--cc-chitin) 60%, transparent)',
                  animationDelay: `${String(delay)}s`,
                }}
              />
            ))}
      </svg>
      <h2 className="mt-1.5 text-[20px] text-ink">The Hatchery is quiet</h2>
      <p className="mb-3 text-[13.5px] leading-[1.6] text-muted">
        No pull request is open, in draft, or merged in the last 24 hours.
        <br />
        The next one hatches here when a session or the builder opens it.
      </p>
      <div className="flex justify-center gap-1.5">
        <Button className="inline-flex items-center gap-1.5" onClick={() => setPrSearchOpen(true)}>
          <MagnifyingGlass size={13} aria-hidden />
          Search older PRs
        </Button>
        <Button variant="primary" className="inline-flex items-center gap-1.5" onClick={() => openPicker()}>
          <Hexagon size={13} aria-hidden />
          New session
        </Button>
      </div>
    </section>
  );
}
