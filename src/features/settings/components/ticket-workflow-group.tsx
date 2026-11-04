import { useState } from 'react';

import { SegmentedControl } from '@components/ui/segmented-control';
import { SelectField, type SelectFieldOption } from '@components/ui/select-field';
import { TextField } from '@components/ui/text-field';
import { SettingsGroup } from '@features/shared/components/settings-group';
import { useAgents } from '@hooks/use-agents';
import { useCliSkills, useSkills } from '@hooks/use-skills';
import { CLI_NAMES } from '@lib/harness/cli-names';
import { setJiraConnection } from '@lib/project-config';
import { ticketStart, ticketWorkflowOf, type TicketWorkflow } from '@shared/ticket-workflow';

type Mode = 'none' | 'skill' | 'agent';
type Via = 'session' | 'wake';

/** The select's escape hatch: a skill the list does not have, from another plugin. */
const TYPED = '__typed';
const FIRST_SKILL = 'hive:work-on';
/** The select's first group: HiveTTY's own skills, which every CLI's sessions load. */
const HIVE_GROUP = 'HiveTTY · every CLI';
/** What the preview runs against. Never sent anywhere. */
const EXAMPLE = { key: 'PROJ-123', title: 'Example ticket', type: 'Story', url: 'https://example.atlassian.net/browse/PROJ-123' };

const MODES = [
  { value: 'none', label: 'Just open' },
  { value: 'skill', label: 'Run a skill' },
  { value: 'agent', label: 'Hand to an agent' },
] as const;

const VIAS = [
  { value: 'session', label: 'The session asks it' },
  { value: 'wake', label: 'Instead of a session' },
] as const;

/**
 * Settings › Automation › Ticket workflow (HIVE-379): what a session started from a ticket in
 * Work does first. A skill becomes the session's first message, `/skill KEY
 * prompt`; an agent is handed the ticket as a ledger ask, by the new session
 * or instead of one. The picker shows the result and lets one start change it.
 *
 * Every choice saves as it is made; the two text fields on blur or Enter. A
 * typed skill that is not a skill name is shown as wrong and not saved.
 *
 * The skill select lists HiveTTY's own skills first, then the user's own CLI
 * skills grouped by CLI (HIVE-367). A CLI skill runs only in that CLI's
 * sessions, so picking one says which, and the preview types it that CLI's way.
 */
