import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { launchHive, startSession } from './fixtures/hive-app';

/**
 * Delivery in the built app (HIVE-408): a background shell holds a nudge for a
 * minute, not for ever, and a keystroke holds one while its draft report is a
 * frame behind.
 *
 * ## What this proves
 *
 * 1. A session that ended its turn with `pnpm dev` running in the background
 *    derives `idle` with a live background shell. Before HIVE-408 a nudge
 *    waited behind it for ever, because a dev server never ends. Now it lands
 *    about a minute after the turn ended (`BG_SHELL_HOLD_MS`).
 * 2. An entry that lands right after a keystroke is not typed into the box:
 *    the renderer reports the draft a frame after the echo, and main holds the
 *    session for `TYPING_HOLD_MS` after the keystroke. Once the draft is
 *    cleared the same nudge lands, on its own line.
 *
 * ## Why it is opt-in
 *
 * It spawns a real `claude`, which costs real tokens and takes a couple of
 * minutes, the same trade `nudge-splice.spec.ts` makes.
 *
 * ```
 * pnpm test:delivery
 * ```
 */
const enabled = process.env.HIVE_LIVE_DELIVERY_PROOF === '1';

const PROJECT = 'delivery-proof';
const SINK = '__hiveDeliveryOutput';
const STATUS = '__hiveDeliveryStatus';

function scratchProject(root: string): string {
  const dir = join(root, 'delivery-proof-repo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# scratch\n');
  // A dev server stand-in that never ends, as `pnpm dev` does not.
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'delivery-proof', private: true, scripts: { dev: 'node -e "setInterval(() => {}, 1000)"' } }),
  );
  return dir;
}

function writeConfig(path: string, projectPath: string): void {
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      shell: '/bin/sh',
      /*
        Only `pnpm dev` may run. No `; false` after it, unlike `nudge-splice.spec.ts`: the app
        appends its hook settings to this command, and behind `; false` they went to `false`, so
        no hook reported the background shell and the session read as plainly idle.
      */
      claudeCommand: 'claude --allowedTools "Bash(pnpm dev)"',
      projects: [{ id: PROJECT, path: projectPath }],
    }),
  );
}

async function collect(page: Page, sessionId: string): Promise<void> {
  await page.evaluate(
    ([sink, status, id]) => {
      const store = window as unknown as Record<string, string>;
      store[sink!] = '';
      store[status!] = '';
      window.hive!.pty.onData((event) => {
        if (event.sessionId !== id) return;
        store[sink!] += event.chunk;
      });
      window.hive!.session.onStatus((event) => {
        if (event.entityId !== id) return;
        store[status!] = `${event.status}${event.idleDetail === undefined ? '' : `:${event.idleDetail}`}`;
      });
    },
    [SINK, STATUS, sessionId],
  );
}

const output = (page: Page): Promise<string> =>
  page.evaluate((sink) => (window as unknown as Record<string, string>)[sink] ?? '', SINK);

const status = (page: Page): Promise<string> =>
  page.evaluate((key) => (window as unknown as Record<string, string>)[key] ?? '', STATUS);

async function tail(page: Page, lines = 24): Promise<string> {
  // eslint-disable-next-line no-control-regex
  const plain = (await output(page)).replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '');
  return plain.split('\n').slice(-lines).join('\n');
}

async function settle(page: Page, quietMs = 400): Promise<void> {
  let last = (await output(page)).length;
  let quietSince = Date.now();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const now = (await output(page)).length;
    if (now !== last) {
      last = now;
      quietSince = Date.now();
      continue;
    }
    if (Date.now() - quietSince >= quietMs) return;
  }
}

