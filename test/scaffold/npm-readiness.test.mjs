import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPackage } from '../../scripts/check-npm-packages.mjs';

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
