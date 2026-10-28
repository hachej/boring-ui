// Installed-block consumer for the `pi-app` registry item: a disposable app outside this repository installs pi-app with the real pinned
// shadcn CLI over HTTP (the release's absolute registry dependency URLs served by a local registry, so pi-chat, pi-workspace, viewers,
// utils, button and theme resolve as they would from a hosted one), with every package pinned to an integrity-checked archive. It then
// type-checks the copied source and a consumer page strictly (unused locals and parameters, verbatim imports, erasable syntax only) and bundles the page for the browser (no kernel, server or Node code).
// Usage: npm run build && npm run registry:build && npm_config_cache=<cache> npm run test:app-registry-consumer
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { assertConsumerTypeFiles, prepareConsumerIsolation, npmInstallFlags } from './consumer-isolation.mjs';
import { addAppComponents, appComponentsJson, consumerDependencies, packBoringDependencies, registryItemName, serveRegistry, writeLockedManifest } from './consumer-install.mjs';
import { SHADCN_BUILTINS } from './check-registry-blocks.mjs';
import { createServer } from 'node:http';
import { launch, q } from '@hachej/boring-testing/browser';
import { fictionalPdf } from '../test/fixtures/fictional-pdf.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => JSON.parse(readFileSync(join(root, 'public/r', `${name}.json`), 'utf8'));
// The block and every item it needs, through registryDependencies.
const closure = new Map();
const visit = name => { if (closure.has(name)) return; const item = read(name); closure.set(name, item); for (const dependency of item.registryDependencies ?? []) visit(registryItemName(root, dependency)); };
visit('pi-app');
// The default kinds and their viewers: pi-app itself installs none.
visit('pi-app-kinds');
// The app shell too: a strict regression in the shell fails here, not only in the monorepo fixture check.
visit('app-shell');
visit('file-tree');
// The documents screen: its Library, revisions and sheet, installed and checked strictly with the rest of the closure.
visit('documents');
visit('highlights');
visit('task-board');
visit('task-mentions');
// The kit's tokens, which this token-less app installs once in its setup; no block depends on them.
visit('theme');
const styles = [process.env.BORING_CONSUMER_STYLE ?? 'base-nova'];
assert.ok(styles.every(style => style === 'base-nova'), 'Registry blocks require the shadcn Base UI style');
const cache = process.env.npm_config_cache;
assert.ok(cache, 'Set npm_config_cache to a writable npm cache (npm run sets it)');

