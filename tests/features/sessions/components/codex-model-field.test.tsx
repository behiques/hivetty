import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CodexModelField } from '@features/sessions/components/codex-model-field';
import type { CliModel } from '@shared/cli-contract';

const model = (slug: string, description = ''): CliModel => ({ slug, description, defaultEffort: 'medium', efforts: ['medium'] });

const ACCOUNT = [
  model('gpt-6.1-sol', 'Latest workhorse model.'),
  model('gpt-6-astra'),
  model('gpt-6-sol'),
  model('gpt-6-luna'),
  model('gpt-5.6-sol'),
];

describe('CodexModelField', () => {
  it("steps through the account's classes cheapest first, marked, on the picked model's class", () => {
    render(<CodexModelField models={ACCOUNT} value="gpt-6.1-sol" onChange={() => {}} />);
    const classes = within(screen.getByRole('radiogroup', { name: 'model' })).getAllByRole('radio');
    // No terra on this account, so no terra stop.
    expect(classes.map((radio) => radio.textContent)).toEqual(['lunafast', 'solworkhorse', 'astrafrontier']);
    expect(screen.getByRole('radio', { name: 'sol workhorse' })).toBeChecked();
  });

  it("offers the class's versions newest first, the newest marked latest", () => {
    render(<CodexModelField models={ACCOUNT} value="gpt-6-sol" onChange={() => {}} />);
    const versions = within(screen.getByRole('radiogroup', { name: 'version' })).getAllByRole('radio');
    expect(versions.map((radio) => radio.textContent)).toEqual(['6.1 · latest', '6', '5.6']);
    expect(screen.getByRole('radio', { name: '6' })).toBeChecked();
  });

  it("picks a class's newest version, and a version as itself", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CodexModelField models={ACCOUNT} value="gpt-6.1-sol" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'astra frontier' }));
    expect(onChange).toHaveBeenLastCalledWith('gpt-6-astra');
    await user.click(screen.getByRole('radio', { name: '5.6' }));
    expect(onChange).toHaveBeenLastCalledWith('gpt-5.6-sol');
  });

  it("says what the picked model is, in Codex's words", () => {
    render(<CodexModelField models={ACCOUNT} value="gpt-6.1-sol" onChange={() => {}} />);
    expect(screen.getByText('Latest workhorse model.', { exact: false })).toBeInTheDocument();
  });

  it('shows the first model when the stored pick is not on this account', () => {
    render(<CodexModelField models={ACCOUNT} value="gpt-9-nova" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: '6.1 · latest' })).toBeChecked();
  });

  it('falls back to a select of slugs when a model is not gpt-<version>-<class>', () => {
    render(<CodexModelField models={[...ACCOUNT, model('gpt-reserve')]} value="gpt-6-luna" onChange={() => {}} />);
    expect(screen.queryByRole('radiogroup', { name: 'model' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('gpt-6-luna');
  });
});
