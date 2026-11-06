import { execFileSync } from 'node:child_process';

import { assert, describe, emitSentinel, it, waitFor } from './harness.mjs';

/**
 * Suspend and resume on a licence lapse (HIVE-267). A mock can assert SIGSTOP was sent. Only a real process
 * table can show the shell, its job and the job's child all sitting in state T, and then finishing normally.
 */

const stat = (pid) => {
  try {
    return execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const children = (ppid) =>
  execFileSync('/bin/ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([, parent]) => parent === ppid)
    .map(([pid]) => pid);

describe('suspend', () => {
  it('stops the shell, a job and its child, then continues them to a normal finish', async (context) => {
    const session = await context.ready(context.open());
    // A job (sh) with a child (sleep): two levels under the shell, as the AC asks.
    session.send(`sh -c 'sleep 2; exit 0' && ${emitSentinel('JOB-DONE')}`);
    let job;
    await waitFor(() => (job = children(session.pid)[0]) !== undefined, { message: 'the job to start' });
    let sleeper;
    await waitFor(() => (sleeper = children(job)[0]) !== undefined, { message: 'the sleep to start' });

    await context.manager.suspendAll();
    for (const pid of [session.pid, job, sleeper]) {
      assert.ok(stat(pid).startsWith('T'), `pid ${pid} should be stopped, ps says "${stat(pid)}"`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2500)); // past the sleep's own end
    assert.ok(!session.output.includes('JOB-DONE'), 'nothing runs while suspended');

    await context.manager.resumeAll('Resumed after licence renewal.');
    await session.waitForOutput('JOB-DONE', { timeout: 8_000 });
    assert.ok(session.output.includes('Resumed after licence renewal.'), 'the notice reached the terminal');
    assert.equal(session.exit, null, 'the pty did not exit along the way');
  });

  it('shuts down cleanly while suspended, leaving no stopped process behind', async (context) => {
    const session = await context.ready(context.open());
    session.send('sleep 30');
    let sleeper;
    await waitFor(() => (sleeper = children(session.pid)[0]) !== undefined, { message: 'the sleep to start' });
    await context.manager.suspendAll();
    assert.ok(stat(sleeper).startsWith('T'), `the sleep should be stopped, ps says "${stat(sleeper)}"`);
    await context.manager.resumeAll();
    await context.manager.killAll();
    await waitFor(() => stat(sleeper) === '' && stat(session.pid) === '', { message: 'every process to be gone' });
  });
});
