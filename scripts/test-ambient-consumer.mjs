// Installs the real ambient recipe and packed kit outside the repo; strict source types and browser dependency isolation.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { assertConsumerTypeFiles, prepareConsumerIsolation, npmInstallFlags } from './consumer-isolation.mjs';
import { addAppComponents, appComponents, appComponentsJson, consumerDependencies, packBoringDependencies, registryClosure, serveRegistry, writeLockedManifest } from './consumer-install.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'boring-ambient-consumer-'));
const closure = registryClosure(root, 'pi-ambient');
const cache = process.env.npm_config_cache;
assert.ok(cache, 'Set npm_config_cache to a writable npm cache');
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
  const union = { dependencies: [...new Set([...closure.values()].flatMap(item => item.dependencies ?? []))] };
  const archives = packBoringDependencies(root, union, join(directory, 'packs'), run);
  const dependencies = consumerDependencies(root, union, ['typescript', '@types/react', '@types/react-dom', 'esbuild', 'shadcn', 'tailwindcss', 'cn', 'class-variance-authority', '@base-ui/react']);
  writeLockedManifest(root, directory, 'isolated-ambient-consumer', dependencies);
  run('npm', ['install', '--package-lock-only', ...npmInstallFlags(cache), ...archives.values()]);
  run('npm', ['ci', ...npmInstallFlags(cache)]);
  const registry = await serveRegistry(root, directory, closure, archives, join(directory, 'packs'), cache, run);
  server = registry.server;
  mkdirSync(join(directory, 'src'), { recursive: true });
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noUncheckedIndexedAccess: true, skipLibCheck: false, noEmit: true, types: [], lib: ['ES2023', 'DOM', 'DOM.Iterable'], baseUrl: '.', paths: { '@/*': ['./src/*'] } }, include: ['src'] }));
  writeFileSync(join(directory, 'components.json'), appComponentsJson());
  writeFileSync(join(directory, 'src/index.css'), '@import "tailwindcss";\n');
  const installer = { ...process.env, npm_config_cache: cache, npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  delete installer.NODE_OPTIONS;
  addAppComponents(directory, appComponents(closure), installer, run);
  run(process.execPath, ['node_modules/shadcn/dist/index.js', 'add', `${registry.url}/pi-ambient.json`, '--cwd', directory, '--yes'], installer);
  writeFileSync(join(directory, 'src/page.tsx'), `import { AmbientChat, createNotificationStore, watchConversation, frenchNotificationLabels } from './components/pi-ambient/ambient';
import { useRunNotifications } from '@hachej/boring-ui-kit/chat-react';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
export const store = createNotificationStore();
export const watch = (controller: NativeChatController) => watchConversation(controller, store, { conversationId: 'fictional', title: 'Fictional harbour', labels: frenchNotificationLabels });
export function App({ controller }: { controller: NativeChatController }) {
  useRunNotifications(controller, store, { conversationId: 'other', title: 'Other', question: () => 'Fictional question' });
  return <AmbientChat controller={controller} notifications={store} labels={frenchNotificationLabels} />;
}
`);
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'src/page.tsx', '--bundle', '--platform=browser', '--format=esm', '--jsx=automatic', '--outfile=dist/page.js', '--metafile=dist/meta.json'], isolated);
  const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'dist/meta.json'), 'utf8')).inputs);
  assert.ok(inputs.some(path => path.endsWith('/dist/run-notifications.js')), 'the installed ambient source uses the packed kit state machine');
  assert.deepEqual(inputs.filter(path => /@hachej\/boring-agent|pi-durable\/dist\/(storage|env)|sqlite|node:/.test(path)), [], 'browser bundle carries no native kernel or server modules');
  assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
  console.log('PASS: installed ambient recipe, public notification hook, strict declarations and browser bundle isolation');
  completed = true;
} finally {
  server?.kill();
  if (completed) rmSync(directory, { recursive: true, force: true });
  else console.error(`Retained failing isolated ambient consumer: ${directory}`);
}
