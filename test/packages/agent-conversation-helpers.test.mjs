import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationTitle } from '@hachej/boring-agent/conversations';
import { refreshAgentState } from '@hachej/boring-agent/agents';

const context = {};
const agentOf = (instructions, thinkingLevel) => ({ agent: { instructions, thinkingLevel } });
const fakeConversation = (id, configured = []) => ({ id, configure: async (change) => { configured.push({ id, change }); } });

test('refreshAgentState configures every conversation only when the hash of the agent state changes', async () => {
  const stored = { hash: undefined, writes: 0 };
  const read = () => stored.hash;
  const write = hash => { stored.hash = hash; stored.writes++; };
  const configured = [];
  const conversations = [fakeConversation('a', configured), fakeConversation('b', configured)];

  const first = await refreshAgentState({ conversations, agent: agentOf('Be brief.', 'low'), read, write, context });
  assert.equal(first, 2);
  assert.deepEqual(configured.map(item => item.id), ['a', 'b']);
  assert.deepEqual(configured[0].change, { instructions: 'Be brief.', thinkingLevel: 'low' });
  assert.equal(stored.writes, 1);

  const same = await refreshAgentState({ conversations, agent: agentOf('Be brief.', 'low'), read, write, context });
  assert.equal(same, 0, 'an unchanged agent configures nothing');
  assert.equal(configured.length, 2);
  assert.equal(stored.writes, 1);

  const changed = await refreshAgentState({ conversations, agent: agentOf('Be thorough.', 'low'), read, write, context });
  assert.equal(changed, 2);
  assert.equal(configured[2].change.instructions, 'Be thorough.');

  const thinking = await refreshAgentState({ conversations, agent: agentOf('Be thorough.', 'high'), read, write, context });
  assert.equal(thinking, 2, 'a changed default thinking level also refreshes');
  assert.equal(stored.writes, 3);
});

test('refreshAgentState keeps the old hash when a conversation fails, so the next run retries', async () => {
  let stored;
  const failing = { id: 'x', configure: async () => { throw new Error('busy'); } };
  await assert.rejects(refreshAgentState({ conversations: [failing], agent: agentOf('New.', undefined), read: () => stored, write: hash => { stored = hash; }, context }), /busy/);
  assert.equal(stored, undefined);
});

test('conversationTitle scans ascending, stops at the first user message and memoizes a non-null title', async () => {
  const messages = [];
  for (let i = 0; i < 250; i++) messages.push({ id: i + 1, model: [{ role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text: i === 0 ? 'Fictional first question' : `m${i}` }] }] });
  let pages = 0;
  const conversation = {
    id: 7,
    entries: async (query, limit, cursor) => {
      pages++;
      const ordered = query.order === 'ascending' ? messages : [...messages].reverse();
      const start = cursor ?? 0;
      const items = ordered.slice(start, start + limit);
      return { items, next: start + limit < ordered.length ? start + limit : undefined };
    },
  };
  const cache = new Map();
  assert.equal(await conversationTitle(conversation, context, cache), 'Fictional first question');
  assert.equal(cache.get('7'), 'Fictional first question');
  const readAfterFirst = pages;
  assert.equal(readAfterFirst, 1, 'only the first page of a 250-entry history is read');
  assert.equal(await conversationTitle(conversation, context, cache), 'Fictional first question');
  assert.equal(pages, readAfterFirst, 'a cached title reads no history');
});

test('conversationTitle returns null without caching while there is no user message yet', async () => {
  const messages = [{ id: 1, model: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }] }];
  const conversation = { id: 'c', entries: async () => ({ items: [...messages], next: undefined }) };
  const cache = new Map();
  assert.equal(await conversationTitle(conversation, context, cache), null);
  assert.equal(cache.size, 0);
  messages.push({ id: 2, model: [{ role: 'user', content: [{ type: 'text', text: 'Now asked' }] }] });
  assert.equal(await conversationTitle(conversation, context, cache), 'Now asked');
  assert.equal(cache.get('c'), 'Now asked');
});

test('conversationTitle works without a cache and clips long titles to 80 characters', async () => {
  const long = `${'word '.repeat(40)}end`;
  const conversation = { id: 1, entries: async () => ({ items: [{ id: 1, model: [{ role: 'user', content: [{ type: 'text', text: long }] }] }], next: undefined }) };
  const title = await conversationTitle(conversation, context);
  assert.equal(title.length, 80);
  assert.ok(title.endsWith('…'));
});
