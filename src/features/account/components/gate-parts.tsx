import { Spinner } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '@components/ui/button';
import { signOut } from '@lib/account';

/**
 * The pieces the gate's card (HIVE-265) and its lapsed view share, here so that `gate.tsx` and `lapsed-view.tsx`
 * import them without importing each other.
 */

export const quit = (): void => void window.hive?.appQuit();

export const LINK = 'text-brand underline underline-offset-2 hover:text-ink';

export function Heading({ children }: { children: ReactNode }) {
  return <h2 className="text-[20px] font-semibold text-ink">{children}</h2>;
}

export function Waiting({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border-soft bg-panel-2 p-3 text-control">
      <Spinner size={16} className="mt-0.5 shrink-0 animate-spin text-brand motion-reduce:animate-none" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}

/**
 * email · Sign out, then Quit; "Signed out" when revoked; Quit alone when signed out. Sign out here needs no
 * confirm: the gate already stopped everything.
 */
export function GateFooter({ email, revoked = false }: { email?: string; revoked?: boolean }) {
  return (
    <>
      <div className="h-px bg-border-soft" />
      <div className={cn('flex items-center gap-2', email || revoked ? 'justify-between' : 'justify-end')}>
        {email ? (
          <span className="text-ui-sm text-subtle">
            <span>{email}</span>
            {' · '}
            <button type="button" className={LINK} onClick={() => void signOut()}>
              Sign out
            </button>
          </span>
        ) : revoked ? (
          <span className="text-ui-sm text-subtle">Signed out</span>
        ) : null}
        <Button variant="ghost" onClick={quit}>
          Quit
        </Button>
      </div>
    </>
  );
}

/** Choose a plan's wait, shared by welcome and the lapse reasons that use it. */
export function PlanWait({ cancel }: { cancel: () => void }) {
  return (
    <>
      <Waiting>
        <span>Finish in your browser…</span>
      </Waiting>
      <div className="flex justify-end">
        <Button onClick={cancel}>Cancel</Button>
      </div>
    </>
  );
}
