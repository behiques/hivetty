import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmSwitch } from '@features/settings/components/confirm-switch';

const CONFIRM = { label: 'Allow it?', title: 'Let it happen?', confirmLabel: 'Allow', body: 'What goes, and what does not.' };

/** The switch as a settings page holds it: the write comes back as the next `checked`. */
function Held({ onChange, start = false }: { onChange: (checked: boolean) => void; start?: boolean }) {
  const [checked, setChecked] = useState(start);
  return (
    <ConfirmSwitch
      label="The grant"
      description="Why you might want it."
      checked={checked}
      confirm={CONFIRM}
      onChange={(next) => {
        onChange(next);
        setChecked(next);
      }}
    />
  );
}

describe('ConfirmSwitch', () => {
  it('asks before it goes on, and writes only on the confirm', async () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);

    await userEvent.click(screen.getByRole('switch', { name: 'The grant' }));

    expect(screen.getByRole('alertdialog', { name: 'Allow it?' })).toHaveTextContent('What goes, and what does not.');
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.getByRole('switch', { name: 'The grant' })).toBeChecked();
  });

  it('cancelling writes nothing and hands focus back to the switch', async () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);

    await userEvent.click(screen.getByRole('switch', { name: 'The grant' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'The grant' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'The grant' })).toHaveFocus();
  });

  it('goes off at once: off is the safe way', async () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} start />);

    await userEvent.click(screen.getByRole('switch', { name: 'The grant' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('drops an open confirm when it is disabled, and writes nothing', async () => {
    const onChange = vi.fn();
    const props = { label: 'The grant', description: 'Why.', checked: false, confirm: CONFIRM, onChange };
    const { rerender } = render(<ConfirmSwitch {...props} />);

    await userEvent.click(screen.getByRole('switch', { name: 'The grant' }));
    expect(screen.getByRole('alertdialog', { name: 'Allow it?' })).toBeInTheDocument();

    rerender(<ConfirmSwitch {...props} disabled />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'The grant' })).not.toBeChecked();

    rerender(<ConfirmSwitch {...props} />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
