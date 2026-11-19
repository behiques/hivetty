import { useId, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tag } from '@/components/ui/tag';
import { badgeOf, diffContents, installVersionOf, type ContentsDiff } from '@/features/settings/lib/swarm-view';

import type { InstalledSwarm, SwarmEntry } from '@shared/swarm-contract';

interface SwarmConsentProps {
  entry: SwarmEntry;
  /** `null` is install mode; an installed entry is update mode. */
  installed: InstalledSwarm | null;
  /** The version an update moves to. */
  target: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

function Tools({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tools.map((tool) => (
        <Tag key={tool} tone="subtle">
          {tool}
        </Tag>
      ))}
    </span>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="text-ui-sm font-semibold tracking-[0.06em] text-subtle uppercase">{children}</h3>;
}

function ChangeLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm">
      <span className="text-subtle">{label}</span>
      {children}
    </li>
  );
}

const isEmpty = (diff: ContentsDiff): boolean =>
  diff.agentsAdded.length +
    diff.agentsRemoved.length +
    diff.skillsAdded.length +
    diff.skillsRemoved.length +
    diff.toolsChanged.length ===
  0;

/** Update mode's first section: what the new version adds, removes and changes. */
function WhatChanges({ installed, entry }: { installed: InstalledSwarm; entry: SwarmEntry }) {
  const id = useId();
  const diff = diffContents(installed.contents, entry);
  const toolsOf = (name: string): string[] => entry.agents.find((agent) => agent.name === name)?.tools ?? [];

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-lg border border-amber-edge bg-amber-soft px-3 py-2.5">
      <h3 id={id} className="text-ui-sm font-semibold tracking-[0.06em] text-amber-text uppercase">
        What changes
      </h3>
      {isEmpty(diff) ? (
        <p className="text-ui-sm text-muted">No agents, skills or tools change.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {diff.agentsAdded.map((name) => (
            <ChangeLine key={`agent+${name}`} label="New agent">
              <span className="font-medium text-ink">{name}</span>
              <Tools tools={toolsOf(name)} />
            </ChangeLine>
          ))}
          {diff.toolsChanged.map((change) => (
            <ChangeLine key={`tools ${change.name}`} label="Tools changed">
              <span className="font-medium text-ink">{change.name}</span>
              {change.added.map((tool) => (
                <span key={`+${tool}`} className="text-green">{`+${tool}`}</span>
              ))}
              {change.removed.map((tool) => (
                <del key={`-${tool}`} className="text-red">
                  {tool}
                </del>
              ))}
            </ChangeLine>
          ))}
          {diff.agentsRemoved.map((name) => (
            <ChangeLine key={`agent-${name}`} label="Removed agent">
              <span className="font-medium text-ink">{name}</span>
            </ChangeLine>
          ))}
          {diff.skillsAdded.map((name) => (
            <ChangeLine key={`skill+${name}`} label="New skill">
              <span className="font-medium text-ink">{`/${name}`}</span>
            </ChangeLine>
          ))}
          {diff.skillsRemoved.map((name) => (
            <ChangeLine key={`skill-${name}`} label="Removed skill">
              <span className="font-medium text-ink">{`/${name}`}</span>
            </ChangeLine>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The consent dialog before `swarms:install` (HIVE-442): every agent with its tools and every skill, so
 * nothing installs unseen. Update mode puts what changes first. Model and autonomy are not shown: the
 * registry row does not carry them.
 */
export function SwarmConsent({ entry, installed, target, onConfirm, onCancel }: SwarmConsentProps) {
  const update = installed !== null;
  const badge = badgeOf({ entry, installed, update: null });
  const lands = installVersionOf(entry);
  const next = target ?? lands;
  let version: string | null = lands === null ? null : `v${lands}`;
  if (update) version = next === null ? `v${installed.version}` : `v${installed.version} → v${next}`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        // Claims Escape from the settings overlay behind it; see `settings-overlay.tsx`.
        data-escape-scope=""
        className="flex max-h-[calc(100vh-4rem)] flex-col gap-0 p-0 sm:max-w-[560px]"
      >
        <DialogHeader className="shrink-0 gap-1 border-b border-border-soft px-4 pt-3.5 pb-3 pr-10">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="truncate text-ui-lg font-semibold text-ink">
              {update ? `Update ${entry.title}` : `Install ${entry.title}`}
            </DialogTitle>
            <Tag tone={badge === 'Community' ? 'subtle' : 'brand'} className="shrink-0">
              {badge}
            </Tag>
          </div>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-x-2 text-ui-sm text-subtle">
              {entry.publisher === '' ? null : <span>{entry.publisher}</span>}
              {version === null ? null : <span className="tabular-nums">{version}</span>}
              <span className="min-w-0 break-all">{entry.repoUrl}</span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
          {update ? <WhatChanges installed={installed} entry={entry} /> : null}

          <section className="flex flex-col gap-2">
            <Heading>{plural(entry.agents.length, 'agent')}</Heading>
            <ul className="flex flex-col gap-2.5">
              {entry.agents.map((agent) => (
                <li key={agent.name} className="flex flex-col gap-1">
                  <span className="text-ui font-medium text-ink">{agent.name}</span>
                  {agent.description === '' ? null : <span className="text-ui-sm text-muted">{agent.description}</span>}
                  <Tools tools={agent.tools} />
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <Heading>{plural(entry.skills.length, 'skill')}</Heading>
            <ul className="flex flex-col gap-2">
              {entry.skills.map((skill) => (
                <li key={skill.name} className="flex flex-col gap-0.5">
                  <span className="text-ui font-medium text-ink">{`/${skill.name}`}</span>
                  {skill.description === '' ? null : <span className="text-ui-sm text-muted">{skill.description}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border-soft px-4 py-3">
          <p className="min-w-0 flex-1 text-ui-sm text-subtle">
            Agents in this swarm run on your machine with the tools listed here.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button onClick={onCancel}>Cancel</Button>
            <Button variant="primary" onClick={onConfirm}>
              {update ? 'Update' : 'Install'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
