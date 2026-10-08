import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackages } from '../../scripts/check-npm-packages.mjs';
import test from 'node:test';
import { isContractOnly } from '../../scripts/is-contract-only.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

for (const name of readdirSync(join(root, 'packages'))) {
  test(`${name}: public declarations exist and type-only exports stay runtime-free`, async () => {
    const dir = join(root, 'packages', name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      assert.ok(existsSync(join(dir, entry.types)), entry.types);
      assert.ok(existsSync(join(dir, entry.import)), entry.import);
      const source = entry.import.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
      if (existsSync(join(dir, source)) && isContractOnly(source, readFileSync(join(dir, source), 'utf8'))) {
        const js = readFileSync(join(dir, entry.import), 'utf8').replace(/^\/\/.*$/gm, '').trim();
        assert.equal(js, 'export {};', `${name}/${subpath}: erased types unexpectedly emit implementation`);
        const specifier = manifest.name + (subpath === '.' ? '' : subpath.slice(1));
        assert.deepEqual(Object.keys(await import(specifier)), [], specifier);
      }
      // Real implementations can land with their required proofs. This test
      // must not permanently freeze packages into empty interface-only output.
    }
    assert.ok(Object.values(manifest.exports).some(entry => existsSync(join(dir, entry.types))));
  });
}

test('all workspace tarballs include every export, license and only distributable files', () => {
  const result = checkPackages(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.packs.length, readdirSync(join(root, 'packages')).length);
});
