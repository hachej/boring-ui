// Tool names on screen: a tool id (`piece_save`) is never shown raw, in English or French. Built-in tools keep their own names; any
// other id is humanised. Renders the real label sets, so a key added in one language and missing in the other fails here.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/pi-chat-tool-names-test');
mkdirSync(out, { recursive: true });
async function load(name, contents) {
  writeFileSync(join(out, `${name}-entry.ts`), contents);
  await build({ entryPoints: [join(out, `${name}-entry.ts`)], outfile: join(out, `${name}.mjs`), bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(join(out, `${name}.mjs`)).href);
}
const en = await load('en', `export { defaultChatLabels, humanToolName } from '${root}registry/pi-chat/labels.ts';`);
const fr = await load('fr', `export { frenchChatLabels } from '${root}registry/pi-chat/labels-fr.ts';`);

test('a tool id reads as a name: built-ins by their own word, other ids humanised', () => {
  assert.equal(en.humanToolName('piece_save'), 'Piece save');
  assert.equal(en.humanToolName('web-fetch.v2'), 'Web fetch v2');
  assert.equal(en.defaultChatLabels.toolName('bash'), 'Shell');
  assert.equal(en.defaultChatLabels.toolName('piece_save'), 'Piece save');
  assert.equal(fr.frenchChatLabels.toolName('piece_save'), 'Piece save');
  assert.equal(fr.frenchChatLabels.toolName('read'), 'Lecture');
});

test('the English and French activity, summary and failure lines never print a raw tool id', () => {
  for (const labels of [en.defaultChatLabels, fr.frenchChatLabels]) {
    const lines = [labels.toolActivity('piece_save', ''), labels.toolActivity('piece_save', 'notes/a.md'), labels.toolNoun('piece_save'), labels.toolFailed('piece_save')];
    for (const line of lines) assert.ok(!line.includes('piece_save') && !line.includes('_'), `raw id in "${line}"`);
  }
  assert.equal(en.defaultChatLabels.toolActivity('piece_save', ''), 'Running piece save');
  assert.equal(en.defaultChatLabels.toolFailed('piece_save'), 'Piece save failed');
});

test('the French set names every built-in tool in French', () => {
  for (const tool of ['bash', 'read', 'write', 'edit', 'ls', 'find', 'grep', 'load_skill']) {
    assert.notEqual(fr.frenchChatLabels.toolName(tool), en.defaultChatLabels.toolName(tool), `${tool} is translated`);
  }
});
