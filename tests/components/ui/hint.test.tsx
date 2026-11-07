import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Hint } from '@components/ui/hint';

describe('Hint', () => {
  it('shows its label on hover, merged onto the child with no wrapper and no native title', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Hint label="Copy the path">
        <button type="button">Copy</button>
      </Hint>,
    );

    const button = screen.getByRole('button', { name: 'Copy' });
    expect(container.firstElementChild).toBe(button);
    expect(button).not.toHaveAttribute('title');
    expect(screen.queryByRole('tooltip')).toBeNull();

    await user.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Copy the path');

    // Like `title`, it goes when the pointer leaves.
    await user.unhover(button);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('describes its element with the label, unless the element is already named by it', () => {
    render(
      <>
        <Hint label="Copy the path">
          <button type="button">Copy</button>
        </Hint>
        <Hint label="Refresh">
          <button type="button" aria-label="Refresh" />
        </Hint>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Copy' })).toHaveAccessibleDescription('Copy the path');
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toHaveAttribute('aria-description');
  });

  it('shows on keyboard focus too', async () => {
    const user = userEvent.setup();
    render(
      <Hint label="Copy the path">
        <button type="button">Copy</button>
      </Hint>,
    );

    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Copy the path');
  });

  it.each([undefined, null, ''])('draws the child alone for label %j', (label) => {
    const { container } = render(
      <Hint label={label}>
        <span>plain</span>
      </Hint>,
    );
    expect(container.innerHTML).toBe('<span>plain</span>');
  });
});
