// Local dev/example servers answer only to their own loopback Host (DNS rebinding): a request carrying another Host (the rebinding page's
// `attacker.example:<port>`) gets 421 before any routing, so the page that inlines the bearer token never reaches it; a normal request works.
// Each server is started through its real entry point; node's http.request is used because fetch forbids setting Host.
import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sameSecret } from '../../shared/local-host.mjs';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

process.env.STUDIO_MODEL = 'scripted';
const get = (port, host, path = '/') => new Promise((resolve, reject) => {
  request({ host: '127.0.0.1', port, path, headers: { host } }, response => { let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body })); }).on('error', reject).end();
});

const servers = {
  studio: async directory => (await import('../../lab/studio/server.mjs')).startStudio({ directory, provider: 'openai' }),
  'app-shell': async directory => (await import('../../examples/app-shell/server.mjs')).startAppShell({ directory }),
  'dock-app': async directory => (await import('../../examples/dock-app/server.mjs')).startDockApp({ directory }),
  'workspace-app': async directory => (await import('../../examples/workspace-app/server.mjs')).startWorkspaceApp({ directory }),
  'board-viewer': async directory => (await import('../../examples/board-viewer/server.mjs')).startBoard({ directory }),
  highlights: async () => (await import('../../examples/highlights/server.mjs')).startHighlights(),
};

for (const [name, start] of Object.entries(servers)) {
  test(`${name}: a foreign Host is refused with 421 and the token page is not served, loopback Hosts still work`, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'boring-host-guard-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
    const app = await start(directory); t.after(() => app.close());
    const port = Number(new URL(app.url).port);
    for (const host of [`attacker.example:${port}`, `127.0.0.1.attacker.example:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`]) {
      const refused = await get(port, host);
      assert.equal(refused.status, 421, `Host ${host}`);
      assert.doesNotMatch(refused.body, /token/i, 'the refusal carries no page');
    }
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) assert.equal((await get(port, host)).status, 200, `Host ${host}`);
  });
}

test('sameSecret compares equal strings only, without throwing on a missing or different-length value', () => {
  assert.equal(sameSecret('Bearer a', 'Bearer a'), true);
  for (const bad of ['Bearer b', 'Bearer', null, undefined, 'Bearer aa']) assert.equal(sameSecret(bad, 'Bearer a'), false);
});

test('a SQLite workspace store without an authorize policy refuses every request', async t => {
  const store = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional' }); t.after(() => store.close());
  const identity = { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' };
  const result = await store.read({ target: { resource: { providerId: 'fictional', path: 'notes.md' }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, identity);
  assert.equal(result.kind, 'denied');
});
