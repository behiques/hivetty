import { Eye, EyeSlash } from '@phosphor-icons/react';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * A write-only credential input (HIVE-67).
 *
 * Deliberately **not** a `type` prop on `TextField`. The two look similar and
 * mean different things: a `TextField` displays the value the app holds, and
 * this field cannot, because the app does not hold one — a stored token can be
 * replaced and cleared but never read back. Folding them together would put a
 * masked box on screen that implies a round trip which does not exist, and the
 * first person to wonder "why is my token not showing" would be asking a
 * reasonable question about a lie the component told them.
 *
 * So the value here is always a *new* token on its way in. Whatever is already
 * stored is described in prose beside the field rather than dotted out inside
 * it.
 *
 * The reveal toggle exists because the realistic failure is a truncated paste,
 * and a credential you cannot look at is one you cannot check before saving.
 *
 * Same labelling arrangement as `TextField` — `htmlFor` rather than a wrapping
 * `<label>` — for the reason `text-field.tsx:5-18` gives: a wrapping label folds
 * the hint into the accessible name.
 */

interface SecretFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Fired on Enter and on blur — the commit points, as in `TextField`. */
  onCommit?: () => void;
  /** Fired on Enter only, never on blur: for an act, like turning sync on, that leaving the field must not do. */
  onSubmit?: () => void;
  placeholder?: string;
  hint?: string;
  className?: string;
  /** Marks the input `aria-invalid`, for an error shown beside it (HIVE-284). */
  invalid?: boolean;
  /** `off` by default; `new-password` where a password manager should offer to save what is typed (HIVE-284). */
  autoComplete?: 'off' | 'new-password';
  /** What the reveal toggle names: "Show the token" by default. */
  secretName?: string;
}

export function SecretField({
  label,
  value,
  onChange,
  onCommit,
  onSubmit,
  placeholder,
  hint,
  className,
  invalid = false,
  autoComplete = 'off',
  secretName = 'token',
}: SecretFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-control text-muted">
        {label}
      </label>

      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          aria-describedby={hint ? hintId : undefined}
          aria-invalid={invalid || undefined}
          /**
           * A password manager offering to fill an Atlassian API token would
           * fill the wrong thing, and a spell-checker sends what it checks to
           * whoever wrote it.
           */
          autoComplete={autoComplete}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommit?.();
              onSubmit?.();
            }
            /**
             * Escape belongs to the settings overlay, not to this field — the
             * same rule `text-field.tsx` follows. Noted so the next person does
             * not add a handler by reflex and break closing the pane.
             */
          }}
          className={cn(
            'min-w-0 flex-1 rounded-full border border-border bg-panel-2 px-3 py-1.5',
            'text-control text-ink outline-none placeholder:text-subtle',
            'focus-visible:ring-1 focus-visible:ring-brand',
          )}
        />

        <button
          type="button"
          aria-label={revealed ? `Hide the ${secretName}` : `Show the ${secretName}`}
          onClick={() => setRevealed((current) => !current)}
          className={cn(
            'rounded-full border border-transparent p-1.5 text-subtle',
            'hover:bg-hover hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
          )}
        >
          {revealed ? <EyeSlash size={14} /> : <Eye size={14} />}
        </button>
      </div>

      {hint ? (
        <span id={hintId} className="text-ui-sm text-subtle">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
