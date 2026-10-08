import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runCaptured as spawnSync } from '../../scripts/run-captured.mjs';
import test from 'node:test';
import { npmInstallFlags } from '../../scripts/consumer-isolation.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function pack(name, target) {
  const metadata = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', target], join(root, 'packages', name)))[0];
  return join(target, metadata.filename);
}

for (const withResources of [false, true]) test(`actual packed UI installs/typechecks ${withResources ? 'with resource types' : 'headlessly'} without Pi or agent`, { timeout: 120000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-isolated-ui-'));
  try {
    const consumer = join(dir, 'consumer'); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'isolated-consumer', version: '1.0.0', private: true, type: 'module' }));
    const archives = [pack('ui', dir)]; if (withResources) archives.push(pack('files', dir));
    run('npm', ['install', ...npmInstallFlags(process.env.npm_config_cache ?? join(dir, 'npm-cache')), '--package-lock=false', ...archives], consumer);
    assert.deepEqual(readdirSync(join(consumer, 'node_modules')).filter(name => name !== '.package-lock.json').sort(), withResources ? ['@hachej', 'ignore'] : ['@hachej']);
    if (withResources) assert.equal(JSON.parse(readFileSync(join(consumer, 'node_modules/ignore/package.json'), 'utf8')).version, '5.3.2');
    assert.deepEqual(readdirSync(join(consumer, 'node_modules/@hachej')).sort(), withResources ? ['boring-files', 'boring-ui-kit'] : ['boring-ui-kit']);
    assert.equal(existsSync(join(consumer, 'node_modules/@earendil-works/pi-durable')), false);
    assert.equal(existsSync(join(consumer, 'node_modules/@hachej/boring-agent')), false);
    assert.equal(existsSync(join(consumer, 'node_modules/@hachej/boring-files')), withResources);
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      exactOptionalPropertyTypes: true, noEmit: true, types: [], skipLibCheck: false,
    }, include: ['consumer.ts'] }));
    const fixture = `import type { ViewerDescriptor, ViewerFeature, ViewerController, ViewerRenderer, PresentationCommand } from '@hachej/boring-ui-kit';
interface Descriptor extends ViewerDescriptor { readonly kind: 'inline'; readonly version: 1; readonly value: string }
declare const feature: ViewerFeature<Descriptor, ViewerController<string, {}, {}>>;
const controller = feature.createController({ kind: 'inline', version: 1, value: 'hello' });
const render: ViewerRenderer<typeof controller, string> = c => c.getSnapshot();
void render(controller);
declare const narrow: PresentationCommand<{ text: string }, void>;
// @ts-expect-error Contravariance prevents an unsafe broad registration.
const broad: PresentationCommand<unknown, void> = narrow;
void broad;
` + (withResources ? `import type { SaveSelection } from '@hachej/boring-ui-kit/resources';
const selection: SaveSelection = { target: { instanceId: 'i', epoch: 'e', subject: { scopeId: 'fictional-scope', base: { kind: 'absent', target: { resource: { providerId: 'docs', path: '/new' }, view: { kind: 'published' } } }, bufferVersion: 0 } } };
void selection;
` : '');
    writeFileSync(join(consumer, 'consumer.ts'), fixture);
    run(process.execPath, [tsc, '-p', join(consumer, 'tsconfig.json')], consumer);
    if (!withResources) {
      // Genuine negative control: restoring a method signature reintroduces
      // bivariance. The same consumer must fail with an unused expect-error.
      const declaration = join(consumer, 'node_modules/@hachej/boring-ui-kit/dist/contracts.d.ts');
      const original = readFileSync(declaration, 'utf8');
      const mutated = original.replace(/readonly invoke: \(([^;]+?)\) => Promise<PresentationResult<Output, Subject>>;/, 'invoke($1): Promise<PresentationResult<Output, Subject>>;');
      assert.notEqual(mutated, original, 'variance mutant did not match the built declaration');
      writeFileSync(declaration, mutated);
      const negative = spawnSync(process.execPath, [tsc, '-p', join(consumer, 'tsconfig.json')], { cwd: consumer, encoding: 'utf8', timeout: 30000 });
      assert.notEqual(negative.status, 0, 'bivariant command mutation should be detected');
      assert.match(negative.stdout + negative.stderr, /Unused '@ts-expect-error'/);
      writeFileSync(declaration, original);
      run(process.execPath, [tsc, '-p', join(consumer, 'tsconfig.json')], consumer);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
