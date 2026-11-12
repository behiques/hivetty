import { describe, expect, it } from 'vitest';

import {
  LEDGER_MARKER_PREFIX,
  ledgerMarker,
  ledgerMarkers,
  markerListable,
  parseLedgerMarkers,
} from '../../../electron/shared/ledger-contract';

describe('the ledger marker (HIVE-138)', () => {
  it('names an ask by its ref', () => {
    expect(ledgerMarker({ id: '20260906-141530-0001', kind: 'ask', ref: 'a12' })).toBe('📒 a12');
  });

  it('falls back to the id when an ask has no ref', () => {
    expect(ledgerMarker({ id: '20260906-141530-0001', kind: 'ask' })).toBe(
      '📒 20260906-141530-0001',
    );
  });

  it('names an answer by its own id, never the ask ref', () => {
    expect(ledgerMarker({ id: '20260906-141530-0003', kind: 'answer' })).toBe(
      '📒 20260906-141530-0003',
    );
  });

  it('round-trips through the parser, whitespace and a trailing newline included', () => {
    const marker = ledgerMarker({ id: 'x', kind: 'ask', ref: 'a7' });
    expect(parseLedgerMarkers(marker)).toEqual(['a7']);
    expect(parseLedgerMarkers(`${marker}\n`)).toEqual(['a7']);
    expect(parseLedgerMarkers(`  ${marker}  `)).toEqual(['a7']);
    expect(parseLedgerMarkers(ledgerMarker({ id: '20260906-141530-0003', kind: 'answer' }))).toEqual(['20260906-141530-0003']);
  });

  it('rejects anything that is not wholly a marker', () => {
    expect(parseLedgerMarkers('📒 a7 and also do this')).toBeUndefined();
    expect(parseLedgerMarkers('please look at 📒 a7')).toBeUndefined();
    expect(parseLedgerMarkers('📒')).toBeUndefined();
    expect(parseLedgerMarkers('📒 ')).toBeUndefined();
    expect(parseLedgerMarkers('📒 a7; rm -rf /')).toBeUndefined();
    expect(parseLedgerMarkers('')).toBeUndefined();
    expect(parseLedgerMarkers(`${LEDGER_MARKER_PREFIX}../etc`)).toBeUndefined();
  });
});

describe('ledgerMarkers (HIVE-408)', () => {
  it('names every entry in order on one line', () => {
    expect(
      ledgerMarkers([
        { id: '20260906-141530-0001', kind: 'ask', ref: 'a12' },
        { id: '20260906-141530-0003', kind: 'answer' },
      ]),
    ).toBe('📒 a12 20260906-141530-0003');
  });

  it('parses back to the same tokens, and refuses anything a shell would read', () => {
    expect(parseLedgerMarkers('📒 a12 20260906-141530-0003\n')).toEqual(['a12', '20260906-141530-0003']);
    expect(parseLedgerMarkers('📒 a7')).toEqual(['a7']);
    expect(parseLedgerMarkers('📒 a7 $(rm)')).toBeUndefined();
    expect(parseLedgerMarkers('your screen shot 📒 a7')).toBeUndefined();
  });

  it('reads words after a ref as the person writing, not as more refs', () => {
    expect(parseLedgerMarkers('📒 a7 and also do this')).toBeUndefined();
    expect(parseLedgerMarkers('📒 a7 A8')).toEqual(['a7', 'A8']);
    expect(parseLedgerMarkers('📒 a7 a8 foo')).toBeUndefined();
  });

  it('parses back exactly what it writes for every entry it calls listable', () => {
    const entries = [
      { id: '20260906-141530-0001', kind: 'ask' as const, ref: 'a12' },
      { id: '20260906-141530-12345', kind: 'answer' as const },
      { id: '20260906-141530-0002', kind: 'ask' as const },
    ];
    expect(entries.every(markerListable)).toBe(true);
    expect(parseLedgerMarkers(ledgerMarkers(entries))).toEqual(['a12', '20260906-141530-12345', '20260906-141530-0002']);
  });

  it('calls an entry with a hand-edited id unlistable, so it never rides with others', () => {
    expect(markerListable({ id: 'my-note', kind: 'post' })).toBe(false);
    expect(markerListable({ id: 'my-note', kind: 'ask', ref: 'a3' })).toBe(true);
  });
});
