import { useMemo } from 'react';

import type { HatcheryRow } from '@/types/pull-request';

import { useHatchery } from '@stores/hive-store';
import { usePrPage, type PrPageRef } from '@stores/ui-store';

const isRef = (row: HatcheryRow, ref: PrPageRef): boolean =>
  row.pr.n === ref.n &&
  row.pr.owner.toLowerCase() === ref.owner.toLowerCase() &&
  row.pr.repo.toLowerCase() === ref.repo.toLowerCase();

/**
 * Which PR the PRs place shows (HIVE-205, spec D14): the one last opened while
 * it is still a row (or came from a search, carried on the ref), else the top row. SUMMONS sorts first in `useHatchery()`,
 * so the top row is the first PR that needs you when one does. `null` with no
 * rows: the empty Hatchery. Derived on every read, so a PR leaving the list
 * falls back with no action.
 */
export function openPrRow(rows: readonly HatcheryRow[], last: PrPageRef | null): HatcheryRow | null {
  const kept = last === null ? undefined : (rows.find((row) => isRef(row, last)) ?? last.row);
  return kept ?? rows[0] ?? null;
}

/** {@link openPrRow} over the Hatchery and the ui-store's last-opened PR. */
export function useOpenPr(): HatcheryRow | null {
  const rows = useHatchery();
  const last = usePrPage();
  return useMemo(() => openPrRow(rows, last), [rows, last]);
}
