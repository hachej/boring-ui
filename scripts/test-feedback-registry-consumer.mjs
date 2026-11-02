// Installed-recipe consumer for the `feedback` registry item: packs its @boring dependencies and those of its host items (pi-chat, utils:
// the registryDependencies, owner ruling 6), installs them with the pinned archives in a disposable app outside this repository, serves the
// items over HTTP as the @boring-ui namespace, runs the real pinned shadcn CLI, type-checks the copied source strictly, bundles
// it for the browser (no store, agent, source or Node code), and drives it in HappyDOM before and after a host restyle.
// Usage: npm run build && npm run registry:build && npm_config_cache=<cache> npm run test:feedback-registry-consumer
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { assertConsumerTypeFiles, prepareConsumerIsolation, npmInstallFlags } from './consumer-isolation.mjs';
import { addAppComponents, appComponents, appComponentsJson, consumerDependencies, packBoringDependencies, registryClosure, serveRegistry, writeLockedManifest } from './consumer-install.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const closure = registryClosure(root, 'feedback');
const item = closure.get('feedback');
// The host's packages (pi-chat's pi-durable, chord, pi-ai, marked) are installed with the feedback card now; the agent and editors never are.
const excludedPackages = ['@hachej/boring-agent', 'tldraw', '@tiptap/core'];
const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-consumer-'));
const cache = process.env.npm_config_cache;
assert.ok(cache, 'Set npm_config_cache to a writable npm cache (npm run sets it)');
function run(command, args, env) {
  const result = runCaptured(command, args, { cwd: directory, timeout: 180000, ...(env ? { env } : {}) });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.error?.message ?? result.signal ?? result.status}`);
  return result.stdout;
}

let completed = false, server, registry;
try {
  const isolated = prepareConsumerIsolation(directory);
  mkdirSync(join(directory, 'packs'));
  // One union of the closure's package pins: pack the @boring ones, lock the others to this repository's lock.
  const union = { dependencies: [...new Set([...closure.values()].flatMap(entry => entry.dependencies ?? []))] };
  const archiveByName = packBoringDependencies(root, union, join(directory, 'packs'), run);
  const dependencies = consumerDependencies(root, union, ['typescript', '@types/react', '@types/react-dom', 'happy-dom', 'esbuild', 'shadcn', 'tailwindcss', 'cn', 'class-variance-authority', '@base-ui/react']);
  writeLockedManifest(root, directory, 'isolated-feedback-consumer', dependencies);
  run('npm', ['install', '--package-lock-only', ...npmInstallFlags(cache), ...archiveByName.values()]);
  run('npm', ['ci', ...npmInstallFlags(cache)]);
  ({ url: registry, server } = await serveRegistry(root, directory, closure, archiveByName, join(directory, 'packs'), cache, run));
  for (const path of ['src', 'test/fixtures', 'dist']) mkdirSync(join(directory, path), { recursive: true });
  writeFileSync(join(directory, 'components.json'), appComponentsJson());
  writeFileSync(join(directory, 'src/index.css'), '@import "tailwindcss";\n');
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: true, noEmit: true, types: [], lib: ['ES2023', 'DOM', 'DOM.Iterable'], baseUrl: '.', paths: { '@/*': ['./src/*'] } }, include: ['src/**/*.tsx', 'src/**/*.ts', 'consumer.ts'] }));
  const installer = { ...process.env, npm_config_cache: cache, npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' };
  installer.NODE_OPTIONS = '--max-old-space-size=4096';
  addAppComponents(directory, appComponents(closure), installer, run);
  run(process.execPath, ['node_modules/shadcn/dist/index.js', 'add', `${registry}/feedback.json`, '--cwd', directory, '--yes'], installer);
  for (const name of excludedPackages) assert.equal(existsSync(join(directory, 'node_modules', name)), false, `${name} must not be installed`);
  for (const [name, entry] of closure) for (const file of entry.files ?? []) assert.ok(existsSync(join(directory, 'src', file.target)), `the CLI must create ${file.target} (${name})`);
  for (const name of ['trace', 'collapsible']) assert.ok(existsSync(join(directory, `src/components/ui/${name}.tsx`)), `the feedback host's app setup installs the ${name} component`);
  const css = readFileSync(join(directory, 'src/index.css'), 'utf8');
  assert.ok(css.includes('[data-boring="feedback"]'), 'scoped css merged into the host stylesheet');

  writeFileSync(join(directory, 'consumer.ts'), `import { createElement } from 'react';
import { AnnotateSheet, type AnnotateSheetProps } from './src/components/feedback/annotate-sheet';
import { FeedbackList } from './src/components/feedback/feedback-list';
import { FeedbackReport } from './src/components/feedback/feedback-report';
import { PointButton } from './src/components/feedback/point-button';
import { pickerOverlayStyles, usePickerOverlay } from './src/components/feedback/picker-overlay';
import { createAnnotation, type AnnotationCapture } from '@hachej/boring-feedback/ui';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
declare const capture: AnnotationCapture;
const props: AnnotateSheetProps = { annotation: createAnnotation({ capture }), onClose: () => {} };
createElement(AnnotateSheet, props);
createElement(FeedbackList, { items: [], protection: 'unprotected', onOpen: (id: string) => { void id; } });
createElement(PointButton, { root: () => null, policy: createPrivacyPolicy(), overlay: undefined, onPinned: elements => { void elements.length; } });
void FeedbackReport; void usePickerOverlay; const styles: string = pickerOverlayStyles; void styles;
`);
  writeFileSync(join(directory, 'feedback-entry.ts'), item.files.filter(file => file.target.endsWith('.tsx')).map(file => `export * from './src/${file.target.replace(/\.tsx$/, '')}';`).join('\n') + '\n');
  const compile = () => {
    assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
    run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'feedback-entry.ts', '--bundle', '--format=esm', '--jsx=automatic', '--platform=node', '--packages=external', '--outfile=dist/feedback.js'], isolated);
  };
  copyFileSync(join(root, 'test/fixtures/registry-feedback.mjs'), join(directory, 'test/fixtures/registry-feedback.mjs'));
  compile();
  run(process.execPath, ['--test', '--experimental-test-isolation=none', 'test/fixtures/registry-feedback.mjs'], isolated);

  // Restyle the copied source as a host would and repeat.
  const sheetPath = join(directory, 'src/components/feedback/annotate-sheet.tsx');
  const sheet = readFileSync(sheetPath, 'utf8');
  assert.ok(sheet.includes('className="boring-feedback-sheet"'));
  writeFileSync(sheetPath, sheet.replace('className="boring-feedback-sheet"', 'className="boring-feedback-sheet host-installed-feedback"'));
  writeFileSync(join(directory, 'src/index.css'), css + '\n.host-installed-feedback { --boring-feedback-radius: 1.25rem; }\n');
  compile();
  run(process.execPath, ['--test', '--experimental-test-isolation=none', 'test/fixtures/registry-feedback.mjs'], { ...isolated, BORING_REGISTRY_RESTYLED: 'true' });

  writeFileSync(join(directory, 'browser-entry.js'), "export * from './feedback-entry.ts';\nimport './src/index.css';\n");
  run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'browser-entry.js', '--bundle', '--platform=browser', '--format=esm', '--jsx=automatic', '--outfile=browser.js', '--metafile=browser-meta.json', '--conditions=style'], isolated);
  const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'browser-meta.json'), 'utf8')).inputs);
  assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
  assert.ok(inputs.some(path => path.endsWith('src/components/feedback/annotate-sheet.tsx')), 'the bundle uses the CLI-installed copy');
  assert.ok(inputs.some(path => path.includes('@hachej/boring-feedback/dist/page/')) && inputs.some(path => path.includes('@hachej/boring-feedback/dist/ui/')));
  assert.deepEqual(inputs.filter(path => /@hachej\/boring-feedback\/dist\/(store|agent|source)\/|@hachej\/boring-agent|@earendil-works|sqlite|node:/.test(path)), [], 'browser bundle holds no store, agent, source or server code');
  console.log('PASS: real pinned shadcn local installation of feedback, strict declarations, copied-source restyle, picker/sheet/list/report DOM operations and an annotation-only browser bundle; DOM and bundle evidence only');
  completed = true;
} finally {
  server?.kill();
  if (completed) rmSync(directory, { recursive: true, force: true });
  else console.error('Retained failing disposable feedback consumer at ' + directory);
}
