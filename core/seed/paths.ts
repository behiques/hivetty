/**
 * `~/.hivetty/.seed.json` — what the last seed wrote, per file.
 *
 * A dotfile beside `config.json`, in `~/.hivetty` rather than userData: it
 * records a fact about files that live in `~/.hivetty`, and a person who copies
 * that folder to a new machine should carry the record with it, or every
 * shipped file they had left untouched would look hand-edited there.
 */
export const SEED_MANIFEST_FILE = '.seed.json';
