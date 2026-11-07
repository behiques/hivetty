import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { HarnessId } from '@shared/harness-contract';
import { renderSkillText } from '@shared/skill-render';

import { adapterFor } from '../harness/registry';

import type { SkillsRead } from './read';

/**
 * Generating the folders each CLI loads HiveTTY's skills from (HIVE-96, HIVE-369).
 *
 * The folders are the app's, not the user's: regenerated from
 * `~/.hivetty/skills` at launch and again before every spawn, and safe to delete.
 * Nothing reads them but the CLIs, and nothing writes them but this module.
 */

/**
 * Copy one file only when the destination differs, preserving its mode.
 *
 * Size, mtime and mode rather than a content hash: this runs before every
 * spawn, and hashing every file in every bundle to discover that nothing
 * changed would cost more than the copy it avoids. Size and mtime are the pair
 * `rsync` compares for the same reason; mode is added because this is also the
 * only place a mode change ever reaches the mirror, and without it a
 * `chmod +x` on a file whose bytes and mtime are unchanged would never
 * re-copy.
 *
 * `mtime.getTime()`, not `mtimeMs`. `utimes` takes a `Date`, and `Date` holds
 * whole milliseconds only, so the mtime this function sets on `to` always has
 * a zero fractional part. A filesystem that reports one on `from` — APFS does
 * — then never matches `mtimeMs`, and the skip would never fire: every
 * regeneration would `copyFile` (which truncates before rewriting) every file
 * in every bundle, on every spawn. `getTime()` applies the same truncation to
 * both sides of the comparison, so a source that has not moved compares equal
 * after this function is the one that set the destination's mtime.
 *
 * `mode & 0o777` on both sides, not raw `mode`, which also carries file-type
 * bits that are irrelevant here and would make the comparison meaningless.
 */
async function copyIfChanged(from: string, to: string): Promise<void> {
  const source = await stat(from);

  try {
    const destination = await stat(to);
    if (
      destination.size === source.size &&
      destination.mtime.getTime() === source.mtime.getTime() &&
      (destination.mode & 0o777) === (source.mode & 0o777)
    ) {
      return;
    }
  } catch {
    // Not there yet. Fall through and copy.
  }

  await copyFile(from, to);
  // `copyFile` does not carry the mode across. Without this a 755 script lands
  // 644 and the session cannot run it — the failure this story exists to fix,
  // moved one step later.
  await chmod(to, source.mode & 0o777);
  await utimes(to, source.atime, source.mtime);
}

/**
 * Write `body` to `to` only when it differs from what is already there.
 *
 * `writeFile` opens with `O_TRUNC`, so an unconditional write of the one
 * file a session actually reads first is momentarily zero-length on every
 * regeneration — the exact window `copyIfChanged`'s comparison exists to
 * avoid, reopened on the most important file in the bundle. `SKILL.md` is
 * one small file already read whole into `skill.body`, so a straight string
 * comparison is enough; this is deliberately not routed through
 * `copyIfChanged`, which compares `stat` fields against a source *file* on
 * disk, and there is no file to stat here — only the string `readUserSkills`
 * already read.
 */
export async function writeIfChanged(to: string, body: string): Promise<void> {
  try {
    if ((await readFile(to, 'utf8')) === body) return;
  } catch {
    // Missing, or unreadable. Fall through and write.
  }

  await writeFile(to, body, 'utf8');
}

/** An extra that is a skill's own SKILL.md, the files `transform` applies to (HIVE-372). */
const SKILL_MD = /^skills\/[^/]+\/SKILL\.md$/;

/**
 * Clear whatever is at `path` when it exists and is not a `kind`.
 *
 * A stale `mkdir` throws `EEXIST` over a file that used to be a directory's
 * name, and a stale `copyFile` throws `EISDIR` over a directory that used to
 * be a file's name. Both are permanent: the copy phase below runs before
 * `prune`, so the stale entry is never cleared and every later regeneration
 * throws the same way — which, uncaught two frames up, drops `--plugin-dir`
 * from the spawn entirely and disables every skill, not just this one.
 *
 * `lstat`, not `stat`: a symlink is not a `kind` either way, which is what
 * stops a destination symlink named like an admitted path from surviving to
 * let `mkdir({ recursive: true })` or `copyFile` resolve through it and write
 * outside `root`.
 */
