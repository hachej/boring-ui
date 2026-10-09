// Installed-block consumer for the `pi-app` registry item: a disposable app outside this repository installs pi-app with the real pinned
// shadcn CLI over HTTP (the `@boring-ui` namespace mapped to a local registry, so its registry dependencies pi-chat, pi-workspace, viewers,
// utils, button and theme resolve as they would from a hosted one), with every package pinned to an integrity-checked archive. It then
// type-checks the copied source and a consumer page strictly and bundles the page for the browser (no kernel, server or Node code).
// Usage: npm run build && npm run registry:build && npm_config_cache=<cache> npm run test:app-registry-consumer
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { assertConsumerTypeFiles, prepareConsumerIsolation, npmInstallFlags } from './consumer-isolation.mjs';
import { consumerDependencies, localRegistryItem, packBoringDependencies, writeLockedManifest } from './consumer-install.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => JSON.parse(readFileSync(join(root, 'public/r', `${name}.json`), 'utf8'));
// The block and every item it needs, through registryDependencies.
const closure = new Map();
const visit = name => { if (closure.has(name)) return; const item = read(name); closure.set(name, item); for (const dependency of item.registryDependencies ?? []) visit(dependency.replace('@boring-ui/', '')); };
visit('pi-app');
visit('file-tree');
const directory = mkdtempSync(join(tmpdir(), 'boring-app-consumer-'));
const cache = process.env.npm_config_cache;
assert.ok(cache, 'Set npm_config_cache to a writable npm cache (npm run sets it)');
function run(command, args, env) {
  const result = runCaptured(command, args, { cwd: directory, timeout: 300000, ...(env ? { env } : {}) });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.error?.message ?? result.signal ?? result.status}`);
  return result.stdout;
}

let completed = false, server;
try {
  const isolated = prepareConsumerIsolation(directory);
  mkdirSync(join(directory, 'packs'));
  // One union of the closure's package pins: pack the @boring ones, lock the others to this repository's lock.
  const pins = [...new Set([...closure.values()].flatMap(item => item.dependencies ?? []))];
  const union = { dependencies: pins };
  const archiveByName = packBoringDependencies(root, union, join(directory, 'packs'), run);
  const dependencies = consumerDependencies(root, union, ['typescript', '@types/react', '@types/react-dom', 'esbuild', 'shadcn', 'tailwindcss']);
  writeLockedManifest(root, directory, 'isolated-app-consumer', dependencies);
  run('npm', ['install', '--package-lock-only', ...npmInstallFlags(cache), ...archiveByName.values()]);
  run('npm', ['ci', ...npmInstallFlags(cache)]);

  // The local registry: every item of the closure with its pins pointed at the checked archives, served over HTTP by a child process.
  mkdirSync(join(directory, 'registry/r'), { recursive: true });
  for (const [name, item] of closure) writeFileSync(join(directory, 'registry/r', `${name}.json`), JSON.stringify(item.dependencies ? localRegistryItem(root, item, archiveByName, join(directory, 'packs'), cache, run) : item));
  server = spawn(process.execPath, ['-e', `const { createServer } = require('node:http'); const { readFile } = require('node:fs/promises'); const { join } = require('node:path');
