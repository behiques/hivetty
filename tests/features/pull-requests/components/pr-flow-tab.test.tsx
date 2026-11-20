import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrFlowTab } from '@features/pull-requests/components/pr-flow-tab';
import { useHiveStore } from '@stores/hive-store';

const job = vi.fn();
let hive: unknown;
beforeEach(() => {
  hive = window.hive;
  (window as unknown as { hive: unknown }).hive = { ledger: { job } };
  useHiveStore.setState({ jobs: {}, ledger: [] });
  job.mockResolvedValue({ entries: [], warnings: [] });
});
afterEach(() => {
  (window as unknown as { hive: unknown }).hive = hive;
  job.mockReset();
});

describe('PrFlowTab (Job Flow)', () => {
  it('reads the job by the PR as owner/name and number, and names the PR when there is nothing yet', async () => {
    render(<PrFlowTab pr={{ owner: 'behiques', repo: 'hivetty', n: 281 }} />);
    expect(job).toHaveBeenCalledWith({ prs: [{ repo: 'behiques/hivetty', n: 281 }] });
    expect(await screen.findByText('No agent or session has written about #281 yet.')).toBeTruthy();
  });
});
