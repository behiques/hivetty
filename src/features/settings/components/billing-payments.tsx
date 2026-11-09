import { useEffect, useState } from "react";

import { Button } from "@components/ui/button";
import { SettingsGroup } from "@features/shared/components/settings-group";
import { openInvoice, readPayments } from "@lib/account";
import type {
  BillingCard,
  BillingInvoice,
  BillingPayments as Payments,
} from "@shared/account-contract";

/**
 * Plan & billing's card on file and last 12 invoices, read live from Stripe through the cloud. Nothing from the cloud
 * (an older one, not the org's billing member, offline) or nothing billed yet shows nothing: the subscription and the
 * lease above still stand. PDF and View open Stripe's own pages in the browser, through main.
 */

const STATUS: Record<string, string> = {
  paid: "Paid",
  open: "Due",
  void: "Void",
  uncollectible: "Uncollectible",
};

const cardLine = ({ brand, last4, expMonth, expYear }: BillingCard): string =>
  `${brand.charAt(0).toUpperCase()}${brand.slice(1)} •••• ${last4} · expires ${String(expMonth).padStart(2, "0")}/${String(expYear).slice(-2)}`;

/** `total` is in the currency's minor unit: the currency's own digits say how far to shift it (JPY has none). */
function amount({ total, currency }: BillingInvoice): string {
  try {
    const format = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    });
    return format.format(
      total / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2),
    );
  } catch {
    return `${String(total)} ${currency.toUpperCase()}`;
  }
}

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

export function BillingPayments({ orgId }: { orgId: string | undefined }) {
  const [payments, setPayments] = useState<Payments | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readPayments(orgId).then((next) => {
      if (!cancelled) setPayments(next);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!payments || (!payments.card && payments.invoices.length === 0))
    return null;

  const open = async (url: string): Promise<void> => {
    const result = await openInvoice(url);
    setError(result && "error" in result ? result.error : null);
  };

  return (
    <SettingsGroup
      title="Payment"
      description="The card Stripe charges, and the last 12 invoices."
    >
      <div className="flex items-baseline justify-between gap-4 rounded-lg border border-border-soft p-3">
        <span className="text-control text-subtle">Card</span>
        <span className="truncate tabular-nums text-ui-sm text-ink">
          {payments.card ? cardLine(payments.card) : "No card on file"}
        </span>
      </div>
      {payments.invoices.length > 0 ? (
        <ul
          aria-label="Invoices"
          className="flex flex-col rounded-lg border border-border bg-panel"
        >
          {payments.invoices.map((invoice) => {
            const { pdfUrl, hostedUrl } = invoice;
            const name = invoice.number ?? "invoice";
            return (
              <li
                key={invoice.id}
                className="flex items-center gap-3 border-b border-border-soft px-4 py-2.5 last:border-b-0"
              >
                <span className="w-[110px] text-ui-sm text-subtle">
                  {day(invoice.created)}
                </span>
                <span className="flex-1 truncate font-mono text-ui-sm text-ink">
                  {invoice.number ?? "—"}
                </span>
                <span className="tabular-nums text-ui-sm text-ink">
                  {amount(invoice)}
                </span>
                <span className="w-[90px] text-right text-ui-sm text-muted">
                  {STATUS[invoice.status] ?? invoice.status}
                </span>
                {pdfUrl ? (
                  <Button
                    size="sm"
                    aria-label={`PDF of ${name}`}
                    onClick={() => void open(pdfUrl)}
                  >
                    PDF
                  </Button>
                ) : null}
                {hostedUrl ? (
                  <Button
                    size="sm"
                    aria-label={`View ${name}`}
                    onClick={() => void open(hostedUrl)}
                  >
                    View
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <span className="text-ui-sm text-red">{error}</span> : null}
    </SettingsGroup>
  );
}
