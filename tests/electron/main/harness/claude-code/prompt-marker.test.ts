// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../../../../electron/main/harness/claude-code';
import { promptMarker } from '../../../../../electron/main/harness/claude-code/prompt-marker';
import { ledgerMarkers, type LedgerEntry } from '../../../../../electron/shared/ledger-contract';

const entry: LedgerEntry = {
  id: '20261021-120000-0001',
  ts: 0,
  ref: 'k7',
  from: 'overmind',
  to: 'sess-a',
  kind: 'ask',
  body: 'which branch?',
};

describe('promptMarker (HIVE-240)', () => {
  it('types the ledger marker and the carriage return that submits it', () => {
    expect(promptMarker([entry])).toBe(`${ledgerMarkers([entry])}\r`);
    expect(promptMarker([entry])).not.toContain('which branch?');
  });

  it('names every entry on one line, in order, with one carriage return (HIVE-408)', () => {
    const a = { ...entry, ref: 'a12' };
    const b = { ...entry, id: '20261021-120000-0002', ref: 'a13' };
    expect(promptMarker([a, b])).toBe('📒 a12 a13\r');
  });

  it('is what Claude Code declares, as a prompt-marker harness', () => {
    expect(claudeCodeAdapter.promptMarker).toBe(promptMarker);
    expect(claudeCodeAdapter.capabilities.contextDelivery).toBe('prompt-marker');
  });
});
