import { describe, expect, it } from 'vitest';

import { shellSegments } from '@shared/shell-words';

describe('shellSegments (HIVE-407)', () => {
  const cases: [string, string, string[][]][] = [
    ['plain words', 'git push origin main', [['git', 'push', 'origin', 'main']]],
    ['single quotes are literal', "git push origin 'HEAD:main'", [['git', 'push', 'origin', 'HEAD:main']]],
    ['a quoted operator stays in its word', 'git push -o "ci;skip" origin main', [['git', 'push', '-o', 'ci;skip', 'origin', 'main']]],
    ['escapes in and out of double quotes', 'echo "a\\"b" \'c\'d', [['echo', 'a"b', 'cd']]],
    ['an empty quoted word is a word', 'echo ""', [['echo', '']]],
    ['a variable stays as written', 'echo "$X"', [['echo', '$X']]],
    ['backslash-newline continues the line', 'git push origin \\\n  main', [['git', 'push', 'origin', 'main']]],
    ['&& splits', 'cd /w && git push origin HEAD:main', [['cd', '/w'], ['git', 'push', 'origin', 'HEAD:main']]],
    ['a pipe splits', 'grep -n x f | head', [['grep', '-n', 'x', 'f'], ['head']]],
    ['a redirect touching the token is dropped', 'git push origin main>out.txt', [['git', 'push', 'origin', 'main']]],
    ['a spaced redirect drops its target', 'git push origin main 2> err.txt', [['git', 'push', 'origin', 'main']]],
    ['>> drops its target', 'a>>b c', [['a', 'c']]],
    ['2>&1 is dropped whole', 'git push origin feat/x 2>&1', [['git', 'push', 'origin', 'feat/x']]],
    ['&> is a redirect, not a background', 'git push origin feat/x &>/dev/null', [['git', 'push', 'origin', 'feat/x']]],
    ['a comment runs to the end of the line', 'git push origin feat/x # main', [['git', 'push', 'origin', 'feat/x']]],
    ['a backtick touching the token is a substitution', 'git push origin main`x`', [['x'], ['git', 'push', 'origin', 'main$']]],
    ['$( ) inside quotes leaves a dynamic word', 'git push -u origin "$(git branch --show-current)"', [['git', 'branch', '--show-current'], ['git', 'push', '-u', 'origin', '$']]],
    ['$( ) unquoted leaves a dynamic word', 'git push -u origin $(git branch --show-current)', [['git', 'branch', '--show-current'], ['git', 'push', '-u', 'origin', '$']]],
    ['the outer command resumes after a substitution', 'git push $(echo origin) main', [['echo', 'origin'], ['git', 'push', '$', 'main']]],
    ['a process substitution is its own command', 'cat <(git push origin main)', [['git', 'push', 'origin', 'main'], ['cat', '$']]],
    ['a subshell is its own commands', '(cd x; git push origin main)', [['cd', 'x'], ['git', 'push', 'origin', 'main']]],
    ['a heredoc body reads as commands', 'cat <<EOF\ngit push origin main\nEOF', [['cat'], ['git', 'push', 'origin', 'main'], ['EOF']]],
  ];

  it.each(cases)('%s', (_name, command, words) => {
    expect(shellSegments(command)).toEqual(words);
  });

  it.each([
    ['an unterminated double quote', 'git push origin "main'],
    ['an unterminated single quote', "git push origin 'main"],
    ['a trailing backslash', 'git push origin main\\'],
    ['an unclosed substitution', 'echo $(x'],
    ['an unclosed backtick', 'echo `x'],
    ['a ) with nothing open', 'echo )'],
    ['a ) inside a backtick', 'echo `a)`'],
    ['a backtick nested by escaping', 'echo `a \\`b\\` c`'],
  ])('cannot parse %s', (_name, command) => {
    expect(shellSegments(command)).toBeUndefined();
  });
});
