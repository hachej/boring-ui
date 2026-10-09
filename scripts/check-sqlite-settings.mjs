// Guard: SQLite journal and locking modes are chosen in one place. Every v4 opener takes `SqliteSettings` and turns them into
// statements through packages/files/src/sqlite-settings.ts (`openNodeConnection`, `openNodeDatabase` for Pi's own storage, the
// browser's SQLite Wasm), so a host on a network file system (EFS) can choose a rollback journal and an exclusive lock for every
// file it opens. A tracked source file that sets `PRAGMA journal_mode` or `PRAGMA locking_mode` itself (`= ...` or `(...)`)
// would silently force its own mode again (WAL on NFS corrupts). Reading the current mode (`PRAGMA journal_mode` alone) is fine.
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const SETTINGS_MODULE = 'packages/files/src/sqlite-settings.ts';
const SETS_MODE = /PRAGMA\s+(?:\w+\.)?(?:journal_mode|locking_mode)\s*(?:=|\()/gi;
const CODE = /\.(?:[cm]?[jt]sx?)$/;

/** Every place in tracked source (or in `files`) that sets a journal or locking mode outside the settings module, as `path:line: text`. */
export function checkSqliteSettings(root, files) {
  const listed = files ?? spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  const found = [];
  for (const path of listed) {
    if (!CODE.test(path) || path === SETTINGS_MODULE || path === 'scripts/check-sqlite-settings.mjs' || path.startsWith('public/')) continue;
    let text;
    try { text = readFileSync(resolve(root, path), 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(SETS_MODE)) found.push(`${path}:${index + 1}: ${match[0]}`);
    });
  }
  return found;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = checkSqliteSettings(realpathSync(fileURLToPath(new URL('../', import.meta.url))));
  if (found.length) {
    console.error(found.map(hit => `BORING-SQLITE ${hit} sets a SQLite mode outside ${SETTINGS_MODULE}; pass SqliteSettings to the opener instead`).join('\n'));
    process.exitCode = 1;
  } else console.log(`ok: SQLite journal and locking modes are set only in ${SETTINGS_MODULE}`);
}
