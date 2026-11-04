import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfigErrors } from '@features/settings/components/config-errors';

describe('ConfigErrors (HIVE-388)', () => {
  it("renders each of main's refusals verbatim", () => {
    render(<ConfigErrors errors={['config.json: EACCES; the previous config is unchanged', 'second']} />);
    expect(screen.getByText('config.json: EACCES; the previous config is unchanged')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('renders nothing without errors', () => {
    const { container } = render(<ConfigErrors errors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
