// Standalone consumer of the `pi-chat` registry item alone: a disposable app outside this repository installs pi-chat with the real pinned
// shadcn CLI over HTTP (its registry dependencies served locally, nothing else), with every package pinned to an integrity-checked archive.
// It then type-checks the copied chat and a page that imports the moved useRemoteChat, and bundles the page for the browser. No pi-app,
// file-tree or other block is installed, so a dependency that only the blocks bring in is caught here.
// Usage: npm run registry:build && npm run build && npm_config_cache=<cache> npm run test:pi-chat-consumer
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { assertConsumerTypeFiles, prepareConsumerIsolation, npmInstallFlags } from './consumer-isolation.mjs';
import { consumerDependencies, packBoringDependencies, registryClosure, serveRegistry, writeLockedManifest } from './consumer-install.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const shared = process.argv.includes('--shared');
const itemName = shared ? 'shared-chat' : 'pi-chat';
const closure = registryClosure(root, itemName);
const directory = mkdtempSync(join(tmpdir(), `boring-${itemName}-consumer-`));
const cache = process.env.npm_config_cache;
assert.ok(cache, 'Set npm_config_cache to a writable npm cache (npm run sets it)');
function run(command, args, env) {
  const result = runCaptured(command, args, { cwd: directory, timeout: 300000, ...(env ? { env } : {}) });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.error?.message ?? result.signal ?? result.status}`);
  return result.stdout;
}

let completed = false, server, registry;
try {
  const isolated = prepareConsumerIsolation(directory);
  mkdirSync(join(directory, 'packs'));
  // The union of the closure's package pins: pack the @hachej ones, lock the others to this repository's lock.
  const pins = [...new Set([...closure.values()].flatMap(item => item.dependencies ?? []))];
  const union = { dependencies: pins };
  const archiveByName = packBoringDependencies(root, union, join(directory, 'packs'), run);
  const dependencies = consumerDependencies(root, union, ['typescript', '@types/react', '@types/react-dom', 'esbuild', 'shadcn', 'tailwindcss', 'cn', 'class-variance-authority', '@base-ui/react', ...(shared ? ['happy-dom'] : [])]);
  writeLockedManifest(root, directory, 'isolated-pi-chat-consumer', dependencies);
  run('npm', ['install', '--package-lock-only', ...npmInstallFlags(cache), ...archiveByName.values()]);
  run('npm', ['ci', ...npmInstallFlags(cache)]);

  ({ url: registry, server } = await serveRegistry(root, directory, closure, archiveByName, join(directory, 'packs'), cache, run));

  for (const path of ['src', 'dist']) mkdirSync(join(directory, path), { recursive: true });
  writeFileSync(join(directory, 'components.json'), JSON.stringify({ $schema: 'https://ui.shadcn.com/schema.json', style: 'base-nova', rsc: false, tsx: true, tailwind: { config: '', css: 'src/index.css', baseColor: '', cssVariables: true, prefix: '' },
    iconLibrary: 'lucide', aliases: { components: '@/components', utils: '@/lib/utils', ui: '@/components/ui', lib: '@/lib', hooks: '@/hooks' } }));
  writeFileSync(join(directory, 'src/index.css'), '@import "tailwindcss";\n');
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noUncheckedIndexedAccess: true, skipLibCheck: false,
    noEmit: true, types: [], lib: ['ES2023', 'DOM', 'DOM.Iterable'], baseUrl: '.', paths: { '@/*': ['./src/*'] } }, include: ['src/components/pi-chat/**/*.tsx', 'src/components/pi-chat/**/*.ts', 'src/components/shared-chat/**/*.tsx', 'src/components/shared-chat/**/*.ts', 'src/page.tsx'] }));
  const installer = { ...process.env, npm_config_cache: cache, npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  delete installer.NODE_OPTIONS;
  run(process.execPath, ['node_modules/shadcn/dist/index.js', 'add', `${registry}/${itemName}.json`, '--cwd', directory, '--yes'], installer);
  for (const [name, item] of closure) for (const file of item.files ?? []) assert.ok(existsSync(join(directory, 'src', file.target)), `the CLI must create ${file.target} (${name})`);
  for (const name of ['trace', 'collapsible']) assert.ok(existsSync(join(directory, `src/components/ui/${name}.tsx`)), `the CLI installs the declared ${name} built-in`);
  assert.ok(existsSync(join(directory, 'src/components/pi-chat/use-remote-chat.ts')), 'the moved hook is installed with pi-chat alone');
  if (!shared) {
    assert.equal(existsSync(join(directory, 'src/components/shared-chat')), false);
    assert.equal(existsSync(join(directory, 'src/components/pi-chat/shared.tsx')), false);
    assert.equal(existsSync(join(directory, 'src/components/pi-chat/use-shared-chat.ts')), false);
  }
  const blocks = 'node_modules/@hachej/boring-ui-kit/bin/boring-ui-blocks.mjs';
  run(process.execPath, [blocks, 'manifest']);
  run(process.execPath, [blocks, 'check']);

  // A consumer page: the moved hook and the chat, nothing from pi-app.
  writeFileSync(join(directory, 'src/page.tsx'), `import { createRoot } from 'react-dom/client';
