import { useEffect, useMemo } from 'react';

import type { HatcheryRow } from '@/types/pull-request';

import { openRowIndex } from '@lib/open-row';
import { prKey, useHatchery } from '@stores/hive-store';
import { usePrPage, usePrPageAt, useRememberPrPage, type PrPageRef } from '@stores/ui-store';

const rowKey = (row: HatcheryRow): string => prKey(row.pr.owner, row.pr.repo, row.pr.n);

/** {@link openPrRow}, with where the row sits: `-1` for one that is not a row of the sweep. */
function openPr(
  rows: readonly HatcheryRow[],
  last: PrPageRef | null,
  at: number,
): { row: HatcheryRow; index: number } | null {
  const index = openRowIndex(rows.map(rowKey), last === null ? null : prKey(last.owner, last.repo, last.n), at);
  if (index === null) return null;
  if (index >= 0) return { row: rows[index], index };
  const kept = last?.row ?? rows[0];
  return kept === undefined ? null : { row: kept, index: kept === rows[0] ? 0 : -1 };
}

/**
 * Which PR the PRs place shows (HIVE-205, spec D14): the one last opened while
 * it is still a row (or came from a search, carried on the ref), else the row
 * that came after it (`openRowIndex`), else the top row. SUMMONS sorts first in
 * `useHatchery()`, so the top row is the first PR that needs you when one does.
 * `null` with no rows: the empty Hatchery. Derived on every read, so a PR
 * leaving the list falls back with no action.
 */
export function openPrRow(rows: readonly HatcheryRow[], last: PrPageRef | null, at = -1): HatcheryRow | null {
  return openPr(rows, last, at)?.row ?? null;
}

/**
 * {@link openPrRow} over the Hatchery and the ui-store's last-shown PR. What is
 * shown from the sweep is written back as remembered, so a return to PRs finds
 * it and the row after it takes over when it leaves.
 */
export function useOpenPr(): HatcheryRow | null {
  const rows = useHatchery();
  const last = usePrPage();
  const at = usePrPageAt();
  const remember = useRememberPrPage();
  const shown = useMemo(() => openPr(rows, last, at), [rows, last, at]);

  useEffect(() => {
    if (shown === null || shown.index < 0) return;
    const { owner, repo, n } = shown.row.pr;
    remember({ owner, repo, n }, shown.index);
  }, [shown, remember]);

  return shown?.row ?? null;
}
