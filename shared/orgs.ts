/**
 * The account's orgs (HIVE-291), as `GET /api/orgs` lists them (hivetty-cloud's `OrgRow`), and the pure rules both
 * processes apply to them. Imports nothing, so the renderer may import it by value.
 */
export interface OrgSummary {
  id: string;
  name: string;
  /** `Owner`, `Admin`, `Billing` or `Member`. */
  role: string;
  seat: boolean;
  plan: string | null;
  status: string | null;
  /** The org the cloud made for this user at sign-up. */
  personal: boolean;
}

/** D2, the console's rule: any org that is not personal, or a personal one on Team or Enterprise. */
export const isTeam = (org: Pick<OrgSummary, 'personal' | 'plan'>): boolean =>
  !org.personal || org.plan === 'team' || org.plan === 'enterprise';

/** The avatar's corner: the first letters of the first two words, else the first two letters, upper-cased. */
export function orgBadge(name: string): string {
  const [first = '', second] = name.trim().split(/\s+/);
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}

const MANAGERS: readonly string[] = ['Owner', 'Admin', 'Billing'];

/** D1: who sees the manage link. `/admin` sends Billing on to `/admin/billing` itself. */
export const canManage = (role: string): boolean => MANAGERS.includes(role);
