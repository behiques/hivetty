/**
 * Rules more than one skill or agent definition states, written once (HIVE-413). Pure and
 * import-free: the plugin renderer, the agent prompt builder and the Settings preview all read it.
 * No placeholders inside, so a skill and an agent prompt receive the same words.
 */
export const FRAGMENTS: Readonly<Record<string, string>> = {
  'ship-intake': `\`\`\`
ledger_ask
  to: shipper
  body: |
    Ship PR #214 on behiques/hivetty
    repo: /abs/path/to/checkout
    worktree: /abs/path/or/none        (an agent worktree merge-pr may remove)
    ticket: HIVE-123 | none
    key-confirmed: yes | no            (yes only when the key came from work-on's arguments)
    closes-ticket: yes | no            (no on every PR of a split but the last)
    reply-to: <$HIVE_SESSION_ID, sess-…> | overmind
  meta: { pr: 214, repo: "behiques/hivetty", ticket: "HIVE-123", stage: "intake",
          key: "ship:behiques/hivetty#214" }
\`\`\`

An intake without the \`closes-ticket\` line reads \`yes\`. A write to \`reply-to\`
refused \`unknown party\` goes to the ask's \`from\`, which becomes \`replyTo\`.`,
  'agent-worktree': `Your worktree goes under your own working directory, detached, so the person's checkout keeps its branch:

\`\`\`bash
git -C <repo> worktree add --detach <your working directory>/<repo-name>-pr<N> origin/<branch>
\`\`\`

Push as \`git -C <that path> push origin HEAD:<branch>\`. Git allows one worktree per branch; a detached tree at the tip works beside theirs.`,
  'literal-target': `Carry the target as literals. The repo slug, the PR number, the workspace path and the ticket
key are written out in every command and substituted textually, never re-derived from \`pwd\` or
a shell variable. Shell state does not survive a call; \`--repo ""\` resolves from cwd without
erroring.`,
};

export const INCLUDE = /\{\{include:([a-z0-9-]+)\}\}/g;

/** `{{include:x}}` replaced by fragment `x`; an unknown name stays as written. One level: fragments hold none. */
export function fillIncludes(text: string): string {
  return text.replace(INCLUDE, (match, name: string) => FRAGMENTS[name] ?? match);
}