export function TicketWorkflowGroup({ workflow }: { workflow: TicketWorkflow | null }) {
  const skills = useSkills();
  const cliList = useCliSkills();
  const cliSkills = cliList ?? [];
  const agents = useAgents();
  const skillNames = (skills?.skills ?? []).map((skill) => `hive:${skill.name}`);
  const agentNames = (agents?.agents ?? []).map((agent) => agent.name);
  /** The CLIs whose own skills include `skill`, in `HARNESS_IDS` order. */
  const cliOf = (skill: string) => cliSkills.filter((entry) => entry.names.includes(skill)).map((entry) => entry.cli);

  const [mode, setMode] = useState<Mode>(workflow?.kind ?? 'none');
  const savedSkill = workflow?.kind === 'skill' ? workflow.skill : FIRST_SKILL;
  // By namespace, not by the list: the skills snapshot may not have arrived on the first render.
  const [skillChoice, setSkillChoice] = useState(
    savedSkill.startsWith('hive:') || cliOf(savedSkill).length > 0 ? savedSkill : TYPED,
  );
  const [typed, setTyped] = useState(skillChoice === TYPED ? savedSkill : '');
  // The CLI list arrives after the first render (reading it spawns CLIs): when
  // it does, a typed skill one of them lists moves into the select. Only on
  // the list's arrival, so typing a listed name never yanks the field away, and
  // only ever a promotion. React's "state from the previous render" pattern.
  const [seenCliList, setSeenCliList] = useState(cliList);
  if (cliList !== seenCliList) {
    setSeenCliList(cliList);
    if (skillChoice === TYPED && cliOf(typed).length > 0) setSkillChoice(typed);
  }
  const [pickedAgent, setAgent] = useState(workflow?.kind === 'agent' ? workflow.agent : '');
  // Until one is picked, the first listed: the agents snapshot may arrive after the first render.
  const agent = pickedAgent || (agentNames[0] ?? '');
  const [via, setVia] = useState<Via>(workflow?.kind === 'agent' ? workflow.via : 'session');
  const [prompt, setPrompt] = useState(workflow?.prompt ?? '');

  const build = (next: { mode?: Mode; skillChoice?: string; typed?: string; agent?: string; via?: Via; prompt?: string }) => {
    const m = next.mode ?? mode;
    if (m === 'none') return null;
    const extra = next.prompt ?? prompt;
    const raw =
      m === 'skill'
        ? { kind: 'skill', skill: (next.skillChoice ?? skillChoice) === TYPED ? (next.typed ?? typed) : (next.skillChoice ?? skillChoice), prompt: extra }
        : { kind: 'agent', agent: next.agent ?? agent, via: next.via ?? via, prompt: extra };
    return ticketWorkflowOf(raw);
  };

  const current = build({});
  const problem = typeof current === 'string' ? current : null;

  const save = (next: Parameters<typeof build>[0]) => {
    const built = build(next);
    if (typeof built === 'string') return;
    void setJiraConnection({ workflow: built });
  };

  // A CLI's own skill runs only in its sessions; the preview types it that CLI's way (HIVE-367),
  // and otherwise shows the default CLI's form of the skill (HIVE-369).
  const only = typeof current === 'string' || current?.kind !== 'skill' ? [] : cliOf(current.skill);
  const start = typeof current === 'string' ? null : ticketStart(current, EXAMPLE, only[0] ?? 'claude-code');
  const onlyNames = only.map((id) => CLI_NAMES[id]).join(' and ');
  const listedByCli = skillChoice !== TYPED && cliOf(skillChoice).length > 0;
  const skillOptions: SelectFieldOption[] = [
    // A saved hive skill stays listed even when its folder has gone, so the select never shows a value it lacks.
    ...[...new Set([FIRST_SKILL, ...skillNames, ...(skillChoice.startsWith('hive:') ? [skillChoice] : [])])].map((name) => ({
      value: name,
      label: name,
      group: HIVE_GROUP,
    })),
    ...cliSkills.flatMap((entry) =>
      entry.names.map((name) => ({ value: name, label: name, group: CLI_NAMES[entry.cli], key: `${entry.cli}:${name}` })),
    ),
    // So does a CLI skill the last read no longer lists.
    ...(skillChoice === TYPED || skillChoice.startsWith('hive:') || listedByCli ? [] : [{ value: skillChoice, label: skillChoice }]),
  ];

  return (
    <SettingsGroup title="Ticket workflow" description="What a session started from a ticket in Work does first.">
      <div className="flex flex-col gap-3 rounded-lg border border-border-soft p-3">
        <SegmentedControl
          label="When a session starts from a ticket"
          options={MODES}
          value={mode}
          disabledValues={agentNames.length === 0 ? ['agent'] : undefined}
          wrap
          onChange={(next) => {
            setMode(next);
            save({ mode: next });
          }}
        />

        {mode === 'skill' ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
            <SelectField
              label="Skill"
              value={skillChoice}
              options={[...skillOptions, { value: TYPED, label: 'Type one…' }]}
              onChange={(next) => {
                setSkillChoice(next);
                if (next !== TYPED) save({ skillChoice: next });
              }}
            />
            {skillChoice === TYPED ? (
              <TextField
                label="Skill name"
                value={typed}
                onChange={setTyped}
                onCommit={() => save({})}
                placeholder="workstream:work-on"
              />
            ) : null}
          </div>
        ) : null}

        {mode === 'skill' && only.length > 0 ? (
          <p className="rounded-md border border-amber px-2.5 py-1.5 text-ui-sm text-amber-text">
            {`A ${onlyNames} skill: it runs only in ${onlyNames} sessions. A session on another CLI started from a ticket will not find it.`}
          </p>
        ) : null}

        {mode === 'agent' ? (
          <div className="flex flex-col gap-2.5">
            <SelectField
              label="Agent"
              value={agent}
              options={agentNames.map((name) => ({ value: name, label: name }))}
              onChange={(next) => {
                setAgent(next);
                save({ agent: next });
              }}
            />
            <SegmentedControl
              label="How the agent gets the ticket"
              options={VIAS}
              value={via}
              wrap
              onChange={(next) => {
                setVia(next);
                save({ via: next });
              }}
            />
          </div>
        ) : null}

        {mode === 'none' ? null : (
          <TextField
            label="Extra prompt (optional)"
            value={prompt}
            onChange={setPrompt}
            onCommit={() => save({})}
            placeholder="Added after the ticket key, every time"
            hint="Can use {key}, {title}, {type} and {url}. The picker lets you change it for one session."
          />
        )}

        {problem === null ? null : (
          <p role="alert" className="text-control text-red">
            {`Not saved: ${problem}.`}
          </p>
        )}

        {start === null ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-micro font-semibold tracking-[0.06em] text-subtle uppercase">{`For ${EXAMPLE.key}`}</span>
            <code
              data-testid="ticket-workflow-preview"
              className="rounded-md border border-border-soft bg-term-bg px-2.5 py-2 font-mono text-control break-words text-ink"
            >
              {start.kind === 'wake'
                ? `Wakes ${start.agent}: ${start.body}`
                : start.text === ''
                  ? 'Nothing: the session opens at an empty prompt.'
                  : start.text}
            </code>
            <span className="text-ui-sm text-subtle">
              {start.kind === 'wake'
                ? 'No terminal opens. Starting from a ticket asks the agent, and you land on its page.'
                : start.text === ''
                  ? 'The way it has always been.'
                  : 'Typed into the new session as its first message.'}
            </span>
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}
