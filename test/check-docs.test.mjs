import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkDocs } from '../scripts/check-docs.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'boring-v4-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('required documents cannot be missing', (t) => {
  assert.match(checkDocs(fixture(t), ['required.md']).problems[0], /missing required/);
});

test('valid relative links, external links and anchors resolve', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'README.md'), '[Spec](spec.md#heading) [Web](https://example.com) [Here](#here)');
  writeFileSync(join(root, 'spec.md'), '# Heading');
  assert.deepEqual(checkDocs(root, []).problems, []);
  assert.equal(checkDocs(root, []).documents, 2);
});

test('missing local links are reported', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'README.md'), '[Missing](absent.md)');
  assert.match(checkDocs(root, []).problems[0], /missing local link/);
});

test('links outside the repository are rejected', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'README.md'), '[Outside](../elsewhere.md)');
  assert.match(checkDocs(root, []).problems[0], /leaves repository/);
});

test('symlink targets cannot disguise links outside the repository', (t) => {
  const root = fixture(t);
  symlinkSync(tmpdir(), join(root, 'outside'));
  writeFileSync(join(root, 'README.md'), '[Outside](outside)');
  assert.match(checkDocs(root, []).problems[0], /leaves repository/);
});

test('what git ignores (caches, dependencies, tool output) is not a document; the rest is', (t) => {
  const root = fixture(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, '.gitignore'), '.cache/\nnode_modules/\n.wrangler/\n');
  for (const name of ['.cache', 'node_modules', 'app/.wrangler/tmp']) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'ignored.md'), '[Broken](absent.md)');
  }
  assert.deepEqual(checkDocs(root, []), { documents: 0, problems: [] });
  writeFileSync(join(root, 'app', 'kept.md'), '[Broken](absent.md)');
  assert.match(checkDocs(root, []).problems.join('\n'), /app\/kept\.md: missing local link target/, 'an untracked file git does not ignore is still checked');
});

test('fenced illustrative code is not treated as document navigation', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'README.md'), '```md\n[Example](not-a-real-document.md)\n```\n');
  assert.deepEqual(checkDocs(root, []).problems, []);
});