createServer(async (req, res) => { try { const body = await readFile(join(${JSON.stringify(join(directory, 'registry'))}, new URL(req.url, 'http://x').pathname.replace(/\\.\\./g, ''))); res.writeHead(200, { 'content-type': 'application/json' }).end(body); } catch { res.writeHead(404).end(); } })
  .listen(0, '127.0.0.1', function () { console.log('port ' + this.address().port); });`], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((done, fail) => { server.stdout.on('data', chunk => { const found = /port (\d+)/.exec(String(chunk)); if (found) done(Number(found[1])); }); server.once('exit', code => fail(new Error(`registry server exited ${code}`))); });
  const registry = `http://127.0.0.1:${port}/r`;

  for (const path of ['src', 'dist']) mkdirSync(join(directory, path), { recursive: true });
  writeFileSync(join(directory, 'components.json'), JSON.stringify({ $schema: 'https://ui.shadcn.com/schema.json', style: 'new-york', rsc: false, tsx: true, tailwind: { config: '', css: 'src/index.css', baseColor: '', cssVariables: true, prefix: '' },
    iconLibrary: 'lucide', aliases: { components: '@/components', utils: '@/lib/utils', ui: '@/components/ui', lib: '@/lib', hooks: '@/hooks' }, registries: { '@boring-ui': `${registry}/{name}.json` } }));
  writeFileSync(join(directory, 'src/index.css'), '@import "tailwindcss";\n');
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noUncheckedIndexedAccess: true, skipLibCheck: false,
    noEmit: true, types: [], lib: ['ES2023', 'DOM', 'DOM.Iterable'], baseUrl: '.', paths: { '@/*': ['./src/*'] } }, include: ['src/components/pi-app/**/*.tsx', 'src/components/pi-app/**/*.ts', 'src/page.tsx'] }));
  const installer = { ...process.env, npm_config_cache: cache, npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  delete installer.NODE_OPTIONS;
  run(process.execPath, ['node_modules/shadcn/dist/index.js', 'add', `${registry}/pi-app.json`, `${registry}/file-tree.json`, '--cwd', directory, '--yes'], installer);
  for (const [name, item] of closure) for (const file of item.files ?? []) assert.ok(existsSync(join(directory, 'src', file.target)), `the CLI must create ${file.target} (${name})`);
  const css = readFileSync(join(directory, 'src/index.css'), 'utf8');
  assert.ok(css.includes('--background') && css.includes('.pi-chat'), 'theme tokens and the chat\'s scoped css merged into the host stylesheet');

  // A consumer page: only the block, its hooks and the host's own routes.
  writeFileSync(join(directory, 'src/page.tsx'), `import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentWorkspace, useConversations, useRemoteChat } from './components/pi-app/agent-workspace';
import type { OpenedView } from './components/pi-app/agent-workspace';
import type { BlockAction, ChatLabels } from './components/pi-chat/pi-chat';
import { DownloadIcon } from 'lucide-react';
import { FileTree } from './components/file-tree/file-tree';
import type { RevisionProvider } from '@hachej/boring-files/revision';

export function BoundWorkspace({ revisionProvider }: { readonly revisionProvider: RevisionProvider }) {
  return <><AgentWorkspace revisionProvider={revisionProvider} controller={undefined} conversationId={undefined} /><FileTree revisionProvider={revisionProvider} />
    <AgentWorkspace revisionProvider={revisionProvider} libraryPlacement="pane" onUnsavedChange={unsaved => { void unsaved; }} controller={undefined} conversationId={undefined}
      agents={{ items: [{ id: 'pm', label: 'PM' }, { id: 'dev', label: 'Developer' }], activeId: 'pm', onSelect: () => {} }} /></>;
}

const identity = { runtimeId: 'app', scopeId: 'fictional-team', principalId: 'fictional-person', initiatorId: 'fictional-person' };
const at = (path: string) => new URL(path, location.href);
const resources = { endpoint: at('/api/resources'), history: at('/api/history'), fetch: (request: Request) => fetch(request), identity };

// The configurable surface, checked strictly: partial labels (a function among them), a host icon, actions on each surface.
const SparkIcon = ({ className }: { readonly className?: string | undefined }) => <svg className={className} viewBox="0 0 16 16" />;
const chatLabels: Partial<ChatLabels> = { title: 'Writer', placeholder: 'Ask anything…', noMatch: query => 'Nothing for ' + query };
const exportChat: BlockAction = { id: 'export', label: 'Export chat', icon: DownloadIcon, onSelect: () => {} };

export function App() {
  const [selected, setSelected] = useState<string>();
  const [opened, setOpened] = useState<OpenedView | null>(null);
  const conversations = useConversations({ endpoint: at('/api/conversations'), fetch: request => fetch(request), activeId: selected, onSelect: setSelected });
  const items = conversations?.items;
  useEffect(() => { if (items?.length && !items.some(item => item.id === selected)) setSelected(items[0]!.id); }, [items, selected]);
  const chat = useRemoteChat({ conversationId: selected, endpoint: id => at('/api/chat?conversation=' + id), fetch: request => fetch(request), identity });
  return <AgentWorkspace conversationId={selected} controller={chat.status === 'ready' ? chat.controller : undefined} resources={resources}
    conversations={conversations && { ...conversations, rowActions: item => [{ id: 'star', label: 'Star ' + (item.title ?? ''), placement: 'menu', onSelect: () => {} }] }}
    labels={{ sessionsTitle: 'Projects', share: 'Send a link' }} icons={{ newChat: SparkIcon }} panelActions={view => view.kind === 'artifact' ? [exportChat] : []}
    opened={opened} onOpenedChange={setOpened} connecting={<p>Connecting…</p>}
    chat={{ labels: chatLabels, icons: { send: SparkIcon }, headerActions: [exportChat], messageActions: reply => [{ id: 'quote', label: 'Quote ' + reply.key, onSelect: () => {} }], ...(chat.status === 'ready' ? { actions: chat.actions } : {}) }} />;
}
createRoot(document.getElementById('root')!).render(<App />);
`);
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'src/page.tsx', '--bundle', '--platform=browser', '--format=esm', '--jsx=automatic', '--outfile=dist/page.js', '--metafile=dist/meta.json',
    '--define:process.env.NODE_ENV="production"', '--alias:@=./src'], isolated);
  const bundledCss = readFileSync(join(directory, 'dist/page.css'), 'utf8');
  assert.ok(bundledCss.includes('sidebar-menu-button') && bundledCss.includes('file-tree'), 'portable tree styles ship without scanning package internals');
  const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'dist/meta.json'), 'utf8')).inputs);
  assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
  for (const file of ['file-tree/file-tree.tsx', 'pi-app/agent-workspace.tsx', 'pi-app/artifact-panel.tsx', 'pi-app/file-viewer.tsx', 'pi-app/sessions.tsx', 'pi-chat/pi-chat.tsx', 'pi-workspace/workspace.tsx', 'viewers/viewer-frame.tsx'])
    assert.ok(inputs.some(path => path.endsWith(`src/components/${file}`)), `the bundle uses the CLI-installed ${file}`);
  assert.deepEqual(inputs.filter(path => /@hachej\/boring-agent|pi-durable\/dist\/(storage|env)|sqlite|node:|tldraw/.test(path)), [], 'browser bundle holds no agent, storage, Node or canvas code');
  console.log(`PASS: real pinned shadcn installation of pi-app over HTTP with its ${closure.size - 1} registry dependencies, strict declarations of the copied block and a consumer page, and a browser bundle; type and bundle evidence only`);
  completed = true;
} finally {
  server?.kill();
  if (completed) rmSync(directory, { recursive: true, force: true });
  else console.error('Retained failing disposable app consumer at ' + directory);
}
