import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readCopilotTodos } from '../../../../../electron/main/harness/copilot/todos';

// As `todos.ts` loads it: happy-dom's bundling refuses a static `node:sqlite` import.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const UUID = '11111111-2222-4333-8444-555555555561';
const FIXTURE = join(__dirname, '../../../../fixtures/copilot/interactive-1.0.105/session-todos.db');

/** A scratch home whose session folder exists; `db` names where its session.db goes. */
const scratchHome = () => {
  const home = mkdtempSync(join(tmpdir(), 'cop-todos-'));
  const dir = join(home, 'session-state', UUID);
  mkdirSync(dir, { recursive: true });
  return { home, db: join(dir, 'session.db') };
};

describe('readCopilotTodos', () => {
  it("reads the recorded table in Copilot's order, done as completed and blocked as pending", () => {
    const { home, db } = scratchHome();
    copyFileSync(FIXTURE, db);

    // The recording: Alpha done, Beta pending, Gamma blocked, all inserted in the same second.
    expect(readCopilotTodos(UUID, () => home)).toEqual([
      { content: 'Alpha', status: 'completed' },
      { content: 'Beta', status: 'pending' },
      { content: 'Gamma', status: 'pending' },
    ]);
  });

  it('orders by created_at before rowid: ids are free text', () => {
    const { home, db } = scratchHome();
    const write = new DatabaseSync(db);
    write.exec(`CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT, created_at TEXT);
      INSERT INTO todos VALUES ('z', 'Later', 'in_progress', '2026-11-04 20:22:05');
      INSERT INTO todos VALUES ('a', 'Earlier', 'pending', '2026-11-04 20:22:00');`);
    write.close();

    expect(readCopilotTodos(UUID, () => home)).toEqual([
      { content: 'Earlier', status: 'pending' },
      { content: 'Later', status: 'in_progress' },
    ]);
  });

  it('answers undefined when the session has no todos table yet', () => {
    const { home, db } = scratchHome();
    new DatabaseSync(db).close();

    expect(readCopilotTodos(UUID, () => home)).toBeUndefined();
  });

  it('answers undefined, and creates nothing, when the session has no database', () => {
    const { home, db } = scratchHome();

    expect(readCopilotTodos(UUID, () => home)).toBeUndefined();
    expect(existsSync(db)).toBe(false);
  });

  it('never joins an id that is not a uuid into a path', () => {
    expect(readCopilotTodos('../../etc', () => '/h')).toBeUndefined();
  });
});
