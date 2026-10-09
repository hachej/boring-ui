import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFeedback } from '@hachej/boring-feedback/format';
import { captureAnnotation, createAnnotation } from '@hachej/boring-feedback/ui';
import { APP, placeholderAgent } from '../../examples/feedback/server.mjs';
import { annotateAndSave, api, openApp, openPage, policy, replyText, toolResults } from '../fixtures/feedback-app.mjs';

// FEEDBACK-5 runtime proof (WP9): the three configurations of FEEDBACK.md run, each without the parts it does not need.
//   1. Annotation only: capture and Copy on a page with no store, no route and no agent (fetch is made to fail if anything calls it).
//   2. Annotation plus storage: the composed examples/feedback app with an agent that has NO feedback capability; Save goes through
//      the route into the store, and the agent's turn calls no tool and its transcript holds no feedback call or result.
//   3. The agent tool with no browser: the composed app's builder agent lists, reads and resolves a stored report headlessly.
// Fictional data only.

test('annotation only: capture and Copy work with no store, no route and no agent', async t => {
  const page = openPage(t);
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; throw new Error('no network in the annotation-only configuration'); };
  t.after(() => { globalThis.fetch = realFetch; });
  const copied = [];
  const capture = await captureAnnotation({ app: APP, build: 'dev-contract', policy, root: page.root }, [page.document.querySelector('[data-testid=save-profile]')]);
  const annotation = createAnnotation({ capture, copyText: async text => { copied.push(text); return true; } });
  assert.equal(annotation.getSnapshot().canSave, false, 'no Save without a store');
  annotation.setSaid('Copy only: the Save button should say what it saves.');
  assert.equal((await annotation.copy()).kind, 'copied');
  const parsed = parseFeedback(new TextEncoder().encode(copied[0]));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.report.author, undefined, 'a never-stored report has no author');
  assert.equal(parsed.report.anchors[0].signals.feedbackId, 'save-profile');
  assert.equal(fetched, 0);
});

test('annotation plus storage: Save stores through the route while the agent has no feedback tool', { timeout: 30000 }, async t => {
  const app = await openApp(t, { agent: placeholderAgent });
  const page = openPage(t);
  const { saved } = await annotateAndSave(app, 'ada', page, [page.document.querySelector('[data-testid=save-profile]')], 'Stored without an agent.');
  assert.equal(saved.kind, 'saved', JSON.stringify(saved));
  const listed = await api(app, 'ada', '/api/feedback');
  assert.deepEqual(listed.body.items.map(item => item.id), [saved.id]);
  const read = await api(app, 'ada', `/api/feedback/${saved.id}`);
  assert.equal(read.body.report.author.display, 'Ada Fictional');

  const turn = await app.say('ada', 'check feedback');
  assert.deepEqual(toolResults(turn), [], 'the agent without the capability calls no tool');
  assert.match(replyText(turn), /placeholder/);
  const conversation = await app.messages('ada');
  assert.ok(!JSON.stringify(conversation).includes('"feedback"'), 'no feedback tool result or call in the transcript');
});

test('the agent tool with no browser: the builder lists, reads and resolves a stored report headlessly', { timeout: 30000 }, async t => {
  const app = await openApp(t);
  const page = openPage(t);
  const { saved } = await annotateAndSave(app, 'bob', page, [page.document.querySelector('[data-testid=save-profile]')], 'Headless: the Save button label.');
  assert.equal(saved.kind, 'saved');

  const listed = toolResults(await app.say('ada', 'check feedback'));
  assert.deepEqual(listed.map(result => [result.name, result.value.action, result.value.kind]), [['feedback', 'list', 'available']]);
  assert.deepEqual(listed[0].value.items.map(item => [item.id, item.author, item.anchors[0].placement]), [[saved.id, 'Bob Fictional', 'checked in the page']]);

  const resolved = toolResults(await app.say('ada', `resolve ${saved.id}`));
  assert.deepEqual(resolved.map(result => result.value.action ?? result.name), ['read', 'edit_page', 'resolve']);
  assert.equal(resolved[2].value.kind, 'applied');
  assert.equal(resolved[2].value.status, 'addressed');
  assert.equal(app.page.state().saveLabel, 'Save studio profile', 'the fictional page changed');
  const after = await app.store.read(saved.id, app.people.bob.access);
  assert.deepEqual(after.report.resolutions.map(item => item.by), ['p_fictional_builder']);
});