async function ensureKind(
  path: string,
  kind: 'file' | 'directory',
): Promise<void> {
  let existing;
  try {
    existing = await lstat(path);
  } catch {
    return;
  }

  const matches =
    kind === 'directory' ? existing.isDirectory() : existing.isFile();
  if (!matches) {
    await rm(path, { recursive: true, force: true });
  }
}

/** Remove anything under `dir` that is not in `expected`, depth-first. */
async function prune(
  dir: string,
  expected: Set<string>,
  rel = '',
): Promise<void> {
  let listing;
  try {
    listing = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of listing) {
    const path = rel === '' ? item.name : `${rel}/${item.name}`;
    if (!expected.has(path)) {
      await rm(join(dir, item.name), { recursive: true, force: true });
      continue;
    }
    if (item.isDirectory()) {
      await prune(join(dir, item.name), expected, path);
    }
  }
}

/**
 * Regenerate the plugin directory from `read`.
 *
 * Modelled on `writeHookSettings` (`harness/claude-code/settings.ts`): generated up front so
 * that the spawn path *picks a path* rather than negotiating with a live
 * directory.
 *
 * ## Why stale removal is a diff rather than a wipe
 *
 * Deleting `skills/` and rewriting it would be shorter, and wrong. This runs
 * before **every** spawn, so regenerations and spawns interleave — and a wipe
 * leaves a window in which a session that is starting right now reads an empty
 * plugin. The diff only touches entries that should not be there, so a session
 * starting concurrently sees either the old set or the new one, never nothing.
 *
 * The corollary is that this is idempotent, which the tests assert directly:
 * running it twice with the same input must leave the same directory.
 *
 * ## Why this mirrors a folder rather than writing a file (HIVE-148)
 *
 * A skill is its whole folder. Writing only its SKILL.md delivered a command
 * whose first instruction ran a script that was not on disk, with no error on
 * either side. The diff argument above did not change; it got stronger. There
 * are more files to lose in the window a wipe would open, and a prune that
 * lies now has a subtree to delete rather than a file.
 *
 * `SKILL.md` itself is the one entry written directly from `skill.body`
 * rather than mirrored through the entry loop, the same way `/done` already
 * is. `readBundle` walks in name order and stops hard at a file-count cap, so
 * a bundle whose `assets/` or `scripts/` sorts before `SKILL.md` and is large
 * enough can produce a manifest that never lists it — the exact failure this
 * story exists to fix, reproduced one layer along, silently. Writing it
 * unconditionally (structurally, as in "every call reaches this line" —
 * see `writeIfChanged` for why the write itself is still conditional on
 * content) makes "the file a session executes is missing from the mirror"
 * impossible instead of dependent on another module's walk order or size cap.
 *
 * ## One folder per CLI (HIVE-369)
 *
 * `cli`'s adapter names the files beside `skills/` (`adapterFor(cli).skills.extras`), every
 * markdown file is rendered for `cli` through `renderSkillText`, and every skill reaches every CLI.
 * A skill with no placeholder renders byte for byte as written.
 */
