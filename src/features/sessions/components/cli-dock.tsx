import { useRef } from 'react';

import { cn } from '@/lib/utils';

import { CliMark } from '@components/ui/cli-mark';
import { CLI_NAMES } from '@lib/harness/cli-names';
import { HARNESS_IDS, type HarnessId } from '@shared/harness-contract';

/** Keys that step the selection, and which way. */
const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The picker's CLI switch: one square per CLI holding its logo, the chosen one named underneath
 * (variant F of https://claude.ai/artifact/7Xj3HYtLCjYvDFoFhgvpAK).
 *
 * Not `SegmentedControl`: that one takes an `Icon` registry name and draws 22px glyphs, and these
 * are brand marks at 26px in 56px squares. The keyboard contract is the same radio group's: one tab
 * stop, arrows choose as they move and wrap, Home and End jump to the ends.
 */
export function CliDock({ value, onChange }: { value: HarnessId; onChange: (cli: HarnessId) => void }) {
  const refs = useRef(new Map<HarnessId, HTMLButtonElement>());

  const choose = (cli: HarnessId) => {
    onChange(cli);
    refs.current.get(cli)?.focus();
  };

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div role="radiogroup" aria-label="cli" className="flex gap-3.5">
        {HARNESS_IDS.map((cli, index) => {
          const selected = cli === value;
          return (
            <button
              key={cli}
              ref={(node) => {
                if (node) refs.current.set(cli, node);
                else refs.current.delete(cli);
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={CLI_NAMES[cli]}
              title={CLI_NAMES[cli]}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(cli)}
              onKeyDown={(event) => {
                const step = STEP[event.key];
                const total = HARNESS_IDS.length;
                const target =
                  step !== undefined
                    ? HARNESS_IDS[(index + step + total) % total]
                    : event.key === 'Home'
                      ? HARNESS_IDS[0]
                      : event.key === 'End'
                        ? HARNESS_IDS[total - 1]
                        : undefined;
                if (target === undefined) return;
                event.preventDefault();
                choose(target);
              }}
              className={cn(
                'grid size-14 place-items-center rounded-2xl border outline-none focus-visible:ring-1 focus-visible:ring-brand motion-safe:transition-transform',
                selected
                  ? 'border-brand bg-chip text-ink motion-safe:-translate-y-0.5'
                  : 'border-border bg-term-input text-muted hover:bg-hover hover:text-ink',
              )}
            >
              <CliMark cli={cli} className="size-[26px]" />
            </button>
          );
        })}
      </div>
      {/* Codex's mark is OpenAI's and says nothing by itself, so the choice is written out. The radio already carries it for a screen reader. */}
      <span aria-hidden="true" className="text-ui-sm text-ink">
        {CLI_NAMES[value]}
      </span>
    </div>
  );
}
