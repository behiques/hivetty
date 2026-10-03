import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Session } from '@/types/entity';
import { HomePage } from '@features/home/components/home-page';
import { useHiveStore } from '@stores/hive-store';

const sess = (id: string, status: Session['status']): Session => ({
  kind: 'session', id, project: 'p1', branch: `b/${id}`, status, task: id, cost: '$0', lines: [],
});

describe('HomePage', () => {
  beforeEach(() => {
    useHiveStore.getState().reset();
    useHiveStore.setState({ entities: { a: sess('a', 'working'), b: sess('b', 'waiting') }, order: ['a', 'b'], agentOrder: [] });
  });

  it('is the Home region, headed, with the comb labelled by the headline', () => {
    render(<HomePage />);
    expect(screen.getByRole('region', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toHaveClass('sr-only');
    expect(screen.getByRole('heading', { level: 2, name: '1 thing needs you' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '1 thing needs you. 1 working · 0 resting · 1 projects · 0 agents' })).toBeInTheDocument();
  });
});
