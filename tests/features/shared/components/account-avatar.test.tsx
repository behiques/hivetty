import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccountAvatar } from '@features/shared/components/account-avatar';

describe('AccountAvatar (HIVE-265)', () => {
  it('renders the letter and is hidden from assistive tech', () => {
    render(<AccountAvatar initial="A" />);
    const avatar = screen.getByText('A');
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
    expect(avatar).toHaveClass('size-6');
  });

  it('lg is larger than sm', () => {
    render(<AccountAvatar initial="B" size="lg" />);
    const avatar = screen.getByText('B');
    expect(avatar).toHaveClass('size-10');
    expect(avatar).not.toHaveClass('size-6');
  });

  it('draws the badge in its corner when given one (HIVE-291)', () => {
    render(<AccountAvatar initial="A" badge="AC" />);
    expect(screen.getByText('AC').parentElement).toBe(screen.getByText('A'));
  });

  it('draws no badge without one (HIVE-291)', () => {
    render(<AccountAvatar initial="A" />);
    expect(screen.getByText('A').children).toHaveLength(0);
  });
});
