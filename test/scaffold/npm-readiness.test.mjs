import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPackage, checkShippedRegistry } from '../../scripts/check-npm-packages.mjs';
import { kitVersion, releaseItemBase } from '../../scripts/build-registry.mjs';
import { localRegistryDependencies, registryItemName } from '../../scripts/consumer-install.mjs';

const manifest = {
  name: '@hachej/boring-example', version: '0.1.0', private: false, license: 'MIT',
  repository: { url: 'git+https://github.com/hachej/boring-ui.git', directory: 'packages/example' },
  engines: { node: '>=22.19.0' },
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
  exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
};
const files = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'];

test('packing readiness is distinct from publication readiness', () => {
  assert.deepEqual(checkPackage(manifest, files, new Map(), { release: true }), []);
  const pending = { ...manifest, private: true, version: '0.0.0' };
  assert.deepEqual(checkPackage(pending, files, new Map()), []);
  assert.deepEqual(checkPackage(pending, files, new Map(), { release: true }), [
    'Publication remains disabled: private must explicitly be false',
    'Choose a release version before publication',
  ]);
});

test('tarball audit rejects missing declarations, license and leaked build state', () => {
  assert.deepEqual(checkPackage(manifest, files.filter(file => !file.endsWith('.d.ts') && file !== 'LICENSE').concat('dist/build.tsbuildinfo', '.env'), new Map()), [
    'Missing LICENSE',
    'Unexpected packed file: dist/build.tsbuildinfo',
    'Unexpected packed file: .env',
    'Missing or invalid export target: ./dist/index.d.ts',
  ]);
});

test('release dependencies cannot point into a checkout or to old sibling versions', () => {
  const candidate = { ...manifest, peerDependencies: { '@hachej/boring-files': '0.0.0', local: 'file:../local' } };
  assert.deepEqual(checkPackage(candidate, files, new Map([['@hachej/boring-files', '0.1.0']])), [
    'Internal version mismatch: @hachej/boring-files@0.0.0',
    'Local dependency: local',
  ]);
  const versions = new Map([['@hachej/boring-files', '0.1.0']]);
  assert.deepEqual(checkPackage({ ...manifest, peerDependencies: { '@hachej/boring-files': '^0.1.0' } }, files, versions), []);
  assert.deepEqual(checkPackage({ ...manifest, peerDependencies: { '@hachej/boring-files': '0.1.0' } }, files, versions), [
    'Internal version mismatch: @hachej/boring-files@0.1.0',
  ], 'internal peers must be caret ranges, not exact');
  assert.deepEqual(checkPackage({ ...manifest, peerDependencies: { '@hachej/boring-files': '^0.2.0' } }, files, versions), [
    'Internal version mismatch: @hachej/boring-files@^0.2.0',
  ]);
  assert.deepEqual(checkPackage({ ...manifest, private: true, dependencies: { '@hachej/boring-files': '0.1.0' } }, files, versions), [], 'private packages may pin internal packages exactly');
  assert.deepEqual(checkPackage({ ...manifest, private: true, dependencies: { '@hachej/boring-files': '^0.2.0' } }, files, versions), [
    'Internal version mismatch: @hachej/boring-files@^0.2.0',
  ]);
});

test('missing build output cannot pass the pack audit', () => {
  assert.deepEqual(checkPackage(manifest, ['package.json', 'README.md', 'LICENSE'], new Map()), [
    'Missing or invalid export target: ./dist/index.js',
    'Missing or invalid export target: ./dist/index.d.ts',
  ]);
});

test('bare local dependency paths cannot pass release audit', () => {
  for (const version of ['../local', './local', '/tmp/local', '~/local', 'C:\\local', 'local.tgz']) {
    assert.deepEqual(checkPackage({ ...manifest, dependencies: { local: version } }, files, new Map(), { release: true }), ['Local dependency: local'], version);
  }
});

test('UI may ship its declared tree stylesheet without admitting arbitrary assets', () => {
  const ui = { ...manifest, name: '@hachej/boring-ui-kit', exports: { ...manifest.exports, './file-tree.css': './styles/file-tree.css' } };
  const packed = [...files, 'THIRD_PARTY_NOTICES.md', 'styles/file-tree.css'];
  assert.deepEqual(checkPackage(ui, packed, new Map()), []);
  assert.deepEqual(checkPackage({ ...ui, exports: { './file-tree.css': 'xxstyles/file-tree.css' } }, packed, new Map()), ['Missing or invalid export target: xxstyles/file-tree.css']);
  assert.deepEqual(checkPackage(ui, [...packed, 'styles/private.json'], new Map()), ['Unexpected packed file: styles/private.json']);
  assert.deepEqual(checkPackage(ui, packed.filter(path => !path.endsWith('.css')), new Map()), ['Missing or invalid export target: ./styles/file-tree.css']);
  assert.ok(checkPackage({ ...ui, name: manifest.name }, packed, new Map()).includes('Unexpected packed file: styles/file-tree.css'));
});

