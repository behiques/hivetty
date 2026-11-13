import { describe, expect, it } from 'vitest';
import { OVERMIND, type LedgerEntry } from '@shared/ledger-contract';

import { prOpenedEntry } from '../../../../electron/main/ledger/pr-opened';
import { prClaimOf } from '@stores/hive-store';

describe('prOpenedEntry', () => {
  it("is an overmind event naming the session and the PR, broadcast", () => {
    expect(prOpenedEntry('sess-19', { slug: 'behiques/hivetty-cloud', number: 46 })).toEqual({
      from: OVERMIND,
      kind: 'event',
      body: 'sess-19 opened behiques/hivetty-cloud#46',
      meta: { prOpened: 'sess-19', pr: 46, repo: 'behiques/hivetty-cloud' },
    });
  });

  // The seam: what main writes is what the renderer reads as the session's own PR.
  it("reads back in the renderer as that session's owned PR", () => {
    const entry: LedgerEntry = { id: '20261113-150000-0001', ts: 0, ...prOpenedEntry('sess-19', { slug: 'behiques/hivetty-cloud', number: 46 }) };
    expect(prClaimOf(entry)).toEqual({
      session: 'sess-19',
      pr: { number: 46, repo: 'hivetty-cloud', url: 'https://github.com/behiques/hivetty-cloud/pull/46', owned: true },
    });
  });
});
