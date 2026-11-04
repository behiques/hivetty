import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_GAPS,
  capabilitySummary,
  HarnessCapabilities,
} from '@features/settings/components/harness-capabilities';

describe('HarnessCapabilities (HIVE-376)', () => {
  it('lists what Claude Code supports', () => {
    render(<HarnessCapabilities cli="claude-code" />);
    expect(screen.getByRole('row', { name: /Agent cost in USD/ })).toHaveTextContent('Yes');
    expect(screen.getByRole('row', { name: /Integrations in agent runs/ })).toHaveTextContent('slack');
  });
  it('says Not supported for a gap with no ticket, and Planned with its key for one with', () => {
    // No gap is open today (HIVE-335 shipped Copilot's meters); one stands in to prove the row.
    CAPABILITY_GAPS.copilot = { enforcesTurns: 'HIVE-999' };
    try {
      render(<HarnessCapabilities cli="copilot" />);
      expect(screen.getByRole('row', { name: /Agent cost in USD/ })).toHaveTextContent('Not supported');
      expect(screen.getByRole('row', { name: /Agent turn limit/ })).toHaveTextContent('Planned · HIVE-999');
      expect(screen.queryByRole('link')).toBeNull();
    } finally {
      delete CAPABILITY_GAPS.copilot;
    }
  });
  it('lists the meters Copilot reports (HIVE-335)', () => {
    render(<HarnessCapabilities cli="copilot" />);
    expect(screen.getByRole('row', { name: /Meters/ })).toHaveTextContent('model, context, tokens, aiCredits');
  });
  it('counts the supported rows', () => {
    expect(capabilitySummary('claude-code')).toEqual({ supported: 9, total: 9 });
    expect(capabilitySummary('codex').supported).toBeLessThan(9);
  });
  it('says whether the CLI runs in a container (HIVE-377)', () => {
    const { unmount } = render(<HarnessCapabilities cli="claude-code" />);
    expect(screen.getByRole('row', { name: /Runs in a container/ })).toHaveTextContent('Yes');
    unmount();
    render(<HarnessCapabilities cli="codex" />);
    expect(screen.getByRole('row', { name: /Runs in a container/ })).toHaveTextContent('Not supported');
  });
});
