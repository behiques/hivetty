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
    // A redirect's target is the substitution as a whole, never the first word inside it.
    ['a here-string target that is a substitution', 'cat <<< $(git push origin main>/dev/null)', [['git', 'push', 'origin', 'main'], ['cat']]],
    ['a redirect target that is a quoted substitution', 'cat > "$(git push origin main>/dev/null)"', [['git', 'push', 'origin', 'main'], ['cat']]],
    ['a redirect target that is a backtick', 'echo x > `git push origin main>/dev/null`', [['git', 'push', 'origin', 'main'], ['echo', 'x']]],
    ['a redirect from a process substitution', 'cat < <(git push origin main>/dev/null)', [['git', 'push', 'origin', 'main'], ['cat']]],
    ['a redirect target with a substitution inside it', 'cat > x$(git push origin main)', [['git', 'push', 'origin', 'main'], ['cat']]],
    // A heredoc body is data, skipped to its delimiter line; a lone apostrophe in it is just text.
    ['a heredoc body is skipped', 'cat <<EOF\ngit push origin main\nEOF', [['cat']]],
    ['an apostrophe in a heredoc body', "cat <<EOF\nit's\nEOF\ngit push origin main>/dev/null # '", [['cat'], ['git', 'push', 'origin', 'main']]],
    ['a quoted delimiter keeps its body literal', "git commit -F - <<'EOF'\nrun $(x) and `y`\nEOF", [['git', 'commit', '-F', '-']]],
    ['a double-quoted delimiter', 'cat <<"EOF"\n$(x)\nEOF', [['cat']]],
    ['an escaped delimiter', 'cat <<\\EOF\n$(x)\nEOF', [['cat']]],
    ['<<- strips leading tabs from the delimiter line', 'cat <<-EOF\n\tbody\n\tEOF\necho done', [['cat'], ['echo', 'done']]],
    ['the line after the heredoc operator still parses', "cat <<'EOF' | grep x\nbody\nEOF", [['cat'], ['grep', 'x']]],
    ['two heredocs on one line', "cat <<'A' <<'B'\none\nA\ntwo\nB\nls", [['cat'], ['ls']]],
    ['a here-string is not a heredoc', 'cat <<< hi', [['cat']]],
    ['a carriage return is part of a word, as in bash', 'true\r# ; git push origin main>/dev/null', [['true\r#'], ['git', 'push', 'origin', 'main']]],
  ];

  it.each(cases)('%s', (_name, command, words) => {
    expect(shellSegments(command)).toEqual(words);
  });

  it('reads `((` inside double quotes as text, not arithmetic', () => {
    expect(shellSegments('git commit -m "fix ((x))"')).toEqual([['git', 'commit', '-m', 'fix ((x))']]);
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
    // An unquoted heredoc body runs its substitutions; following them is too far.
    ['a substitution in an unquoted heredoc body', 'cat <<EOF\n$(git push origin main)\nEOF'],
    ['a backtick in an unquoted heredoc body', 'cat <<EOF\n`git push origin main`\nEOF'],
    ['a heredoc that never ends', 'cat <<EOF\nbody'],
    ['a heredoc on the last line', 'cat <<EOF'],
    ['a heredoc with no delimiter', 'cat << ;'],
    ['ANSI-C quoting', "echo $'it\\'s' && git push origin main>/dev/null # '"],
    ['a redirect with no target before an operator', 'echo >; git push origin main'],
    ['a redirect with no target at the end', 'git push origin main >'],
    // Arithmetic reads `<<` as a shift, not a heredoc; following it is too far (#281 round 3).
    ['an arithmetic expansion', 'echo $((1<<2))\ngh pr merge 2\n2'],
    ['an arithmetic command', '((x = 1<<2))\ngh pr merge 2\n2'],
  ])('cannot parse %s', (_name, command) => {
    expect(shellSegments(command)).toBeUndefined();
  });
});
