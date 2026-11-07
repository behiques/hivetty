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
 *
 * An unavailable CLI (HIVE-375: missing, or turned off in Settings) stays drawn, dimmed, with its reason as its
 * name and its hover hint; a click on it does nothing and the keys step past it.
 */
export function CliDock({
  value,
  onChange,
  unavailable = {},
  caption = null,
}: {
  value: HarnessId;
  onChange: (cli: HarnessId) => void;
  unavailable?: Partial<Record<HarnessId, string>>;
  /** Where the choice came from (HIVE-378), drawn under the name; `null` draws nothing. */
  caption?: string | null;
}) {
  const refs = useRef(new Map<HarnessId, HTMLButtonElement>());
  const open = HARNESS_IDS.filter((cli) => unavailable[cli] === undefined);

  const choose = (cli: HarnessId) => {
    onChange(cli);
    refs.current.get(cli)?.focus();
  };

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div role="radiogroup" aria-label="cli" className="flex gap-3.5">
        {HARNESS_IDS.map((cli) => {
          const selected = cli === value;
          const reason = unavailable[cli];
          const label = reason === undefined ? CLI_NAMES[cli] : `${CLI_NAMES[cli]}: ${reason}`;
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
              aria-label={label}
              aria-disabled={reason === undefined ? undefined : true}
              title={reason === undefined ? label : `${CLI_NAMES[cli]} isn't available: ${reason}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                if (reason === undefined) onChange(cli);
              }}
              onKeyDown={(event) => {
                const step = STEP[event.key];
                const total = open.length;
                // An unavailable current CLI is not in `open`: step from its start.
                const index = Math.max(open.indexOf(cli), 0);
                const target =
                  total === 0
                    ? undefined
                    : step !== undefined
                      ? open[(index + step + total) % total]
                      : event.key === 'Home'
                        ? open[0]
                        : event.key === 'End'
                          ? open[total - 1]
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
                reason !== undefined &&
                  'cursor-not-allowed border-dashed opacity-45 hover:bg-term-input hover:text-muted',
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
      {/* Where the choice came from (HIVE-378): "Default for <project>", "Your default", or what was skipped. */}
      {caption === null ? null : (
        <span data-slot="cli-caption" className="max-w-[380px] text-center text-ui-sm text-subtle">
          {caption}
        </span>
      )}
    </div>
  );
}
