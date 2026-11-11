import { readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export async function createStore(directory) {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'notes.sqlite');
  // Precreate privately on POSIX; Windows inherits the Desktop data directory ACL.
  const handle = await open(file, 'a', process.platform === 'win32' ? undefined : 0o600);
  await handle.close();
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, author TEXT NOT NULL, subject TEXT NOT NULL,
        text TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, revision INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS notes_owner_time ON notes(owner, createdAt DESC);
      CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY) STRICT;`);
    const insert = db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    if (!db.prepare('SELECT 1 FROM migrations WHERE name=?').get('json-v1')) {
      let legacy = {};
      try { legacy = JSON.parse(await readFile(path.join(directory, 'notes.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw Error('Invalid legacy notes');
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [owner, note] of Object.entries(legacy)) {
          if (!/^[a-f0-9]{64}$/.test(owner) || typeof note.text !== 'string' || !Number.isSafeInteger(note.revision) || note.revision < 0 || !Number.isFinite(Date.parse(note.updatedAt))) throw Error('Invalid legacy note');
          insert.run('legacy-' + owner, owner, '当前账号（历史便签）', '', note.text, note.updatedAt, note.updatedAt, note.revision);
        }
        db.prepare('INSERT INTO migrations VALUES (?)').run('json-v1');
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const fields = 'id, author, subject, text, createdAt, updatedAt, revision';
    const list = db.prepare(`SELECT ${fields}, owner = ? AS isMine FROM notes ORDER BY createdAt DESC, rowid DESC`);
    const legacyGet = db.prepare(`SELECT ${fields} FROM notes WHERE owner=? AND id=?`);
    let closed = false;
    return {
      list(owner) { return list.all(owner).map(note => ({ ...note, isMine: Boolean(note.isMine),
        author: note.author === '当前账号（历史便签）' && !note.isMine ? '历史便签' : note.author })); },
      add(user, text) {
        const id = randomUUID(), now = new Date().toISOString();
        insert.run(id, user.id, user.name, user.subject, text, now, now, 1);
        return { id, author: user.name, subject: user.subject, text, createdAt: now, updatedAt: now, revision: 1 };
      },
      // Preserve the previous single-note API during upgrades. New clients use /api/notes.
      get(owner) { return legacyGet.get(owner, 'legacy-' + owner) ?? { text: '', revision: 0, updatedAt: null }; },
      save(owner, text, revision) {
        const id = 'legacy-' + owner, now = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
          const previous = legacyGet.get(owner, id);
          if ((previous?.revision ?? 0) !== revision) throw Object.assign(Error('便签已在其他页面更新，请重新读取后再保存。'), { code: 'revision_conflict', status: 409 });
          if (previous) db.prepare('UPDATE notes SET text=?, updatedAt=?, revision=? WHERE owner=? AND id=?').run(text, now, revision + 1, owner, id);
          else insert.run(id, owner, '当前账号（历史便签）', '', text, now, now, revision + 1);
          db.exec('COMMIT');
          return { text, revision: revision + 1, updatedAt: now };
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      },
      async close() { if (!closed) { closed = true; db.close(); } }
    };
  } catch (error) { db.close(); throw error; }
}
