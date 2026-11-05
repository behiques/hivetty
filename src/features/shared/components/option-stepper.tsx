import { useRef } from 'react';

import { cn } from '@/lib/utils';

interface OptionStepperProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /**
   * The whole scale is inapplicable right now — fade it and take it out of
   * reach (HIVE-100).
   *
   * Not the same as "this option is unavailable". A stepper is one value on a
   * scale, and there is no coherent way to grey out part of a scale: the fill
   * would still run to a dot the user cannot choose. So the control is disabled
   * whole, and {@link OptionStepperProps.disabledReason} says why.
   */
  disabled?: boolean;
  /**
   * Why, in the user's words, beside the label.
   *
   * A disabled control with no explanation is the one that generates the
   * question — the user's options are to guess or to try clicking it, and both
   * are worse than four words of copy.
   */
  disabledReason?: string;
  /**
   * A quiet second line under some stops: Codex's default effort, a model class's character. Only
   * drawn when given, so Claude's steppers keep their height.
   */
  marks?: Partial<Record<T, string>>;
}

/** Keys that step the selection, and which way. */
const STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * A horizontal stepper: a track, a filled portion, and one dot per option.
 *
 * Bespoke rather than a shadcn primitive, and deliberately so (story 044):
 * nothing else in the app uses it, and the concept's look — a green fill
 * growing to the selected dot — is not a radio group with different paint. It
 * lives in this slice because this slice is its only consumer.
 *
 * The semantics *are* a radio group, though, so that is the role it exposes —
 * and, crucially, the keyboard contract that role promises is implemented
 * rather than merely announced. `role="radio"` tells a screen-reader user that
 * arrow keys move the selection and that the group is a single tab stop;
 * exposing the role without honouring either is worse than using plain buttons,
 * because it advertises an interaction that does not exist.
 */
export function OptionStepper<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  disabledReason,
  marks,
}: OptionStepperProps<T>) {
  const index = Math.max(options.indexOf(value), 0);
  const buttons = useRef(new Map<T, HTMLButtonElement | null>());

  /**
   * Percentage of the rail, which runs from the first dot's centre to the
   * last's. The dots sit at the same fractions of it (see the radiogroup), so
   * the fill ends exactly under the selected dot.
   */
  const fill = options.length > 1 ? (index / (options.length - 1)) * 100 : 0;

  const step = (event: React.KeyboardEvent) => {
    if (disabled) return;
    const delta = STEP[event.key];
    if (delta === undefined) return;

    event.preventDefault();
    // Clamped, not wrapped — the fill is a scale, and running off one end to
    // reappear at the other would read as the value jumping.
    const next = options[Math.min(Math.max(index + delta, 0), options.length - 1)];
    if (next === value) return;

    onChange(next);
    // Focus follows selection, which is what makes the next arrow press
    // continue from here rather than from wherever focus was left behind.
    buttons.current.get(next)?.focus();
  };

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-3',
        /*
          Faded as a whole, and `transition-opacity` so it reads as *this scale
          just stopped applying* rather than as a different control appearing.
          The value underneath is untouched — switching back to a model that
          thinks finds the effort exactly where it was left.
        */
        'transition-opacity duration-200',
        disabled && 'opacity-45',
      )}
    >
      {/*
        One line, always. The aside is appended to a label that sits in a
        half-width column, and left to wrap it made the row taller — so the
        whole stepper dropped a line the moment haiku was picked and rose again
        when it was not. A control that moves while you are choosing is worse
        than one that says less, which is why the reason is four words.
      */}
      <span className="flex items-baseline gap-1.5 truncate tabular-nums text-micro tracking-[0.06em] whitespace-nowrap text-term-head uppercase">
        {label}
        {disabled && disabledReason ? (
          /*
            Lower case against the uppercase label, so it reads as an aside
            rather than as part of the field's name.
          */
          <span className="normal-case">· {disabledReason}</span>
        ) : null}
      </span>

      {/*
        The rail is inset by the thumb's radius, so its two ends are the
        centres of the end dots. Every stop is a 16px button with -8px margins
        either side, so it takes no width in the row and `justify-between`
        centres stop i at exactly i/(n-1) of the rail, the fraction the fill
        uses. A label wider than the box overflows it centred; the end stops
        align theirs to the outer edge instead, their dots still on the point.
        The line sits at the dots' vertical centre, half the 16px dot box.
        Not zero-width: a box with no size reads as invisible to Playwright.
      */}
      <div className="relative mx-2">
        {/* Track and fill are decorative; the dots below carry the semantics. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-2 h-0.5 -translate-y-1/2 rounded bg-term-track"
        />
        <div
          aria-hidden="true"
          className="absolute top-2 left-0 h-0.5 -translate-y-1/2 rounded bg-green transition-[width] duration-250"
          style={{ width: `${fill}%` }}
        />

        <div
          role="radiogroup"
          aria-label={
            disabled && disabledReason ? `${label} — ${disabledReason}` : label
          }
          /*
            Announced as well as faded. Opacity is no signal to a screen reader,
            and `disabled` on each button would leave the *group* claiming to be
            operable.
          */
          aria-disabled={disabled || undefined}
          className="relative flex justify-between"
        >
          {options.map((option, position) => {
            const selected = option === value;

            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={marks?.[option] === undefined ? undefined : `${option} ${marks[option]}`}
                /**
                 * Roving tabindex: the group is one tab stop, not four. Without
                 * it, the two steppers would cost eight tab presses to walk
                 * past, and the focus order would flatly contradict the
                 * grouping the role announces.
                 */
                tabIndex={selected && !disabled ? 0 : -1}
                /*
                  Really disabled, not merely dimmed: a control that looks spent
                  and still answers a click is the trap `session-table.tsx`
                  argues against for ended rows, and the same rule holds here.
                */
                disabled={disabled}
                ref={(node) => {
                  buttons.current.set(option, node);
                }}
                onClick={() => onChange(option)}
                onKeyDown={step}
                className={cn(
                  'group -mx-2 flex w-4 flex-col items-center gap-2 outline-none',
                  'first:items-start last:items-end',
                )}
              >
                {/* A fixed box the size of the biggest dot, so every dot centres on the line. */}
                <span className="grid size-4 place-items-center rounded-full group-focus-visible:ring-2 group-focus-visible:ring-brand">
                  <span
                    className={cn(
                      'rounded-full border transition-all',
                      selected
                        ? 'size-4 border-green bg-green shadow-[0_0_8px_var(--cc-green)]'
                        : 'size-[10px] bg-term-bg',
                      !selected && (position < index ? 'border-green' : 'border-term-track'),
                    )}
                  />
                </span>
                <span
                  className={cn(
                    'whitespace-nowrap tabular-nums text-micro',
                    selected ? 'font-bold text-ink' : 'text-subtle',
                  )}
                >
                  {option}
                </span>
                {marks === undefined ? null : (
                  <span className="h-4 whitespace-nowrap text-micro text-subtle">{marks[option]}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
