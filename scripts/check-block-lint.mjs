// Apps lint the blocks they install with the app template's rules (hachej/boring-factory templates/app/.oxlintrc.json), skipping
// only the kit folders their own config has always ignored. A block with a lint error there fails every app's `lint` check after
// a kit bump, which no boring-ui check saw (0.4.12: pi-chat-markdown). scripts/app-oxlint.json is that config with the paths moved
// to registry/; this runs it over every block and fails on any error (warnings stay warnings, as in the apps).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url)), '-c', 'scripts/app-oxlint.json', '--quiet', 'registry'], { cwd: root, encoding: 'utf8' });
if (result.status !== 0) {
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  console.error('block lint: the app template\'s oxlint rules report errors in registry blocks; apps would fail their lint check after this kit (scripts/app-oxlint.json)');
  process.exit(1);
}
console.log('ok: registry blocks pass the app template\'s oxlint rules (errors), as apps lint them');