async function testStyle(style) {
  const directory = mkdtempSync(join(tmpdir(), `boring-app-consumer-${style}-`));
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
    // One union of the closure's package pins: pack the @boring ones, lock the others to this repository's lock.
    const pins = [...new Set([...closure.values()].flatMap(item => item.dependencies ?? []))];
    const union = { dependencies: pins };
    const archiveByName = packBoringDependencies(root, union, join(directory, 'packs'), run);
    const dependencies = consumerDependencies(root, union, ['typescript', '@types/react', '@types/react-dom', 'esbuild', 'shadcn', 'tailwindcss', 'happy-dom']);
    // The consumer's real Base UI Button, sidebar, Trace and dropdown built-ins import class-variance-authority and cn.
    const lockedVersion = name => { const entry = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages[`node_modules/${name}`]; assert.ok(entry?.version, `${name} is locked`); return entry.version; };
    for (const name of ['class-variance-authority', 'cn']) dependencies[name] = lockedVersion(name);
    writeLockedManifest(root, directory, 'isolated-app-consumer', dependencies);
    run('npm', ['install', '--package-lock-only', ...npmInstallFlags(cache), ...archiveByName.values()]);
    run('npm', ['ci', ...npmInstallFlags(cache)]);

    // The local registry: every item of the closure with its pins pointed at the checked archives, served over HTTP by a child process.
    ({ url: registry, server } = await serveRegistry(root, directory, closure, archiveByName, join(directory, 'packs'), cache, run));

    for (const path of ['src', 'dist']) mkdirSync(join(directory, path), { recursive: true });
    // The app keeps its shadcn components somewhere other than the default: blocks must follow its ui alias, not a path of their own.
    writeFileSync(join(directory, 'components.json'), appComponentsJson({ style, ui: '@/shadcn/ui' }));
    writeFileSync(join(directory, 'src/index.css'), '@import "tailwindcss";\n');
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noUnusedLocals: true, noUnusedParameters: true, verbatimModuleSyntax: true, erasableSyntaxOnly: true, noUncheckedIndexedAccess: true, skipLibCheck: false,
      noEmit: true, types: [], lib: ['ES2023', 'DOM', 'DOM.Iterable'], baseUrl: '.', paths: { '@/*': ['./src/*'] } }, include: ['src/components/pi-app/**/*.tsx', 'src/components/pi-app/**/*.ts', 'src/components/pi-app-kinds/**/*.ts', 'src/components/app-shell/**/*.tsx', 'src/components/app-shell/**/*.ts', 'src/components/documents/**/*.tsx', 'src/components/documents/**/*.ts', 'src/components/task-board/**/*.tsx', 'src/components/task-mentions/**/*.tsx', 'src/page.tsx', 'src/pdf-check.tsx', 'src/local-file-check.tsx'] }));
    const installer = { ...process.env, npm_config_cache: cache, npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
    delete installer.NODE_OPTIONS;
    // The documented app setup (registry/README.md, APP_SETUP), then the blocks, which declare no shadcn component of their own.
    addAppComponents(directory, [...SHADCN_BUILTINS], installer, run);
    run(process.execPath, ['node_modules/shadcn/dist/index.js', 'add', `${registry}/theme.json`, '--cwd', directory, '--yes'], installer);
    run(process.execPath, ['node_modules/shadcn/dist/index.js', 'add', `${registry}/pi-app.json`, `${registry}/pi-app-kinds.json`, `${registry}/file-tree.json`, `${registry}/app-shell.json`, `${registry}/documents.json`, `${registry}/highlights.json`, `${registry}/task-board.json`, `${registry}/task-mentions.json`, '--cwd', directory, '--yes'], installer);
    for (const [name, item] of closure) for (const file of item.files ?? []) {
      assert.ok(existsSync(join(directory, 'src', file.target)), `the CLI must create ${file.target} (${name})`);
      const text = readFileSync(join(directory, 'src', file.target), 'utf8');
      assert.ok(!text.includes('@/components/ui/'), `${file.target} must import shadcn through the app's ui alias`);
      if (file.content?.includes('@/components/ui/')) assert.ok(text.includes('@/shadcn/ui/'), `${file.target} imports the app's components from @/shadcn/ui`);
    }
    for (const name of SHADCN_BUILTINS) assert.ok(existsSync(join(directory, `src/shadcn/ui/${name}.tsx`)), `the app setup installs ${name} under the ui alias`);
    const css = readFileSync(join(directory, 'src/index.css'), 'utf8');
    assert.ok(css.includes('--background') && css.includes('.pi-chat'), 'theme tokens and the chat\'s scoped css merged into the host stylesheet');

    // Check the documented browser-only panel against the actual installed blocks, not monorepo aliases.
    const localExample = readFileSync(join(root, 'registry/README.md'), 'utf8').split('#### Custom artifacts and a dropped PDF in one app')[1]?.match(/```tsx\n([\s\S]*?)\n```/)?.[1];
    assert.ok(localExample, 'the LocalFileViewer workspace example exists');
    writeFileSync(join(directory, 'src/local-file-check.tsx'), localExample);
    // A consumer page: only the block, its hooks and the host's own routes.
    writeFileSync(join(directory, 'src/page.tsx'), `export { ReportWorkspace } from './local-file-check';
  export { Highlights } from './components/highlights/highlights';
  export { taskMentions } from './components/task-mentions/task-mentions';
  import { TaskBoard, TaskRequestCard, TaskStatusChip } from './components/task-board/task-board';
  import type { TaskRecord } from '@hachej/boring-ui-kit/task-board';
  export function OwnRequests({ tasks }: { readonly tasks: readonly TaskRecord[] }) {
    return <><TaskBoard tasks={tasks} filter="mine" currentUser="fictional-person" limit={2} variant="compact" />
      {tasks[0] && <><TaskRequestCard task={tasks[0]} actions={<button>Confirm</button>} /><TaskStatusChip task={tasks[0]} /></>}</>;
  }
  import { useEffect, useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AgentWorkspace, useConversations, useRemoteChat } from './components/pi-app/agent-workspace';
  import { defaultKinds } from './components/pi-app-kinds/pi-app-kinds';
  import type { OpenedView } from './components/pi-app/agent-workspace';
  import type { BlockAction, ChatLabels, ConversationsConfig } from './components/pi-chat/pi-chat';
  import { HistoryColumnToggle, useHistoryColumn } from './components/pi-app/agent-workspace';
  import { DownloadIcon } from 'lucide-react';
  import { FileTree } from './components/file-tree/file-tree';
  import { Documents } from './components/documents/documents';
  import { DocumentSheet } from './components/documents/document-sheet';
  import type { RevisionProvider } from '@hachej/boring-files/revision';

  export function BoundWorkspace({ revisionProvider }: { readonly revisionProvider: RevisionProvider }) {
    return <><AgentWorkspace revisionProvider={revisionProvider} controller={undefined} conversationId={undefined} history="popover" /><FileTree revisionProvider={revisionProvider} />
    <Documents provider={revisionProvider} locale="fr" /><DocumentSheet provider={revisionProvider} path={undefined} onClose={() => {}} onShowAll={() => {}} />
      <AgentWorkspace revisionProvider={revisionProvider} chat={{ showHistory: false, showConnectionStatus: false, tools: <button type="button">Mic</button> }} libraryPlacement="pane" locale="fr" fileTree={{ labels: { search: 'Rechercher' }, upload: false, history: false, refreshKey: 1 }} onUnsavedChange={unsaved => { void unsaved; }} controller={undefined} conversationId={undefined}
        agents={{ items: [{ id: 'pm', label: 'PM' }, { id: 'dev', label: 'Developer' }], activeId: 'pm', onSelect: () => {} }} /></>;
  }

  // A hand-built agent pane gets the same History column: the column at its start, History as its toggle, the popover where it does not fit.
  export function HistoryPane({ conversations, floating }: { readonly conversations: ConversationsConfig | undefined; readonly floating: boolean }) {
    const history = useHistoryColumn({ id: 'pane-history', storageKey: 'consumer.history-column', conversations, enabled: !floating, beside: 0, title: 'Conversations' });
    return <div ref={history.ref} className="flex min-h-0 flex-1">{history.column}{history.toggle ? <HistoryColumnToggle toggle={history.toggle} /> : null}</div>;
  }

  const identity = { runtimeId: 'app', scopeId: 'fictional-team', principalId: 'fictional-person', initiatorId: 'fictional-person' };
  const at = (path: string) => new URL(path, location.href);
  const resources = { endpoint: at('/api/resources'), history: at('/api/history'), fetch: (request: Request) => fetch(request), identity };

  // The configurable surface, checked strictly: partial labels (a function among them), a host icon, actions on each surface.
  const SparkIcon = ({ className }: { readonly className?: string | undefined }) => <svg className={className} viewBox="0 0 16 16" />;
  const chatLabels: Partial<ChatLabels> = { title: 'Writer', placeholder: 'Ask anything…', noMatch: query => 'Nothing for ' + query };
  const kinds = defaultKinds({ locale: 'fr' });
  const exportChat: BlockAction = { id: 'export', label: 'Export chat', icon: DownloadIcon, onSelect: () => {} };

  export function App() {
    const [selected, setSelected] = useState<string>();
    const [opened, setOpened] = useState<OpenedView | null>(null);
    const conversations = useConversations({ endpoint: at('/api/conversations'), fetch: request => fetch(request), activeId: selected, onSelect: setSelected });
    const items = conversations?.items;
    useEffect(() => { if (items?.length && !items.some(item => item.id === selected)) setSelected(items[0]!.id); }, [items, selected]);
    const chat = useRemoteChat({ conversationId: selected, endpoint: id => at('/api/chat?conversation=' + id), fetch: request => fetch(request), identity });
    return <AgentWorkspace artifactKinds={kinds} conversationId={selected} controller={chat.status === 'ready' ? chat.controller : undefined} resources={resources}
      conversations={conversations && { ...conversations, rowActions: item => [{ id: 'star', label: 'Star ' + (item.title ?? ''), placement: 'menu', onSelect: () => {} }] }}
      labels={{ sessionsTitle: 'Projects', share: 'Send a link' }} icons={{ newChat: SparkIcon }} panelActions={view => view.kind === 'artifact' ? [exportChat] : []}
      opened={opened} onOpenedChange={setOpened} connecting={<p>Connecting…</p>}
      chat={{ labels: chatLabels, icons: { send: SparkIcon }, headerActions: [exportChat], messageActions: reply => [{ id: 'quote', label: 'Quote ' + reply.key, onSelect: () => {} }], ...(chat.status === 'ready' ? { actions: chat.actions } : {}) }} />;
  }
  createRoot(document.getElementById('root')!).render(<App />);
  `);
    // The consumer's own shadcn scroll-area ships an unused `import * as React`, which this strict consumer (noUnusedLocals) rejects. That file is
    // host-owned, not ours: drop the import as the consumer's linter autofix would, and keep the strictness for every block file.
    const scrollArea = join(directory, 'src/shadcn/ui/scroll-area.tsx');
    if (existsSync(scrollArea) && !/\bReact\./.test(readFileSync(scrollArea, 'utf8'))) writeFileSync(scrollArea, readFileSync(scrollArea, 'utf8').replace(/^import \* as React from ["']react["']\n/m, ''));
    // The installed PDF viewer as a phone sees it (no browser viewer): pdf.js and its worker come from the consumer's own install.
    const pdfBase64 = Buffer.from(fictionalPdf([['Cedar Works', 'A fictional picnic plan.'], ['Page two', 'Pack some sandwiches.']])).toString('base64');
    writeFileSync(join(directory, 'src/pdf-check.tsx'), `import { createRoot } from 'react-dom/client';
  import { PdfPane } from './components/viewer-pdf/pdf-pane';
  import { LocalFileViewer } from './components/viewer-pdf/local-file-viewer';
  const bytes = Uint8Array.from(atob('${pdfBase64}'), character => character.charCodeAt(0));
  const local = location.search === '?local';
  if (local) Object.defineProperty(navigator, 'pdfViewerEnabled', { value: false });
  const file = new File([bytes], 'compte-rendu-fictif.pdf', { type: 'application/pdf' });
  createRoot(document.getElementById('root')!).render(<div className="boring-viewer" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>{local ? <LocalFileViewer name={file.name} blob={file} /> : <PdfPane name="Cedar Works.pdf" bytes={bytes} inline={false} />}</div>);
  `);
    assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
    run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'src/page.tsx', '--bundle', '--platform=browser', '--format=esm', '--jsx=automatic', '--outfile=dist/page.js', '--metafile=dist/meta.json',
      '--define:process.env.NODE_ENV="production"', '--alias:@=./src'], isolated);
    const bundledCss = readFileSync(join(directory, 'dist/page.css'), 'utf8');
    assert.ok(bundledCss.includes('file-tree-row-button') && bundledCss.includes('file-tree'), 'portable tree styles ship without scanning package internals');
    const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'dist/meta.json'), 'utf8')).inputs);
    assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
    for (const file of ['file-tree/file-tree.tsx', 'pi-app/agent-workspace.tsx', 'pi-app/artifact-panel.tsx', 'pi-app/file-viewer.tsx', 'pi-app/sessions.tsx', 'pi-chat/pi-chat.tsx', 'pi-workspace/workspace.tsx', 'viewer-frame/viewer-frame.tsx', 'viewer-pdf/local-file-viewer.tsx', 'documents/documents.tsx', 'documents/document-sheet.tsx', 'highlights/highlights.tsx'])
      assert.ok(inputs.some(path => path.endsWith(`src/components/${file}`)), `the bundle uses the CLI-installed ${file}`);
    assert.deepEqual(inputs.filter(path => /@hachej\/boring-agent|pi-durable\/dist\/(storage|env)|sqlite|node:|tldraw/.test(path)), [], 'browser bundle holds no agent, storage, Node or canvas code');
    // D-257 step 4: bundled with code splitting, as the app's bundler does, the installed views sit in chunks the page reaches only by a
    // kind's dynamic import. (The page's own LocalFileViewer example imports the image and PDF panes directly, and Highlights the Markdown editor.)
    run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'src/page.tsx', '--bundle', '--splitting', '--platform=browser', '--format=esm', '--jsx=automatic', '--outdir=dist/split', '--metafile=dist/split-meta.json',
      '--define:process.env.NODE_ENV="production"', '--alias:@=./src'], isolated);
    const split = JSON.parse(readFileSync(join(directory, 'dist/split-meta.json'), 'utf8')).outputs;
    const entry = Object.keys(split).find(path => split[path].entryPoint === 'src/page.tsx');
    const eager = new Set([entry]);
    for (const path of eager) for (const edge of split[path].imports) if (edge.kind === 'import-statement' && !edge.external) eager.add(edge.path);
    const lazyViews = /src\/components\/(viewer-markdown\/markdown-pane|viewer-html\/html-pane|viewer-code\/(svg-view|csv-table)|maquette-viewer\/maquette-viewer|diagram-viewer\/diagram-viewer|mockup-viewer\/mockup-viewer|record-viewer\/record-viewer)\.tsx$/;
    assert.deepEqual([...eager].flatMap(path => Object.keys(split[path].inputs)).filter(path => lazyViews.test(path)), [], 'the page loads no view up front');
    assert.ok(Object.values(split).some(output => Object.keys(output.inputs).some(path => path.endsWith('src/components/viewer-markdown/markdown-pane.tsx'))), 'the Markdown view is bundled in a chunk of its own');
    run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'src/pdf-check.tsx', '--bundle', '--platform=browser', '--format=esm', '--jsx=automatic', '--outfile=dist/pdf-check.js',
      '--define:process.env.NODE_ENV="production"', '--alias:@=./src'], isolated);
    await assertInstalledPdfWorker(directory);
    // Keep the DOM setup outside the component bundle: public Base UI modules must initialize in that DOM realm.
    writeFileSync(join(directory, 'presentation-components.tsx'), "export { ViewerActions, ViewerVersions } from './src/components/viewer-frame/menu';\nexport { ConversationFiles } from './src/components/pi-chat/conversation-files';\nexport { FileTree } from './src/components/file-tree/file-tree';\nexport { HistoryColumnToggle, useHistoryColumn } from './src/components/pi-app/history-column';\n");
    writeFileSync(join(directory, 'dist/presentation.mjs'), readFileSync(join(root, 'test/fixtures/app-registry-presentation.mjs'), 'utf8'));
    run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'presentation-components.tsx', '--bundle', '--platform=node', '--format=esm', '--packages=external', '--jsx=automatic', '--outfile=dist/presentation-components.mjs', '--alias:@=./src', '--alias:@hachej/boring-ui-kit/file-tree.css=./node_modules/@hachej/boring-ui-kit/styles/file-tree.css'], isolated);
    run(process.execPath, ['dist/presentation.mjs'], isolated);
    console.log(`PASS (${style}): real pinned shadcn installation of pi-app over HTTP with its ${closure.size - 1} registry dependencies, strict declarations, browser bundle, installed menu/drawer DOM behavior and the installed PDF viewer drawing pages through its pdf.js worker in Chromium; not browser geometry or gesture evidence`);
    completed = true;
  } finally {
    server?.kill();
    if (completed) rmSync(directory, { recursive: true, force: true });
    else console.error('Retained failing disposable app consumer at ' + directory);
  }
}

