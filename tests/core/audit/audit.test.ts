import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { audit, onAudit, type AuditEntry } from '../../../core/audit/audit';
import { CONFIG_PATH_ENV } from '../../../shared/config-contract';

let home: string;
const dir = () => join(home, 'audit');
const lines = (day: string): AuditEntry[] =>
  readFileSync(join(dir(), `${day}.jsonl`), 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line) as AuditEntry);
const attach = { event: 'attach', deviceId: 'dev-1', deviceName: 'MacBook', via: 'direct' } as const;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hive-audit-'));
  vi.stubEnv(CONFIG_PATH_ENV, join(home, 'config.json'));
  vi.stubEnv('HIVETTY_AUDIT', '');
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 18, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe('the file sink', () => {
  it('appends one stamped JSON line per entry to the local day file, 0600 in a 0700 folder', () => {
    audit(attach);
    audit({ event: 'call', deviceId: 'dev-1', deviceName: 'MacBook', via: 'relay', channel: 'pty:spawn-terminal', sessionId: 's1' });
    const written = lines('2026-11-18');
    expect(written).toEqual([
      { at: new Date(2026, 10, 18, 12).toISOString(), ...attach },
      expect.objectContaining({ event: 'call', via: 'relay', channel: 'pty:spawn-terminal', sessionId: 's1' }),
    ]);
    expect(statSync(join(dir(), '2026-11-18.jsonl')).mode & 0o777).toBe(0o600);
    expect(statSync(dir()).mode & 0o777).toBe(0o700);
  });

  it('writes the file for an unknown HIVETTY_AUDIT value', () => {
    vi.stubEnv('HIVETTY_AUDIT', 'both');
    audit(attach);
    expect(lines('2026-11-18')).toHaveLength(1);
  });

  it('starts a new file at local midnight', () => {
    vi.setSystemTime(new Date(2026, 10, 18, 23, 59, 59));
    audit(attach);
    vi.setSystemTime(new Date(2026, 10, 19, 0, 0, 1));
    audit(attach);
    expect(readdirSync(dir()).sort()).toEqual(['2026-11-18.jsonl', '2026-11-19.jsonl']);
  });

  it('prunes day files older than 30 days on the first write of a day, and nothing else', () => {
    mkdirSync(dir(), { recursive: true });
    for (const name of ['2026-10-18.jsonl', '2026-10-19.jsonl', 'notes.txt', '2026-10-01.jsonl.bak']) {
      writeFileSync(join(dir(), name), '');
    }
    audit(attach);
    expect(readdirSync(dir()).sort()).toEqual(['2026-10-01.jsonl.bak', '2026-10-19.jsonl', '2026-11-18.jsonl', 'notes.txt']);
  });

  it('logs once and does not throw while the file cannot be written, then logs again after a recovery', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeFileSync(join(home, 'audit'), 'a file where the folder should be');
    const seen: AuditEntry[] = [];
    const off = onAudit((entry) => seen.push(entry));
    expect(() => { audit(attach); audit(attach); }).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(2);
    rmSync(join(home, 'audit'));
    audit(attach);
    writeFileSync(join(home, 'config.json'), '');
    vi.stubEnv(CONFIG_PATH_ENV, join(home, 'config.json', 'nested', 'config.json'));
    audit(attach);
    expect(error).toHaveBeenCalledTimes(2);
    off();
  });

  it('recreates the folder when it disappears mid-day', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    audit(attach);
    rmSync(dir(), { recursive: true });
    audit(attach);
    audit(attach);
    expect(lines('2026-11-18')).toHaveLength(1);
    expect(statSync(dir()).mode & 0o777).toBe(0o700);
  });
});

describe('the stdout sink', () => {
  it("writes exactly 'audit ' plus the JSON and a newline, and no file", () => {
    vi.stubEnv('HIVETTY_AUDIT', 'stdout');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    audit(attach);
    expect(write).toHaveBeenCalledWith(`audit ${JSON.stringify({ at: new Date(2026, 10, 18, 12).toISOString(), ...attach })}\n`);
    expect(() => readdirSync(dir())).toThrow();
  });
});

describe('onAudit', () => {
  it('delivers every entry under both sinks, stops after unsubscribe, and survives a throwing listener', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const seen: AuditEntry[] = [];
    const offThrower = onAudit(() => { throw new Error('boom'); });
    const off = onAudit((entry) => seen.push(entry));
    audit(attach);
    vi.stubEnv('HIVETTY_AUDIT', 'stdout');
    audit({ ...attach, event: 'detach' });
    off();
    audit(attach);
    offThrower();
    expect(seen.map((entry) => entry.event)).toEqual(['attach', 'detach']);
    expect(seen[0]?.at).toBe(new Date(2026, 10, 18, 12).toISOString());
  });
});