export async function renderSkills(
  root: string,
  cli: HarnessId,
  read: SkillsRead,
  {
    version,
    doneUrl,
    transform = (text: string) => text,
  }: {
    version: string;
    /** HIVE-372: applied to every skills/<n>/SKILL.md written here (the marketplace copy's guard). */
    transform?: (skillMd: string) => string;
    /**
     * Where `/done` reports to, or `null` when nothing is listening (HIVE-93).
     *
     * Passed per call rather than captured once, because this runs before every
     * spawn and the receiver's port is only known after it binds. A directory
     * written during a launch whose receiver never came up holds the inert
     * built-in, and the next regeneration replaces it with the live one — which
     * is why the write below is reached on every call rather than skipped when
     * the file already exists.
     */
    doneUrl: string | null;
  },
): Promise<void> {
  const skillsDir = join(root, 'skills');
  await mkdir(skillsDir, { recursive: true });

  // Only the valid ones. An invalid skill is reported to the pane and left out
  // of every folder entirely — no CLI sees a file this app could not explain.
  // Every skill reaches every CLI (HIVE-369's ruling); only its wording changes.
  const { skills } = read;

  const extras = adapterFor(cli).skills.extras({
    version,
    doneUrl,
    root,
    skills: skills.map(({ name, description }) => ({ name, description })),
  });
  /*
    Unconditionally reached, and compared by content: the app owns these, and a
    copy edited inside userData surviving a launch would make `/done` mean
    something different on one machine than on every other.
  */
  for (const [path, body] of Object.entries(extras)) {
    const to = join(root, path);
    // Every folder on the way, not only the leaf: a symlink at `skills/done`
    // would carry the write outside `root`, and a file there would make the
    // `mkdir` throw `EEXIST` on every regeneration.
    const segments = path.split('/').slice(0, -1);
    for (let depth = 1; depth <= segments.length; depth += 1) {
      await ensureKind(join(root, ...segments.slice(0, depth)), 'directory');
    }
    await mkdir(dirname(to), { recursive: true });
    await ensureKind(to, 'file');
    await writeIfChanged(to, SKILL_MD.test(path) ? transform(body) : body);
  }

  for (const skill of skills) {
    const destination = join(skillsDir, skill.name);
    // A symlinked skill root would let the recursive `mkdir` below (and every
    // write under it) resolve through it and land outside `root`.
    await ensureKind(destination, 'directory');
    await mkdir(destination, { recursive: true });

    const skillMdPath = join(destination, 'SKILL.md');
    // A symlink here would let the write below land outside `root`
    // with no error; a directory here would throw `EISDIR` forever, since
    // `prune` runs after this and never gets the chance to clear it.
    await ensureKind(skillMdPath, 'file');
    // Written directly from `skill.body`, not mirrored below — see the
    // docblock's "SKILL.md itself" paragraph for why.
    await writeIfChanged(skillMdPath, transform(renderSkillText(skill.body, cli, root)));

    const admitted = skill.manifest.entries.filter(
      (entry) => entry.excluded === null && entry.path !== 'SKILL.md',
    );

    /*
      Per-entry, not per-skill and not per-regeneration (HIVE-148 review).

      `read.ts` and `bundle.ts` both hold the same rule for the walk that
      produced this list: a bad entry costs that entry, never everything
      after it. This loop is the one place that rule was not yet applied —
      `copyIfChanged` now `stat`s and `copyFile`s a file this app did not
      write, from a tree the user hand-edits (mode `000`, a file deleted
      between the walk above and this copy), and an uncaught throw here
      propagated out of `renderSkills` into `regenerate`'s `catch`, which
      sets `written` back to `false` — dropping `--plugin-dir` from *every*
      spawn, including `/done`'s, over one unreadable file in one bundle.

      Not swallowed silently either: `console.info` names the skill and the
      file, the same channel `regenerate` already uses for its own non-fatal
      failure, so the one file missing from the mirror is at least
      discoverable without the pane growing a UI for it.
    */
    // Directories first, so a file never arrives before its parent exists.
    for (const entry of admitted) {
      if (entry.kind === 'directory') {
        const path = join(destination, entry.path);
        try {
          await ensureKind(path, 'directory');
          await mkdir(path, { recursive: true });
        } catch (cause) {
          console.info(
            `[hive] the skill "${skill.name}" could not mirror "${entry.path}" — that folder is missing from the session's copy (${String(cause)})`,
          );
        }
      }
    }
    for (const entry of admitted) {
      if (entry.kind === 'file') {
        const to = join(destination, entry.path);
        try {
          await ensureKind(to, 'file');
          if (entry.path.endsWith('.md')) {
            // A bundle's other markdown names tools too (pr-review's prompts).
            await writeIfChanged(
              to,
              renderSkillText(
                await readFile(join(skill.dir, entry.path), 'utf8'),
                cli,
                root,
              ),
            );
          } else {
            await copyIfChanged(join(skill.dir, entry.path), to);
          }
        } catch (cause) {
          console.info(
            `[hive] the skill "${skill.name}" could not mirror "${entry.path}" — that file is missing from the session's copy (${String(cause)})`,
          );
        }
      }
    }

    await prune(
      destination,
      new Set(['SKILL.md', ...admitted.map((entry) => entry.path)]),
    );
  }

  const expected = new Set([
    ...skills.map((skill) => skill.name),
    // Extras under `skills/` (Claude's `/done`) are expected there too.
    ...Object.keys(extras)
      .filter((path) => path.startsWith('skills/'))
      .map((path) => path.split('/')[1] ?? ''),
  ]);

  for (const entry of await readdir(skillsDir)) {
    if (!expected.has(entry)) {
      await rm(join(skillsDir, entry), { recursive: true, force: true });
    }
  }
}
