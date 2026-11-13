import type { PlanPart, SessionPlan } from '@shared/plan-contract';

/** Which PR of a split a plan is: `PR 2 of 3` (HIVE-359). */
export const partLabel = ({ index, of }: PlanPart): string => `PR ${String(index)} of ${String(of)}`;

/** The earlier plans of a split this session has not read, or `null` when it has read them all. */
export function missingLabel({ missing }: PlanPart): string | null {
  if (missing === undefined || missing.length === 0) return null;
  const last = missing.at(-1);
  return missing.length === 1
    ? `The plan for PR ${String(last)} isn't in this session yet.`
    : `The plans for PR ${missing.slice(0, -1).join(', ')} and ${String(last)} aren't in this session yet.`;
}

/** The Plan tab's one fact: its tooltip, and the strip's rings button name. */
export function planFact(plan: SessionPlan): string {
  const part = plan.part === undefined ? '' : `${partLabel(plan.part)}, `;
  if (plan.allDone) return `Plan, ${part}all done`;
  const done = plan.tasks.filter((task) => task.status === 'completed').length;
  return `Plan, ${part}${String(done)} of ${String(plan.tasks.length)} done`;
}
