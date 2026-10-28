import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CliMark } from '@components/ui/cli-mark';
import { HARNESS_IDS } from '@shared/harness-contract';

describe('CliMark', () => {
  it.each(HARNESS_IDS)('draws %s as its own logo, in the colour of its text', (cli) => {
    const { container } = render(<CliMark cli={cli} />);
    const mark = container.firstElementChild!;

    expect(mark.tagName.toLowerCase()).toBe('svg');
    expect(mark).toHaveAttribute('data-cli', cli);
    // Monochrome: the caller's text colour paints it.
    expect(mark).toHaveAttribute('fill', 'currentColor');
    // No letter any more.
    expect(mark.textContent).toBe('');
    // Decorative: the CLI's name is always written beside it.
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws a different logo for each CLI', () => {
    const paths = HARNESS_IDS.map(
      (cli) => render(<CliMark cli={cli} />).container.querySelector('path')!.getAttribute('d'),
    );
    expect(new Set(paths).size).toBe(HARNESS_IDS.length);
  });

  it('is 16px unless its caller sizes it, and takes a class from its caller', () => {
    const { container } = render(<CliMark cli="codex" className="ml-1 size-[26px]" />);

    expect(container.firstElementChild).toHaveClass('ml-1', 'size-[26px]');
    expect(container.firstElementChild).not.toHaveClass('size-4');
  });
});