test('UI archive ships the shadcn registry under r/ and nothing else may', () => {
  const ui = { ...manifest, name: '@hachej/boring-ui-kit', version: '0.2.2' };
  const packed = [...files, 'THIRD_PARTY_NOTICES.md', 'r/registry.json', 'r/theme.json', 'r/button.json'];
  const items = { registry: { items: [{ name: 'theme' }, { name: 'button' }] }, theme: { dependencies: ['@hachej/boring-ui-kit@^0.2.2'], registryDependencies: [] }, button: { dependencies: ['react@19.3.0'], registryDependencies: ['https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@0.2.2/r/theme.json'] } };
  const read = path => structuredClone(items[path.slice(2, -5)]);
  assert.deepEqual(checkPackage(ui, packed, new Map()), []);
  assert.deepEqual(checkPackage(manifest, [...files, 'r/theme.json'], new Map()), ['Unexpected packed file: r/theme.json']);
  assert.deepEqual(checkShippedRegistry(ui, packed, { items: ['theme', 'button'], read }), []);
  assert.deepEqual(checkShippedRegistry(manifest, [...files, 'r/theme.json'], { items: ['theme'], read }), [], 'non-UI packages carry no registry');
  assert.deepEqual(checkShippedRegistry(ui, packed.filter(path => path !== 'r/registry.json'), { items: ['theme'], read }), ['Missing r/registry.json']);
  assert.deepEqual(checkShippedRegistry(ui, packed.filter(path => path !== 'r/button.json'), { items: ['theme', 'button'], read }), ['Missing registry item: r/button.json']);
  assert.deepEqual(checkShippedRegistry(ui, packed, { items: ['theme', 'button'], read: path => path.endsWith('theme.json') ? { dependencies: ['@hachej/boring-files@0.2.1'] } : read(path) }), [
    'Registry pin mismatch in r/theme.json: @hachej/boring-files@0.2.1 (release 0.2.2)',
  ], 'exact internal pin is refused');
  assert.deepEqual(checkShippedRegistry(ui, packed, { items: ['theme', 'button'], read: path => path.endsWith('theme.json') ? { dependencies: ['@hachej/boring-files@^0.2.1', 'radix-ui@^1.8.0'] } : read(path) }), [
    'Registry pin mismatch in r/theme.json: @hachej/boring-files@^0.2.1 (release 0.2.2)',
  ]);
  assert.deepEqual(checkShippedRegistry(ui, packed, { items: ['theme', 'button'], read: path => path.endsWith('theme.json') ? { dependencies: ['@hachej/boring-feedback@0.2.2', '@hachej/boring-ui-kit@^0.2.2'] } : read(path) }), [
    'Registry pin mismatch in r/theme.json: @hachej/boring-feedback@0.2.2 (release 0.2.2)',
  ], 'a published feedback pin must be a caret range');
  assert.deepEqual(checkShippedRegistry(ui, packed, { items: ['theme', 'button'], read: path => path.endsWith('theme.json') ? { dependencies: ['@hachej/boring-ui-kit@0.2.2'] } : read(path) }), [
    'Registry pin mismatch in r/theme.json: @hachej/boring-ui-kit@0.2.2 (release 0.2.2)',
  ]);
  assert.deepEqual(checkShippedRegistry(ui, packed, { items: ['theme', 'button'], read: path => path.endsWith('button.json') ? { registryDependencies: ['@boring-ui/utils', 'theme'] } : read(path) }), [
    'Registry dependency not shipped in r/: button -> @boring-ui/utils',
    'Registry dependency not shipped in r/: button -> theme',
  ]);
  // Items name their own dependencies as absolute URLs of this release (scripts/build-registry.mjs): the current version of a shipped item passes.
  const release = (version, name) => `https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@${version}/r/${name}.json`;
  const withDependency = dependency => ({ items: ['theme', 'button'], read: path => path.endsWith('button.json') ? { registryDependencies: [dependency] } : read(path) });
  assert.deepEqual(checkShippedRegistry(ui, packed, withDependency(release('0.2.2', 'theme'))), []);
  assert.deepEqual(checkShippedRegistry(ui, packed, withDependency(release('0.2.1', 'theme'))), [
    `Registry URL mismatch in r/button.json: ${release('0.2.1', 'theme')} (release 0.2.2)`,
  ], 'an item URL of another version is refused');
  assert.deepEqual(checkShippedRegistry(ui, packed, withDependency(release('0.2.2', 'missing'))), [
    `Registry dependency not shipped in r/: button -> ${release('0.2.2', 'missing')}`,
  ], 'an item URL must name a shipped item');
  // A shadcn built-in is a bare name the consumer's own style resolves: it needs no shipped item.
  assert.deepEqual(checkShippedRegistry(ui, packed, withDependency('drawer')), []);
  assert.deepEqual(checkShippedRegistry(ui, packed, withDependency('carousel')), ['Registry dependency not shipped in r/: button -> carousel'], 'any other bare name is refused');
  // The registry index lists items too: its dependencies are audited the same way.
  assert.deepEqual(checkShippedRegistry(ui, packed, { items: ['theme', 'button'], read: path => path === 'r/registry.json' ? { items: [{ name: 'theme' }, { name: 'button', registryDependencies: ['@boring-ui/theme'] }] } : read(path) }), [
    'Registry dependency not shipped in r/: registry index button -> @boring-ui/theme',
  ], 'the index must carry release URLs too');
});

test('the consumer harness maps only this workspace release URLs to its local registry', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const current = `${releaseItemBase(kitVersion(root))}/theme.json`;
  assert.equal(registryItemName(root, current), 'theme');
  assert.throws(() => registryItemName(root, current.replace(/@[^/]+\/r\//, '@9.9.9/r/')), /not a registry item URL of this release|Not a registry item URL/i, 'a wrong version is refused, not served');
  assert.throws(() => localRegistryDependencies(root, { registryDependencies: [current.replace(/@[^/]+\/r\//, '@9.9.9/r/')] }, 'http://127.0.0.1:1/r'), /Not a registry item URL/);
  assert.deepEqual(localRegistryDependencies(root, { registryDependencies: [current] }, 'http://127.0.0.1:1/r').registryDependencies, ['http://127.0.0.1:1/r/theme.json']);
});
