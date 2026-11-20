import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TicketFlowTab } from '@features/work/components/ticket-flow-tab';
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

describe('TicketFlowTab (Job Flow)', () => {
  it('reads the job by the ticket key alone, and names the ticket when there is nothing yet', async () => {
    render(<TicketFlowTab ticketKey="HIVE-401" />);
    expect(job).toHaveBeenCalledWith({ ticket: 'HIVE-401', prs: [] });
    expect(await screen.findByText('No agent or session has written about HIVE-401 yet.')).toBeTruthy();
  });
});