/**
 * Serves the consumer's page bundle and, at the URL its `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` resolves to,
 * the worker from the consumer's own node_modules (what a host whose bundler leaves that URL as is does; Vite and webpack emit it).
 * Chromium then draws both pages through that worker, proving the installed block, its pinned pdf.js and the worker fit together.
 */
async function assertInstalledPdfWorker(directory) {
  const worker = readFileSync(join(directory, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'));
  assert.equal(JSON.parse(readFileSync(join(directory, 'node_modules/pdfjs-dist/package.json'), 'utf8')).version, JSON.parse(readFileSync(join(root, 'ARCHITECTURE.json'), 'utf8')).rootDevDependencies['pdfjs-dist']);
  const routes = { '/': ['text/html', '<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script type="module" src="/pdf-check.js"></script>'],
    '/pdf-check.js': ['text/javascript', readFileSync(join(directory, 'dist/pdf-check.js'))], '/pdfjs-dist/build/pdf.worker.min.mjs': ['text/javascript', worker] };
  let workerLoads = 0;
  const server = createServer((request, response) => {
    const route = routes[new URL(request.url, 'http://x').pathname];
    if (request.url === '/pdfjs-dist/build/pdf.worker.min.mjs') workerLoads++;
    if (route) response.writeHead(200, { 'content-type': route[0] }).end(route[1]); else response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await launch('about:blank', { evidence: directory });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1800, deviceScaleFactor: 2, mobile: true });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    const pages = `Array.from(document.querySelectorAll('[data-testid=viewer-pdf-page]'))`;
    await browser.until('the installed viewer draws both pages', `${pages}.length === 2 && ${pages}.every(page => page.dataset.rendered)`, 30000);
    const sizes = await browser.evaluate(`${pages}.map(page => [page.querySelector('canvas').width, page.querySelector('canvas').height])`);
    assert.ok(sizes.every(([width, height]) => width > 0 && height > width), JSON.stringify(sizes));
    assert.equal(await browser.evaluate(`${q('[data-testid=viewer-pdf-page-indicator]')}.textContent`), '1 / 2');
    assert.equal(workerLoads, 1, 'pdf.js ran in its own worker from the consumer install');
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?local` });
    await browser.until('the installed LocalFileViewer draws a browser-only File', `${q('[data-testid=viewer-title]')}?.textContent === 'compte-rendu-fictif.pdf' && ${pages}.length === 2 && ${pages}.every(page => page.dataset.rendered)`, 30000);
    const localSizes = await browser.evaluate(`${pages}.map(page => [page.querySelector('canvas').width, page.querySelector('canvas').height])`);
    assert.ok(localSizes.every(([width, height]) => width > 0 && height > width), JSON.stringify(localSizes));
    assert.equal(workerLoads, 2, 'the local File also uses the installed PDF worker');
    assert.deepEqual(browser.problems, [], 'no browser console errors');
  } finally { await browser?.close(); server.close(); }
}

for (const style of styles) await testStyle(style);
