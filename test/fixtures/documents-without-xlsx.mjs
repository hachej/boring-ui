import assert from 'node:assert/strict';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { documentTools } from '@hachej/boring-agent/documents';
import { admitDocumentTool, toolResultText } from './native-document.mjs';
import { pdf } from './document-bytes.mjs';

await assert.rejects(import('xlsx'), { code: 'ERR_MODULE_NOT_FOUND' });
const sheet = new TextEncoder().encode('article,quantite\nfictional-stock,12');
const files = new Map([['stock.csv', sheet], ['invoice.pdf', pdf([['Fictional invoice total 120']])]]);
const registry = createRegistry();
registry.install(defineExtension({ name: 'fixture.documents.optional', tools: documentTools({ readBytes: path => {
  assert.ok(files.has(path), 'only fictional fixture paths are readable');
  return files.get(path);
} }) }));
const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
try {
  const conversation = await harness.root(context);
  harness.resume();
  const run = async (name, path) => toolResultText(harness, conversation, await admitDocumentTool(conversation, { path }, name));
  const refused = await run('read_spreadsheet', 'stock.csv');
  assert.equal(refused.isError, false, refused.text);
  assert.deepEqual(JSON.parse(refused.text), {
    path: 'stock.csv', type: 'text/csv', size: sheet.byteLength,
    error: 'Spreadsheet reading needs the optional package xlsx (SheetJS); install it in the host',
  });
  const read = await run('read_pdf', 'invoice.pdf');
  assert.equal(read.isError, false, read.text);
  const result = JSON.parse(read.text);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(result.pages, [{ n: 1, text: 'Fictional invoice total 120' }]);
  assert.equal(result.untrusted, true);
  console.log('PASS: optional SheetJS refusal and PDF text through native tools');
} finally { await harness.close(context); }
