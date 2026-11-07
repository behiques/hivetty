import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HostLapsed } from '@features/account/components/host-lapsed';

const setRemoteConfig = vi.hoisted(() => vi.fn());
const applyModeChange = vi.hoisted(() => vi.fn());
vi.mock('@lib/project-config', () => ({ setRemoteConfig }));
vi.mock('@stores/hive-store', () => ({ useApplyModeChange: () => applyModeChange }));

describe('HostLapsed (HIVE-265)', () => {
  it('names the server, says its sessions are paused, and Disconnect detaches', async () => {
    setRemoteConfig.mockResolvedValue({ switched: { ok: true }, changed: { snapshot: 1 } });
    render(<HostLapsed serverName="studio-mac" />);
    expect(screen.getByRole('heading', { name: "studio-mac's licence has lapsed" })).toBeInTheDocument();
    expect(screen.getByText('Its sessions are paused.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(setRemoteConfig).toHaveBeenCalledWith({ mode: 'local' });
    expect(applyModeChange).toHaveBeenCalledWith({ snapshot: 1 });
  });

  it('a detach that changed nothing applies nothing', async () => {
    setRemoteConfig.mockResolvedValue({ switched: { ok: true }, changed: null });
    applyModeChange.mockClear();
    render(<HostLapsed serverName="studio-mac" />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(setRemoteConfig).toHaveBeenCalled();
    expect(applyModeChange).not.toHaveBeenCalled();
  });
});
