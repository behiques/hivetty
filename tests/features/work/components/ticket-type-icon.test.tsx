import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TicketTypeIcon } from '@features/work/components/ticket-type-icon';

/** The issue type beside a ticket's key: Work row, ticket page, Ticket tab. */

describe('TicketTypeIcon', () => {
  it.each([
    ['Bug', 'text-red'],
    ['Story', 'text-green'],
    ['Task', 'text-code-type'],
    ['Sub-task', 'text-code-type'],
    ['Subtask', 'text-code-type'],
    ['Epic', 'text-code-keyword'],
    ['bug', 'text-red'],
  ])('tints a %s %s, named by its type', (type, tint) => {
    render(<TicketTypeIcon type={type} />);

    const icon = screen.getByRole('img', { name: type });
    expect(icon).toHaveClass(tint);
    expect(icon.querySelector('svg')).not.toBeNull();
  });

  it('draws a distinct glyph per mapped type', () => {
    const glyph = (type: string) => {
      const { container, unmount } = render(<TicketTypeIcon type={type} />);
      const d = container.querySelector('path')?.getAttribute('d');
      unmount();
      return d;
    };

    const glyphs = ['Bug', 'Story', 'Task', 'Sub-task', 'Epic'].map(glyph);
    expect(new Set(glyphs).size).toBe(5);
  });

  it('falls back to a quiet circle for a type it does not know, still named', () => {
    render(<TicketTypeIcon type="Spike" />);

    expect(screen.getByRole('img', { name: 'Spike' })).toHaveClass('text-subtle');
  });

  it('draws nothing without a type', () => {
    const { container } = render(<TicketTypeIcon type={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});
