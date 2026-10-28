import { SegmentedControl } from '@components/ui/segmented-control';
import { SelectField } from '@components/ui/select-field';
import { OptionStepper } from '@features/sessions/components/option-stepper';
import { CODEX_CLASSES, codexFamily, type CliModel, type CodexClass } from '@shared/cli-contract';

/** What each class is for, under its stop. HiveTTY's words; Codex's description sits under the field. */
const CLASS_MARKS: Record<CodexClass, string> = {
  luna: 'fast',
  terra: 'balanced',
  sol: 'workhorse',
  astra: 'frontier',
};

/** Newest first: `6.1` before `6` before `5.6`, by number rather than by string. */
const newestFirst = (a: string, b: string): number => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const step = (y[i] ?? 0) - (x[i] ?? 0);
    if (step !== 0) return step;
  }
  return 0;
};

interface CodexModelFieldProps {
  models: readonly CliModel[];
  value: string;
  onChange: (slug: string) => void;
}

/**
 * Codex's model as a class and a version: the classes the account has on the picker's stepper,
 * cheapest first, and the picked class's versions as pills, newest first. A list Codex names any
 * other way is the platform's select of slugs, so nothing on the account is ever hidden.
 */
export function CodexModelField({ models, value, onChange }: CodexModelFieldProps) {
  const picked = models.find((model) => model.slug === value) ?? models[0]!;
  const parsed = models.flatMap((model) => {
    const family = codexFamily(model.slug);
    return family === null ? [] : [{ model, ...family }];
  });

  if (parsed.length !== models.length) {
    return (
      <SelectField
        className="min-w-0 flex-1"
        label="Model"
        value={picked.slug}
        options={models.map((model) => ({ value: model.slug, label: model.slug }))}
        onChange={onChange}
      />
    );
  }

  const versionsOf = (cls: CodexClass) =>
    parsed.filter((entry) => entry.cls === cls).sort((a, b) => newestFirst(a.version, b.version));
  const cls = parsed.find((entry) => entry.model === picked)!.cls;
  const classes = CODEX_CLASSES.filter((each) => versionsOf(each).length > 0);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <OptionStepper
        label="model"
        options={classes}
        value={cls}
        onChange={(next) => onChange(versionsOf(next)[0]!.model.slug)}
        marks={CLASS_MARKS}
      />
      <SegmentedControl
        label="version"
        options={versionsOf(cls).map((entry, index) => ({
          value: entry.model.slug,
          label: index === 0 ? `${entry.version} · latest` : entry.version,
        }))}
        value={picked.slug}
        onChange={onChange}
      />
      {picked.description === '' ? null : (
        <p className="text-micro text-subtle">
          <span className="font-mono text-ink">{picked.slug}</span> · {picked.description}
        </p>
      )}
    </div>
  );
}