async function ask(page: Page, to: string, body: string): Promise<string> {
  const result = await page.evaluate(
    ([target, text]) => window.hive!.ledger.post({ to: target!, kind: 'ask', body: text! }),
    [to, body],
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result.ok ? (result.ref ?? result.id) : '';
}

test.skip(!enabled, 'set HIVE_LIVE_DELIVERY_PROOF=1 — spawns a real claude');

test('a nudge lands a minute after a turn under pnpm dev, and never in a box being typed into', async ({}, testInfo) => {
  test.setTimeout(540_000);
  const configPath = testInfo.outputPath('hive-config.json');
  writeConfig(configPath, scratchProject(testInfo.outputPath('.')));

  const app = await launchHive({ userDataDir: testInfo.outputPath('user-data'), configPath });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('nav[aria-label="Places"]');
    const session = await startSession(page, PROJECT);
    await collect(page, session);

    const terminal = page.locator(`[data-terminal-id="${session}"]`);
    await expect(terminal).toBeVisible();
    await expect
      .poll(() => output(page), { timeout: 120_000, intervals: [1_000] })
      .toMatch(/shift\+tab to cycle|for shell mode|\? for shortcuts/u);
    const cover = page.getByTestId('session-boot-cover');
    if (await cover.isVisible()) {
      await page.keyboard.press('Shift');
      await expect(cover).toHaveCount(0, { timeout: 15_000 });
    }
    await expect.poll(() => status(page), { timeout: 60_000, intervals: [500] }).toMatch(/^idle/u);

    // 1. Start `pnpm dev` in the background and end the turn.
    await terminal.click();
    await settle(page);
    await page.keyboard.type(
      'Use the Bash tool with run_in_background set to true to run exactly `pnpm dev`. Do not wait for it or read its output. Then reply with the single word started.',
    );
    await settle(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => status(page), { timeout: 60_000, intervals: [500] }).toMatch(/^working/u);
    await expect.poll(() => status(page), { timeout: 120_000, intervals: [500] }).toMatch(/^idle/u);
    const turnEnded = Date.now();
    // Claude's own footer says the shell outlived the turn: the case the hold exists for.
    await expect.poll(() => output(page), { timeout: 10_000, intervals: [250] }).toMatch(/shells? still running/u);

    const bg = `BGSHELL-${Date.now()}`;
    const bgMarker = `📒 ${await ask(page, session, `Reply with ${bg} and nothing else.`)}`;
    await page.waitForTimeout(10_000);
    expect(await output(page), `held behind the background shell:\n${await tail(page)}`).not.toContain(bgMarker);

    await expect
      .poll(() => output(page), { timeout: 80_000, intervals: [500] })
      .toContain(bgMarker);
    const landedAfter = Date.now() - turnEnded;
    console.info(`DRIVE bg-shell nudge landed ${landedAfter} ms after the turn ended`);
    expect(landedAfter).toBeGreaterThanOrEqual(55_000);
    expect(landedAfter).toBeLessThan(80_000);

    // 2. A keystroke, then an entry inside the frame its draft report trails.
    await expect.poll(() => status(page), { timeout: 120_000, intervals: [500] }).toMatch(/^idle/u);
    // `pnpm dev` is still running, so the turn the nudge started ended under the same minute's hold.
    // Let it lapse, so the only thing holding the next nudge is the keystroke.
    await page.waitForTimeout(62_000);
    await terminal.click();
    await settle(page);
    const typed = 'w';
    await page.keyboard.type(typed);
    const typedMarker = `📒 ${await ask(page, session, `Reply with TYPED-${Date.now()} and nothing else.`)}`;

    await page.waitForTimeout(5_000);
    expect(await output(page), `held while typing:\n${await tail(page)}`).not.toContain(typedMarker);

    await page.keyboard.press('Backspace');
    await settle(page);
    await expect
      .poll(() => output(page), { timeout: 30_000, intervals: [500] })
      .toContain(typedMarker);
    expect(await output(page)).not.toContain(`${typed}📒`);
    console.info('DRIVE typing hold: marker held while a draft was in the box, landed alone once it cleared');
  } finally {
    await app.close();
  }
});
