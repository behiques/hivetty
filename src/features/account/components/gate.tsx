import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '@components/ui/button';
import { GateFooter, Heading, LINK, PlanWait, Waiting } from '@features/account/components/gate-parts';
import { LapsedView } from '@features/account/components/lapsed-view';
import { useChoosePlan } from '@features/account/hooks/use-choose-plan';
import type { GateView } from '@features/account/lib/gate-view';
import { cancelSignIn, signIn } from '@lib/account';
import { startTrial } from '@lib/licence';
import type { DeviceCode } from '@shared/account-contract';

/**
 * The licence gate's card (HIVE-265). The prototype's layout and copy: a heading, the actions, at most one line,
 * and a footer. While it shows, only these actions, Sign out and Quit are reachable.
 */

type ShownView = Exclude<GateView, { kind: 'loading' | 'open' }>;

/**
 * shortcut: the cloud tells the app a trial is used only through POST /api/trial, so this latch lasts for the
 * window's life. A relaunch shows Start trial again until the next 409. Upgrade when the lease or the account
 * says whether a trial is used.
 */
let trialUsed = false;
/** Test-only. */
export function resetTrialLatch(): void {
  trialUsed = false;
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full max-w-[460px] flex-col gap-4 rounded-xl border border-border bg-panel p-6">
      <div className="flex items-center gap-2.5">
        <span className="text-ui font-semibold text-ink">
          HiveTTY <span className="text-brand">Pro</span>
        </span>
      </div>
      {children}
    </div>
  );
}

function SignIn({ message, onSignInWithCode }: { message?: string; onSignInWithCode: () => void }) {
  return (
    <>
      <Heading>Sign in to HiveTTY Pro</Heading>
      <Button variant="primary" className="w-full" onClick={() => void signIn()}>
        Sign in with browser
      </Button>
      <button type="button" className={cn(LINK, 'self-start text-control')} onClick={onSignInWithCode}>
        Sign in with a code
      </button>
      {message ? <p className="text-ui-sm text-red">{message}</p> : null}
      <GateFooter />
    </>
  );
}

function WaitingBrowser() {
  return (
    <>
      <Heading>Continue in your browser</Heading>
      <Waiting>
        <span>Waiting for the browser…</span>
        <span className="text-ui-sm text-subtle">
          <button type="button" className={LINK} onClick={() => void signIn()}>
            Open again
          </button>
        </span>
      </Waiting>
      <div className="flex justify-end">
        <Button onClick={() => void cancelSignIn()}>Cancel</Button>
      </div>
    </>
  );
}

/** `null`: asked, and main has not pushed the code yet. */
function WaitingCode({ code }: { code: DeviceCode | null }) {
  return (
    <>
      <Heading>Sign in with a code</Heading>
      {code ? (
        <>
          <p className="text-control text-muted">
            {'On any device, open '}
            {/* target=_blank: window.ts's open handler sends http(s) to the browser. */}
            <a className={LINK} href={code.verificationUriComplete} target="_blank" rel="noreferrer">
              {code.verificationUri.replace(/^https?:\/\//, '')}
            </a>
            {' and enter:'}
          </p>
          <div className="rounded-lg border border-border-soft bg-panel-2 p-3 text-center font-mono text-[22px] font-semibold tracking-[0.12em] text-ink">
            {code.userCode}
          </div>
        </>
      ) : null}
      <Waiting>
        <span>{code ? 'Waiting for approval…' : 'Getting a code…'}</span>
      </Waiting>
      <div className="flex justify-end">
        <Button onClick={() => void cancelSignIn()}>Cancel</Button>
      </div>
    </>
  );
}

function Revoked() {
  return (
    <>
      <div className="flex items-start gap-2.5">
        <span className="mt-2.5 size-2 shrink-0 rounded-full bg-red" aria-hidden />
        <div className="flex flex-col gap-1">
          <Heading>This Mac was signed out</Heading>
          <p className="text-control text-muted">It was removed from your account.</p>
        </div>
      </div>
      <Button variant="primary" className="w-full" onClick={() => void signIn()}>
        Sign in again
      </Button>
      <GateFooter revoked />
    </>
  );
}

function Welcome({ firstName, email }: { firstName: string; email: string }) {
  const choose = useChoosePlan();
  const [hidden, setHidden] = useState(trialUsed);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onTrial = async (): Promise<void> => {
    setStarting(true);
    setError(null);
    const result = await startTrial();
    setStarting(false);
    if (result === null || 'ok' in result) return; // the licence push opens the gate
    if (result.error === 'trial_used' || result.error === 'already_subscribed') {
      trialUsed = true;
      setHidden(true);
    } else {
      setError(result.error);
    }
  };

  const shownError = error ?? choose.error;

  return (
    <>
      <Heading>{`Welcome, ${firstName}`}</Heading>
      {choose.waiting ? (
        <PlanWait cancel={choose.cancel} />
      ) : (
        <div className="flex flex-col gap-2">
          {hidden ? null : (
            <>
              <Button variant="primary" className="w-full" pending={starting} onClick={() => void onTrial()}>
                Start 14-day free trial
              </Button>
              <span className="text-ui-sm text-subtle">No card needed.</span>
            </>
          )}
          <Button variant={hidden ? 'primary' : 'secondary'} className="w-full" onClick={choose.start}>
            Choose a plan
          </Button>
          {shownError ? <p className="text-ui-sm text-red">{shownError}</p> : null}
        </div>
      )}
      <GateFooter email={email} />
    </>
  );
}

export function Gate({ view, onSignInWithCode }: { view: ShownView; onSignInWithCode: () => void }) {
  return (
    <Card>
      {view.kind === 'sign-in' && <SignIn message={view.message} onSignInWithCode={onSignInWithCode} />}
      {view.kind === 'waiting-browser' && <WaitingBrowser />}
      {view.kind === 'waiting-code' && <WaitingCode code={view.code} />}
      {view.kind === 'revoked' && <Revoked />}
      {view.kind === 'welcome' && <Welcome firstName={view.firstName} email={view.email} />}
      {view.kind === 'lapsed' && <LapsedView view={view} />}
    </Card>
  );
}
