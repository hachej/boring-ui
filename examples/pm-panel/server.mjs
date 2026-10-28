import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startAppShell } from '../app-shell/server.mjs';

export async function startPmPanel() {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-pm-panel-'));
  const originals = process.env.PM_BEFORE ? new Map(['app-shell.tsx', 'agent-layer.tsx', 'nav.tsx'].map(name => [name, execFileSync('git', ['show', `f81113dc9:registry/app-shell/${name}`], { encoding: 'utf8' })])) : undefined;
  try {
    const app = await startAppShell({ directory, scripted: true, pageFile: fileURLToPath(new URL('./page.tsx', import.meta.url)), browserPlugins: originals ? [{ name: 'pre-pm-public-shell', setup(builder) {
      builder.onLoad({ filter: /registry\/app-shell\/(app-shell|agent-layer|nav)\.tsx$/ }, args => ({ contents: originals.get(args.path.split('/').pop()), loader: 'tsx', resolveDir: fileURLToPath(new URL('../../registry/app-shell/', import.meta.url)) }));
    } }] : [] });
    return { ...app, close: async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); } };
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startPmPanel(); console.log(`Fictional PM panel: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
