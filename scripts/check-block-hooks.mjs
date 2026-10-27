// Strict React hooks lint over registry blocks: eslint-plugin-react-hooks' recommended config with the React Compiler rules
// (eslint.config.mjs), warnings included (--max-warnings 0). Blocks are copied into apps, so a hooks or compiler violation here ships
// to every app that installs the block. A targeted `eslint-disable-next-line <rule> -- <reason>` is the only accepted exception.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url)), '--max-warnings', '0', '--no-warn-ignored', 'registry/**/*.{ts,tsx}'], { cwd: root, encoding: 'utf8' });
if (result.status !== 0) {
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  console.error('block hooks lint: registry blocks break the React hooks / React Compiler rules (eslint.config.mjs)');
  process.exit(1);
}
console.log('ok: registry blocks pass eslint-plugin-react-hooks recommended (React Compiler rules included), no warnings');
