import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { runCaptured as spawnSync } from '../../scripts/run-captured.mjs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { npmInstallFlags } from '../../scripts/consumer-isolation.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc');
function run(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
}

test('registered editors retain flush/custom methods in a real packed consumer; erasure mutant fails', { timeout: 120000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-feature-preservation-'));
  try {
    const consumer = join(dir, 'consumer'); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'editor-consumer', version: '1.0.0', type: 'module', private: true }));
    const archives = ['files', 'ui'].map(name => {
      const [info] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dir], join(root, 'packages', name)));
      return join(dir, info.filename);
    });
    run('npm', ['install', ...npmInstallFlags(process.env.npm_config_cache ?? join(dir, 'npm-cache')), '--package-lock=false', ...archives], consumer);
    assert.deepEqual(readdirSync(join(consumer, 'node_modules')).filter(name => name !== '.package-lock.json'), ['@hachej']);
    assert.deepEqual(readdirSync(join(consumer, 'node_modules/@hachej')).sort(), ['boring-files', 'boring-ui-kit']);
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, types: [], skipLibCheck: false }, include: ['consumer.ts'] }));
    writeFileSync(join(consumer, 'consumer.ts'), `import type { ViewerDescriptor, ViewerFeature, ViewerRenderer } from '@hachej/boring-ui-kit';
import type { EditableViewerController, SaveSelection } from '@hachej/boring-ui-kit/resources';
interface Descriptor extends ViewerDescriptor { readonly kind: 'document'; readonly version: 1; readonly key: string }
interface Editor extends EditableViewerController<{ readonly text: string }, {}, {}> {
  readonly focusHeading: (text: string) => void;
}
declare const feature: ViewerFeature<Descriptor, Editor>;
const editor = feature.createController({kind:'document', version:1, key:'note'});
declare const selection: SaveSelection;
void editor.flush(selection);
editor.focusHeading('Acceptance');
const render: ViewerRenderer<Editor, string> = c => c.getSnapshot().text;
render(editor);
`);
    const check = () => spawnSync(process.execPath, [compiler, '-p', join(consumer, 'tsconfig.json')], { cwd: consumer, encoding: 'utf8', timeout: 30000 });
    const positive = check(); assert.equal(positive.status, 0, positive.stdout + positive.stderr);
    const declaration = join(consumer, 'node_modules/@hachej/boring-ui-kit/dist/contracts.d.ts');
    const before = readFileSync(declaration, 'utf8');
    const mutant = before.replace('(descriptor: Descriptor) => Controller;', '(descriptor: Descriptor) => ViewerController<unknown, unknown, unknown>;');
    assert.notEqual(mutant, before, 'controller-erasure mutant must modify the actual declaration');
    writeFileSync(declaration, mutant);
    const negative = check();
    assert.notEqual(negative.status, 0);
    assert.match(negative.stdout + negative.stderr, /Property 'flush' does not exist/);
    writeFileSync(declaration, before);
    const restored = check(); assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
