import { SettingsGroup } from '@features/shared/components/settings-group';
import { CAPABILITIES, type Capabilities, type HarnessId } from '@shared/harness-contract';

interface Row {
  label: string;
  key: keyof Capabilities;
  read: (caps: Capabilities) => { ok: boolean; text: string };
}

const yes = (ok: boolean) => ({ ok, text: ok ? 'Yes' : 'Not supported' });
const list = (items: readonly string[]) => ({
  ok: items.length > 0,
  text: items.length > 0 ? items.join(', ') : 'None',
});

/** What each row reads from `CAPABILITIES` (HIVE-376 D1). Rendered here only: the session menu dropped its list in HIVE-366. */
const ROWS: readonly Row[] = [
  { label: 'Resume a session', key: 'resume', read: (c) => yes(c.resume === 'by-id') },
  { label: 'Meters', key: 'meters', read: (c) => list(c.meters) },
  {
    label: 'Ledger entries reach the session',
    key: 'contextDelivery',
    read: (c) => yes(c.contextDelivery === 'prompt-marker'),
  },
  { label: 'Agent cost in USD', key: 'reportsCostUsd', read: (c) => yes(c.reportsCostUsd) },
  { label: 'Agent turn limit', key: 'enforcesTurns', read: (c) => yes(c.enforcesTurns) },
  { label: 'Agent budget limit', key: 'enforcesBudget', read: (c) => yes(c.enforcesBudget) },
  { label: 'MCP status in agent runs', key: 'reportsMcpStatus', read: (c) => yes(c.reportsMcpStatus) },
  { label: 'Integrations in agent runs', key: 'agentMcp', read: (c) => list(c.agentMcp) },
];

/** Open work on a gap, by ticket key. Plain text, never a link: customers cannot open the HIVE Jira (D2). */
export const CAPABILITY_GAPS: Partial<Record<HarnessId, Partial<Record<keyof Capabilities, string>>>> = {
  copilot: { meters: 'HIVE-335' },
};

/** How many of the rows a CLI supports, for the Overview's one-line summary. */
export function capabilitySummary(cli: HarnessId) {
  return { supported: ROWS.filter((row) => row.read(CAPABILITIES[cli]).ok).length, total: ROWS.length };
}

export function HarnessCapabilities({ cli }: { cli: HarnessId }) {
  return (
    <SettingsGroup title="What it supports" description="What HiveTTY can do with this CLI today.">
      <table className="w-full text-ui">
        <tbody className="divide-y divide-border-soft">
          {ROWS.map((row) => {
            const { ok, text } = row.read(CAPABILITIES[cli]);
            const ticket = CAPABILITY_GAPS[cli]?.[row.key];
            return (
              <tr key={row.key}>
                <th scope="row" className="py-2 pr-4 text-left font-normal text-ink">
                  {row.label}
                </th>
                <td className={ok ? 'py-2 text-muted' : 'py-2 text-subtle'}>
                  {ok || ticket === undefined ? text : `Planned · ${ticket}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </SettingsGroup>
  );
}
