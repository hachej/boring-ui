import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFeedback } from '@hachej/boring-feedback/format';
import { captureAnnotation, createAnnotation, showAnchor } from '@hachej/boring-feedback/ui';
import { APP } from '../../examples/feedback/server.mjs';
import { pageShow } from '../../examples/feedback/show-outcome.mjs';
import { api, openApp, openPage, policy, replyText, toolResults } from '../fixtures/feedback-app.mjs';

// FEEDBACK-3 runtime proof (WP9): unknown anchor kinds, unknown observation fields and x- fields travel through every store
// operation of the composed examples/feedback app (Save route, list and read routes, the @ mention reader, the builder agent's list,
// show and resolve, and the stored file) as equal JSON, and are placed `unsupported`, never guessed: in the agent's list, in
// its show, and by the page's Show. Fictional data only.

const future = { kind: 'pdf.rect@7', page: 3, rect: [10, 20, 30, 40], fallback: 'page 3, the totals box', 'x-fictional-note': { kept: ['as', 'is'] } };

test('an unknown anchor kind survives create, list, read, mention, agent list/show/resolve and the stored file, and is placed unsupported', { timeout: 30000 }, async t => {
  const app = await openApp(t);
  const page = openPage(t);
  const capture = await captureAnnotation({ app: APP, build: 'dev-contract', policy, root: page.root }, [page.document.querySelector('[data-testid=save-profile]')]);
  const annotation = createAnnotation({ capture });
  annotation.setSaid('The totals box and the Save button disagree.');
  const base = annotation.draft();
  const draft = { ...base, anchors: [...base.anchors, future], observed: { ...base.observed, 'x-fictional-observer': { version: 9 } } };

  // create: the Save route admits it with the browser's operation id.
  const saved = await api(app, 'ada', '/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'contract-unknown-0001', draft }) });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const id = saved.body.id;

  // read and list routes.
  const read = await api(app, 'ada', `/api/feedback/${id}`);
  assert.deepEqual(read.body.report.anchors[1], future);
  assert.deepEqual(read.body.report.observed['x-fictional-observer'], { version: 9 });
  const listed = await api(app, 'ada', '/api/feedback');
  assert.ok(listed.body.items.some(item => item.id === id));

  // mention: the store's mention reader inlines the canonical report, unknown kind included, into the person's message.
  const mentioned = await app.say('ada', `see @feedback/${id}.md`);
  const user = mentioned.find(message => message.role === 'user');
  const inlined = user.content.find(part => part.type === 'text' && part.text.startsWith(`<file path="feedback/${id}.md">`)).text;
  const bytes = new TextEncoder().encode(inlined.slice(inlined.indexOf('\n') + 1, inlined.lastIndexOf('\n</file>')));
  const parsed = parseFeedback(bytes);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.report.anchors[1], future);

  // agent list: the unknown kind is placed unsupported, the page kind is left to the page.
  const list = toolResults(mentioned).find(result => result.value.action === 'list').value;
  const anchors = list.items.find(item => item.id === id).anchors;
  assert.equal(anchors[0].placement, 'checked in the page');
  assert.deepEqual([anchors[1].kind, anchors[1].fallback, anchors[1].placement.kind], ['pdf.rect@7', future.fallback, 'unsupported']);

  // agent show of the unknown anchor: unsupported, with its fallback, never an offer.
  const shown = toolResults(await app.say('ada', `show ${id} #1`)).find(result => result.value.action === 'show').value;
  assert.deepEqual([shown.kind, shown.anchor, shown.fallback], ['unsupported', 1, future.fallback]);

  // the page's Show of the unknown anchor: unavailable (unsupported here), nothing revealed.
  const highlighted = [];
  const overlay = { highlight: element => highlighted.push(element), draw: () => {}, clear: () => {} };
  const outcome = await pageShow({ read: async () => read.body, show: (anchor, note) => showAnchor({ anchor, root: page.root, policy, overlay, note }), choose: async () => undefined })({ id, anchor: 1 });
  assert.equal(outcome.kind, 'unavailable');
  assert.match(outcome.reason, /Unsupported here: .*pdf\.rect@7/);
  assert.deepEqual(highlighted, []);

  // agent resolve: the stored report keeps the unknown kind and fields.
  const resolved = toolResults(await app.say('ada', `resolve ${id}`)).find(result => result.value.action === 'resolve').value;
  assert.equal(resolved.kind, 'applied');
  const after = await app.store.read(id, app.people.ada.access);
  assert.equal(after.report.status, 'addressed');
  assert.deepEqual(after.report.anchors[1], future);
  assert.deepEqual(after.report.observed['x-fictional-observer'], { version: 9 });

  // the stored file: one report file in the workspace, and it carries the unknown kind.
  const file = await app.files.read({ target: { resource: { providerId: app.files.providerId, path: `feedback/${id}.md` }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, app.people.ada.access);
  assert.equal(file.snapshot.ref.revision, after.revision);
  assert.deepEqual(parseFeedback(file.snapshot.bytes).report.anchors[1], future);
  assert.match(replyText(mentioned), /I offered to show/);
});
