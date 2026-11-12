/**
 * Split a shell command into its simple commands, each a list of words with quoting removed (HIVE-407).
 *
 * Built for the permission fences, which must judge what a command *does* rather than what its text
 * contains: `git push -o "ci;skip" origin main` is one push to `main`, and `main>out.txt` names `main`.
 * A command substitution, a process substitution and a subshell become commands of their own, and the
 * word a substitution fills in keeps a `$`, so a fence can see it is dynamic. Redirections and comments
 * are dropped. Returns `undefined` when the command cannot be parsed; a caller fails closed on that.
 * shortcut: a POSIX subset (no `case`, no arithmetic, a heredoc body reads as commands); good enough to
 * find a command's words for a fence, never to run one. Grow it here, behind its table, if a fence needs more.
 */
type Frame = { words: string[]; word: string | undefined; quoted: boolean; opener: string };

export function shellSegments(command: string): string[][] | undefined {
  const segments: string[][] = [];
  const stack: Frame[] = [];
  let words: string[] = [];
  let word: string | undefined;
  let inDouble = false;
  let dropNext = false;

  const endWord = (): void => {
    if (word === undefined) return;
    if (dropNext) dropNext = false;
    else words.push(word);
    word = undefined;
  };
  const endSegment = (): void => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };
  const open = (opener: string): void => {
    stack.push({ words, word, quoted: inDouble, opener });
    words = [];
    word = undefined;
    inDouble = false;
  };
  const close = (): void => {
    endSegment();
    const frame = stack.pop()!;
    words = frame.words;
    inDouble = frame.quoted;
    // A substitution's value is not known here; a plain subshell is just a nested command.
    word = frame.opener === '(' ? frame.word : (frame.word ?? '') + '$';
  };

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];

    if (c === '\\') {
      if (next === undefined) return undefined;
      // An escaped backtick inside a backtick substitution nests another one: too deep to follow.
      if (next === '`' && stack.some((frame) => frame.opener === '`')) return undefined;
      i++;
      if (next === '\n') continue;
      if (inDouble && !'"\\$`'.includes(next)) word = (word ?? '') + c;
      word = (word ?? '') + next;
      continue;
    }
    if (c === '$' && next === '(') {
      i++;
      open('$(');
      continue;
    }
    if (c === '`') {
      if (stack.at(-1)?.opener === '`') close();
      else open('`');
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      else word = (word ?? '') + c;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      word ??= '';
      continue;
    }
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return undefined;
      word = (word ?? '') + command.slice(i + 1, end);
      i = end;
      continue;
    }
    if (c === '#' && word === undefined) {
      const end = command.indexOf('\n', i);
      i = (end === -1 ? command.length : end) - 1;
      continue;
    }
    if ((c === '<' || c === '>') && next === '(') {
      i++;
      endWord();
      open('<(');
      continue;
    }
    if (c === '(') {
      endSegment();
      open('(');
      continue;
    }
    if (c === ')') {
      if (stack.length === 0 || stack.at(-1)!.opener === '`') return undefined;
      close();
      continue;
    }
    if (c === '<' || c === '>' || (c === '&' && next === '>')) {
      // A redirection: drop it, its fd digit, and its target word.
      if (word !== undefined && /^\d+$/.test(word)) word = undefined;
      endWord();
      while ('<>&|'.includes(command[i + 1] ?? ' ')) i++;
      const fd = /^\d+/.exec(command.slice(i + 1));
      if (fd !== null && command[i] === '&') i += fd[0].length; // `>&2`: the target is an fd, not a word
      else dropNext = true;
      continue;
    }
    if (c === ';' || c === '&' || c === '|' || c === '\n') {
      endSegment();
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      continue;
    }
    word = (word ?? '') + c;
  }

  if (inDouble || stack.length > 0) return undefined;
  endSegment();
  return segments;
}
