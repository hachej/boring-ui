import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mutations = [
  {
    from: '  continuation_key TEXT NOT NULL UNIQUE,\n',
    to: '  continuation_key TEXT NOT NULL,\n',
  },
  {
    from: "BEGIN SELECT RAISE(ABORT, 'stale or superseded pause'); END;",
    to: 'BEGIN SELECT 1; END;',
  },
  {
    from: '  pause_id TEXT PRIMARY KEY,\n  tool_call_id TEXT NOT NULL,\n  continuation_key TEXT NOT NULL,\n  consumed_at INTEGER NOT NULL,',
    to: '  pause_id TEXT NOT NULL,\n  tool_call_id TEXT NOT NULL,\n  continuation_key TEXT NOT NULL,\n  consumed_at INTEGER NOT NULL,',
  },
  {
    from: "BEGIN SELECT RAISE(ABORT, 'pause expired'); END;",
    to: 'BEGIN SELECT 1; END;',
  },
  {
    from: "BEGIN SELECT RAISE(ABORT, 'responder unauthorized'); END;",
    to: 'BEGIN SELECT 1; END;',
  },
];

const [mode, indexText, backupText] = process.argv.slice(2);
const schemaPath = resolve('src/schema.sql');
const backupPath = resolve(backupText);

if (mode === 'apply') {
  const mutation = mutations[Number(indexText)];
  const original = readFileSync(schemaPath, 'utf8');
  if (!mutation || !original.includes(mutation.from)) throw new Error(`mutation target not found: ${indexText}`);
  copyFileSync(schemaPath, backupPath);
  writeFileSync(schemaPath, original.replace(mutation.from, mutation.to));
} else if (mode === 'restore') {
  copyFileSync(backupPath, schemaPath);
} else {
  throw new Error(`unknown mutation mode: ${mode}`);
}
