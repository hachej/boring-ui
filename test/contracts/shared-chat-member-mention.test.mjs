import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// A member picked in the shared chat's composer is written with pi-chat's `mentionToken` (the composer's `addMentions`), and the
// kit's shared chat must find that member in the sent text. A member id with a backslash was written bare by pi-chat and expected
// quoted by the kit, so the mention was dropped. `MENTION_SOURCE_ROOT` runs the item side against another checkout and `MENTION_KIT`
// (a built module path) the kit side; by default both are this checkout's public entries.
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.MENTION_SOURCE_ROOT ?? root;
const out = `${root}.cache/shared-chat-mention-test`;
mkdirSync(out, { recursive: true });
await build({ entryPoints: [`${source}/registry/pi-chat/config.ts`], outfile: `${out}/config.mjs`, bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'silent' });
const { mentionToken } = await import(pathToFileURL(`${out}/config.mjs`).href);
const { createFakeChannelSource, createSharedChat } = await import(process.env.MENTION_KIT ? pathToFileURL(process.env.MENTION_KIT).href : '@hachej/boring-ui-kit/shared-chat');

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
for (const id of ['leo', 'team\\leo', 'Fictional Person']) {
  test(`a member picked in the composer is mentioned in the sent message (${JSON.stringify(id)})`, async t => {
    const fake = createFakeChannelSource({ me: { id: 'me', name: 'Me', kind: 'person' }, members: [{ id: 'me', name: 'Me', kind: 'person' }, { id, name: 'Fictional member', kind: 'person' }], conversations: [{ id: 'main', title: 'Main', kind: 'main', members: ['me', id] }], messages: [] });
    const payloads = [];
    const chat = createSharedChat({ ...fake, send: async input => { payloads.push(input); return fake.send(input); } }, { conversationId: 'main' });
    t.after(() => chat.dispose()); await chat.connect();
    chat.setText(`${mentionToken(id)} please look`);
    await chat.send();
    for (let n = 0; n < 50 && !payloads.length; n++) await tick();
    assert.deepEqual(payloads[0]?.mentions, [id]);
  });
}