import { PiChat } from './components/pi-chat/pi-chat';
import { useRemoteChat } from './components/pi-chat/use-remote-chat';
import type { NativeChatOptions } from '@hachej/boring-ui-kit/native-chat';
export const restoreOption = { restoreOnError: true } satisfies Pick<NativeChatOptions, 'restoreOnError'>;
// @ts-expect-error ChannelSource belongs only to the optional data entry.
import type { ChannelSource } from '@hachej/boring-ui-kit';
// @ts-expect-error The headless root has no channel factory.
import { createSharedChat } from '@hachej/boring-ui-kit';

const identity = { runtimeId: 'app', scopeId: 'fictional-team', principalId: 'fictional-person', initiatorId: 'fictional-person' };

export function App() {
  const chat = useRemoteChat({ conversationId: 'fictional', endpoint: id => new URL('/api/chat?conversation=' + id, location.href), fetch: request => fetch(request), identity });
  return chat.status === 'ready' ? <PiChat controller={chat.controller} actions={chat.actions} displayLimit={24} historicalMessageActions
    hideLine={line => line.startsWith('::meta ')} unread={reply => <span>{reply.entryId}</span>}
    replyError={reply => <span>Failed reply {reply.entryId}</span>}
    renderEntry={entry => entry.kind === 'fictional.stage' ? { inline: true, content: <span>Validated</span>, status: 'Validating…' } : undefined}
    messageActions={reply => [{ id: 'offer', label: 'Use fictional note', onSelect: () => { void reply.text; } }]}
    replyFooter={reply => <span>{reply.durationMs}</span>} /> : <p>{chat.status}</p>;
}
createRoot(document.getElementById('root')!).render(<App />);
`);
  if (shared) writeFileSync(join(directory, 'src/page.tsx'), `import { createRoot } from 'react-dom/client';
import { PiChat } from './components/pi-chat/pi-chat';
import { useSharedChat } from './components/shared-chat/shared-chat';
import { createFakeChannelSource } from '@hachej/boring-ui-kit/shared-chat';
export const fixture = createFakeChannelSource({ me: { id: 'mira', name: 'Mira', kind: 'person' }, members: [{ id: 'mira', name: 'Mira', kind: 'person' }, { id: 'leo', name: 'Leo', kind: 'person' }, { id: 'pm', name: 'PM', kind: 'agent' }], conversations: [{ id: 'main', title: 'Team', kind: 'main', members: ['mira', 'leo', 'pm'] }], messages: [{ id: 'hello', author: 'leo', at: '2026-10-20T10:00:00Z', conversationId: 'main', text: 'Hello team' }] });
export function App() { const chat = useSharedChat(fixture); return chat.chatProps ? <PiChat {...chat.chatProps} /> : <p>Connecting</p>; }
export const view = createRoot(document.getElementById('root')!); view.render(<App />);
`);
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'src/page.tsx', '--bundle', '--platform=browser', '--format=esm', '--jsx=automatic', '--outfile=dist/page.js', '--metafile=dist/meta.json',
    '--define:process.env.NODE_ENV="production"'], isolated);
  const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'dist/meta.json'), 'utf8')).inputs);
  if (shared) {
    assert.ok(inputs.some(path => path.endsWith('src/components/shared-chat/shared-chat.tsx')));
    writeFileSync(join(directory, 'drive.mjs'), readFileSync(join(root, 'scripts/fixtures/shared-chat-consumer-dom.mjs'), 'utf8'));
    run(process.execPath, ['drive.mjs'], isolated);
  } else {
    assert.ok(inputs.some(path => path.endsWith('src/components/pi-chat/use-remote-chat.ts')), 'the bundle uses the CLI-installed hook');
    assert.deepEqual(inputs.filter(path => /shared-chat|channel-source|channel-socket|channel-error|fake-channel/.test(path)), [], 'regular bundle excludes the optional feature and data entry');
  }
  assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
  assert.deepEqual(inputs.filter(path => /@hachej\/boring-agent|pi-durable\/dist\/(storage|env)|sqlite|node:/.test(path)), [], 'browser bundle holds no agent, storage or Node code');
  console.log(`PASS: real pinned shadcn installation of ${itemName} alone over HTTP with its ${closure.size - 1} registry dependencies, strict declarations of the copied chat and the moved hook, and a browser bundle; ${shared ? 'fictional DOM flow also executed (not live-service qualification)' : 'type and bundle evidence only'}`);
  completed = true;
} finally {
  server?.kill();
  if (completed) rmSync(directory, { recursive: true, force: true });
  else console.error('Retained failing disposable pi-chat consumer at ' + directory);
}
