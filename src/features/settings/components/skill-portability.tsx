import type { PortabilityIssue } from '@shared/skill-render';

interface SkillPortabilityProps {
  issues: readonly PortabilityIssue[];
  /** Rewrite the buffer's fixable literals; the result is unsaved until the user saves. */
  onFixAll: () => void;
}

/**
 * What in the open file works in one CLI only (HIVE-369). A warning, never a gate: a skill may be
 * meant for one CLI, and Save stays the user's.
 */
export function SkillPortability({ issues, onFixAll }: SkillPortabilityProps) {
  if (issues.length === 0) return null;
  const fixable = issues.some((issue) => issue.fix !== null);

  return (
    <section
      aria-label="Works in one CLI only"
      className="flex flex-col gap-1 rounded-md border border-amber-edge bg-amber-soft px-2.5 py-1.5 text-ui-sm text-amber-text"
    >
      <div className="flex items-center justify-between gap-2">
        <span>Written for one CLI. Neutral names make it work in every CLI HiveTTY runs.</span>
        {fixable ? (
          <button
            type="button"
            onClick={onFixAll}
            className="shrink-0 rounded-full border border-amber-edge px-2.5 py-0.5 text-micro hover:bg-hover"
          >
            Fix all
          </button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-0.5">
        {issues.map((issue, index) => (
          <li key={`${String(index)}:${issue.found}`}>{`Line ${String(issue.line)}: ${issue.message}`}</li>
        ))}
      </ul>
    </section>
  );
}
