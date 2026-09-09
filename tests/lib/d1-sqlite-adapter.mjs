/* A minimal D1-shaped wrapper over node:sqlite, so tests exercise the exact
   Worker code and SQL that ships — not a mock of them. Implements the subset
   of the D1 API this project's routes actually use:
     env.DB.prepare(sql).bind(...args).run() / .first() / .all()
   `db.exec(sql)` is used to apply the migration file directly. */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

export function createD1(migrationPaths = []) {
  const raw = new DatabaseSync(':memory:');
  for (const path of migrationPaths) raw.exec(fs.readFileSync(path, 'utf8'));

  return {
    _raw: raw,
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...params) {
          this._params = params;
          return this;
        },
        async run() {
          const stmt = raw.prepare(this._sql);
          const info = stmt.run(...this._params);
          return { success: true, meta: { last_row_id: info.lastInsertRowid, changes: info.changes } };
        },
        async first() {
          const stmt = raw.prepare(this._sql);
          return stmt.get(...this._params) ?? null;
        },
        async all() {
          const stmt = raw.prepare(this._sql);
          return { results: stmt.all(...this._params), success: true };
        },
      };
    },
    exec(sql) {
      raw.exec(sql);
    },
  };
}
