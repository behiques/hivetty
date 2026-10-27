import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CliMark } from '@components/ui/cli-mark';

describe('CliMark (HIVE-279)', () => {
  it.each([
    ['claude-code', 'C', 'bg-brand-fill'],
    ['codex', 'X', 'bg-green'],
    ['copilot', 'G', 'bg-subtle'],
  ] as const)('marks %s with its letter on its token fill', (cli, letter, fill) => {
    const { container } = render(<CliMark cli={cli} />);
    const mark = container.firstElementChild!;

    expect(mark).toHaveTextContent(letter);
    expect(mark).toHaveClass(fill);
    // Decorative: the CLI's name is always written beside it.
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes a class from its caller', () => {
    const { container } = render(<CliMark cli="codex" className="ml-1" />);

    expect(container.firstElementChild).toHaveClass('ml-1');
  });
});
