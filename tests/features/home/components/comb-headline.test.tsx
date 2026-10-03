import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CombHeadline, headlineText, summaryText } from '@features/home/components/comb-headline';

const BUSY = { working: 4, failed: 1, resting: 3, projects: 3, agents: 6 };
const CALM = { working: 4, failed: 0, resting: 3, projects: 3, agents: 6 };

describe('CombHeadline', () => {
  it('says how many things need you, in amber', () => {
    render(<CombHeadline needs={5} summary={BUSY} />);
    expect(screen.getByRole('heading', { level: 2, name: '5 things need you' })).toHaveClass('text-amber');
    expect(screen.getByText('4 working · 1 failed · 3 resting · 3 projects · 6 agents')).toBeInTheDocument();
    expect(screen.getByText('The Comb')).toBeInTheDocument();
  });

  it('turns green when nothing needs you, and leaves out failed at zero', () => {
    render(<CombHeadline needs={0} summary={CALM} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing needs you' })).toHaveClass('text-green');
    expect(summaryText(CALM)).toBe('4 working · 3 resting · 3 projects · 6 agents');
  });

  it('is singular for one', () => {
    expect(headlineText(1)).toBe('1 thing needs you');
  });
});
