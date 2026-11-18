/**
 * Rules more than one skill or agent definition states, written once (HIVE-413; tdd-loop HIVE-414). Pure and
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
    spec: /abs/path | none             (optional; the spec the work was built to)
    plan: /abs/path | none             (optional; the plan it followed)
    notes: /abs/path | none            (optional; the builder's progress.md)
  meta: { pr: 214, repo: "behiques/hivetty", ticket: "HIVE-123", stage: "intake",
          key: "ship:behiques/hivetty#214" }
\`\`\`

An intake without the \`closes-ticket\` line reads \`yes\`. An intake without
\`spec\`, \`plan\` or \`notes\` reads \`none\` for it. A write to \`reply-to\`
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
  'tdd-loop': `**The law.**

\`\`\`
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
\`\`\`

Wrote the code first? Delete it. Not "keep as reference", not "adapt while
writing the test". Delete, then implement fresh from the test. Exceptions
need the person's word: a throwaway spike, generated code, configuration.

**RED.** One test, one behaviour, a name that says what should happen, real
code rather than a mock wherever the real thing can be constructed. Run it.
Read the failure: it must fail because the behaviour is missing, not because
of a typo in the test.

**GREEN.** The least code that passes. Not the code you expect to need later.
Run it. Read the pass, and confirm nothing else went red.

**REFACTOR.** With everything green, and only then. Run again.

Three tests the happy path never writes:

- An injectable seam gets one test that runs the real default.
- State keyed by an id gets a switch-the-id test and a failed-call test.
- A predicate that refuses commands gets a table test from the evasion list:
  line continuation, quoting, a redirect or operator touching the token,
  every refspec spelling, every API spelling of the same act.

| Thought | Reality |
| --- | --- |
| "I'll add the test after" | Then it tests what you wrote, not what was needed. |
| "It's a one-liner" | One-liners have the highest ratio of confident to correct. |
| "The test would just duplicate the code" | Then the test is wrong, not unnecessary. |
| "I watched it fail in my head" | Run it. |
| "Just this once" | That is the rationalisation. Delete, start over. |`,
};

export const INCLUDE = /\{\{include:([a-z0-9-]+)\}\}/g;

/** `{{include:x}}` replaced by fragment `x`; an unknown name stays as written. One level: fragments hold none. */
export function fillIncludes(text: string): string {
  return text.replace(INCLUDE, (match, name: string) => FRAGMENTS[name] ?? match);
}
