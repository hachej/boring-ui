import assert from 'node:assert/strict';
import test from 'node:test';
import { createMentionResolver, MENTION_FILE_PREFIX } from '@hachej/boring-agent/mentions';

const enc = text => new TextEncoder().encode(text);
const files = {
  'notes.md': enc('# hello\nsecret content'),
  'scan.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
  'doc.pdf': enc('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'),
};
const calls = [];
const read = async (path, options) => {
  calls.push([path, options?.bytes]);
  const bytes = files[path];
  return bytes ? { size: bytes.length, ...(options?.bytes === false ? {} : { bytes }) } : undefined;
};
const texts = parts => parts.slice(1).map(part => part.type === 'text' ? part.text : `[${part.type}]`);

test('reference mode adds one short part per file and never content or image data', async () => {
  calls.length = 0;
  const out = await createMentionResolver({ read, mode: 'reference' })('look at @notes.md @scan.png @doc.pdf @missing.txt @../x');
  assert.deepEqual(texts(out), [
    `${MENTION_FILE_PREFIX}notes.md" type="md" size="${files['notes.md'].length}" />`,
    `${MENTION_FILE_PREFIX}scan.png" type="image/png" size="${files['scan.png'].length}" />`,
    `${MENTION_FILE_PREFIX}doc.pdf" type="pdf" size="${files['doc.pdf'].length}" />`,
    `${MENTION_FILE_PREFIX}missing.txt" unavailable="not found or not readable" />`,
    `${MENTION_FILE_PREFIX}../x" unavailable="not a path inside the workspace" />`,
  ]);
  assert.ok(calls.filter(([path]) => files[path]).every(([, bytes]) => bytes === false));
});

test('inline mode still inlines text and images, and never decodes a UTF-8 valid pdf as text', async () => {
  const out = await createMentionResolver({ read })('@notes.md @scan.png @doc.pdf');
  const added = texts(out);
  assert.match(added[0], /secret content/);
  assert.equal(added[2], '[image]');
  assert.equal(added[3], `${MENTION_FILE_PREFIX}doc.pdf" unavailable="binary file, ${files['doc.pdf'].length} bytes; content not included" />`);
  assert.ok(!added.join('').includes('%PDF'));
});
