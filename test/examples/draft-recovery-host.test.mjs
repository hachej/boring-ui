import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResourceClient } from '@hachej/boring-files/remote';
import { openDraftHost, draftIdentity, draftTarget } from '../../examples/draft-recovery/host.mjs';
import { openDraftDatabase } from '../../examples/draft-recovery/indexeddb-store.mjs';

test('fictional draft host uses persistent SQLite and public resource transport receipts', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-draft-host-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'host.sqlite'); let host = await openDraftHost({ filename });
  try {
    for (const format of ['markdown', 'html', 'canvas', 'experience']) {
      const client = createResourceClient({ identity: draftIdentity, endpoint: `https://fictional.invalid/resource/${format}`, publication: true, reconciliation: true, fetch: request => host.handle(request) });
      const read = await client.read({ target: draftTarget(format), revision: { kind: 'latest' } }); assert.equal(read.kind, 'available');
      const text = new TextDecoder().decode(read.snapshot.bytes); assert.ok(text.includes('Fictional') || text.includes('fictional'));
      if (format === 'html') {
        const result = await client.publish({ operationId: 'fictional-human-save', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: read.snapshot.ref, bytes: new TextEncoder().encode('\uFEFF<p>Fictional saved 🌞</p>'), mediaType: 'text/html' }] });
        assert.equal(result.kind, 'committed'); assert.equal((await client.lookup(result.receipt.operationId)).kind, 'committed');
      }
    }
    assert.equal(host.publications(), 1); host.close(); host = await openDraftHost({ filename });
    const read = await host.provider.read({ target: draftTarget('html'), revision: { kind: 'latest' } }, draftIdentity); assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(read.snapshot.bytes), '\uFEFF<p>Fictional saved 🌞</p>');
    let foreignStatus; const foreign = createResourceClient({ identity: { ...draftIdentity, principalId: 'foreign' }, endpoint: 'https://fictional.invalid/resource/html', fetch: async request => { const response = await host.handle(request); foreignStatus = response.status; return response; } }); assert.equal((await foreign.read({ target: draftTarget('html'), revision: { kind: 'latest' } })).kind, 'unavailable'); assert.equal(foreignStatus, 403);
  } finally { host.close(); }
});

test('IndexedDB fixture is opt-in and rejects missing host storage before opening', async () => {
  await assert.rejects(openDraftDatabase(), /IndexedDB/);
  let opens = 0;
  await assert.rejects(openDraftDatabase({ indexedDB: { open: () => { opens++; } }, maxBytes: Infinity }), /bounds/);
  assert.equal(opens, 0);
});
