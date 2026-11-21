import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SwarmGroup } from '@features/settings/components/swarm-group';

describe('SwarmGroup', () => {
  it('draws a region named by its title, with a header that folds and unfolds its rows', async () => {
    render(
      <SwarmGroup title="Dev Squad" counts="5 of 5 on">
        <button type="button">acr</button>
      </SwarmGroup>,
    );

    expect(screen.getByRole('region', { name: 'Dev Squad' })).toBeInTheDocument();
    const header = screen.getByRole('button', { name: /Dev Squad/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(header).toHaveTextContent('5 of 5 on');
    expect(screen.getByRole('button', { name: 'acr' })).toBeInTheDocument();

    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'acr' })).toBeNull();

    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'acr' })).toBeInTheDocument();
  });
});
