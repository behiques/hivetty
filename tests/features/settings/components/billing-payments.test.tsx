import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingPayments } from '@features/settings/components/billing-payments';

const lib = vi.hoisted(() => ({ readPayments: vi.fn(), openInvoice: vi.fn() }));
vi.mock('@lib/account', () => lib);

const CARD = { brand: 'visa', last4: '4242', expMonth: 3, expYear: 2027 };
const PAID = {
  id: 'in_1',
  number: 'A-0001',
  created: '2026-11-01T12:00:00.000Z',
  total: 1200,
  currency: 'usd',
  status: 'paid',
  pdfUrl: 'https://pay.stripe.com/invoice/1/pdf',
  hostedUrl: 'https://invoice.stripe.com/i/1',
};
const OPEN = { ...PAID, id: 'in_2', number: 'A-0002', status: 'open', total: 150000, currency: 'jpy', pdfUrl: null };

describe('BillingPayments (the card and invoices, desktop billing)', () => {
  beforeEach(() => {
    lib.readPayments.mockReset().mockResolvedValue({ card: CARD, invoices: [PAID, OPEN] });
    lib.openInvoice.mockReset().mockResolvedValue({ ok: true });
  });

  it('asks for the org and shows the card, brand capitalised and the expiry as MM/YY', async () => {
    render(<BillingPayments orgId="org-acme" />);
    const group = (await screen.findByRole('heading', { name: 'Payment' })).closest('section')!;
    expect(lib.readPayments).toHaveBeenCalledWith('org-acme');
    expect(within(group).getByText('Card').nextSibling).toHaveTextContent('Visa •••• 4242 · expires 03/27');
  });

  it('lists each invoice: date, number, amount in its currency, status', async () => {
    render(<BillingPayments orgId={undefined} />);
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('A-0001');
    expect(rows[0]).toHaveTextContent('$12.00');
    expect(rows[0]).toHaveTextContent('Paid');
    expect(rows[0]).toHaveTextContent(/2026/);
    // A zero-decimal currency is not divided by 100.
    expect(rows[1]).toHaveTextContent(/150,000/);
    expect(rows[1]).toHaveTextContent('Due');
  });

  it('PDF and View open the invoice through main; a missing link has no button', async () => {
    render(<BillingPayments orgId={undefined} />);
    await userEvent.click(await screen.findByRole('button', { name: 'PDF of A-0001' }));
    expect(lib.openInvoice).toHaveBeenCalledWith('https://pay.stripe.com/invoice/1/pdf');
    await userEvent.click(screen.getByRole('button', { name: 'View A-0002' }));
    expect(lib.openInvoice).toHaveBeenLastCalledWith('https://invoice.stripe.com/i/1');
    expect(screen.queryByRole('button', { name: 'PDF of A-0002' })).toBeNull();
  });

  it('a link that does not open says why in one line', async () => {
    lib.openInvoice.mockResolvedValue({ error: "The browser didn't open." });
    render(<BillingPayments orgId={undefined} />);
    await userEvent.click(await screen.findByRole('button', { name: 'View A-0001' }));
    expect(await screen.findByText("The browser didn't open.")).toBeInTheDocument();
  });

  it('no card on file, and an unknown currency, still read', async () => {
    lib.readPayments.mockResolvedValue({ card: null, invoices: [{ ...PAID, currency: 'zz', number: null }] });
    render(<BillingPayments orgId={undefined} />);
    expect(await screen.findByText('No card on file')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('1200 ZZ');
    expect(screen.getByRole('button', { name: 'View invoice' })).toBeInTheDocument();
  });

  it('nothing from the cloud (an older one, not the billing member), or nothing billed yet: nothing at all', async () => {
    lib.readPayments.mockResolvedValue(null);
    const { container, unmount } = render(<BillingPayments orgId={undefined} />);
    await waitFor(() => expect(lib.readPayments).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    lib.readPayments.mockResolvedValue({ card: null, invoices: [] });
    const second = render(<BillingPayments orgId={undefined} />);
    await waitFor(() => expect(lib.readPayments).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });
});
