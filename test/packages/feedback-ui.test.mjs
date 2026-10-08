import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openWorkspaceResources } from '../fixtures/feedback-workspace.mjs';
import { UNTRUSTED_PREFACE, parseFeedback } from '@hachej/boring-feedback/format';
import { createPrivacyPolicy, createOverlay, pageDigest, runPrivacyCanaries } from '@hachej/boring-feedback/page';
import {
  captureAnnotation, createAnnotation, fetchSaveEndpoint, parseSaveRequest, saveResponseOf, saveResultOf, showAnchor,
  listRows, reportView, protectionNotice, subjectLabel, ageOf,
} from '@hachej/boring-feedback/ui';
import { createFeedbackStore } from '@hachej/boring-feedback/store';

// Fictional pages, people and notes only.
const root = fileURLToPath(new URL('../../', import.meta.url));
const policy = createPrivacyPolicy({ routeOf: ({ pathname }) => pathname.startsWith('/settings/') ? '/settings/:section' : pathname });
const PAGE = `<div id="app"><main data-feedback-visible=""><form><button type="submit" id="save" data-feedback-id="save-profile">Save profile</button>
  <input id="name" value="Fictional Studio Secret"></form>
  <section id="exports"><div><button type="button" class="export">Export CSV</button></div><div><button type="button" class="export">Export CSV</button></div></section></main>
  <aside><p id="private">Private fictional row</p></aside></div><div id="portal"><button id="ported">Portal</button></div>`;

function page(t, html = PAGE) {
  const window = new Window({ url: 'https://fictional.invalid/settings/profile?q=hidden#frag', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  window.document.body.innerHTML = html;
  t.after(() => window.happyDOM.close());
  const { document } = window;
  return { window, document, root: document.getElementById('app'), $: id => document.getElementById(id) };
}
const host = context => ({ app: 'fictional-settings', build: 'dev-fixture', root: context.root, policy });
const clipboard = () => { const copied = []; return { copied, copyText: async text => { copied.push(text); return true; } }; };

test('capture: one masked page snapshot gives the anchors, the digest, the route template and the policy record', async t => {
  const context = page(t);
  const capture = await captureAnnotation(host(context), [context.$('save'), context.$('ported')]);
  assert.deepEqual(capture.observed.subject, { type: 'app-page', app: 'fictional-settings', route: '/settings/:section', build: 'dev-fixture' });
  assert.equal(capture.observed.snapshot, 'app.dom@1');
  assert.equal(capture.observed.digest, `sha256:${await pageDigest(capture.snapshot)}`);
  assert.deepEqual(capture.observed.policy, { version: 1, widened: ['routeOf'] });
  assert.equal(capture.anchors.length, 1);
  assert.equal(capture.anchors[0].kind, 'app.element@1');
  assert.equal(capture.anchors[0].signals.feedbackId, 'save-profile');
  assert.deepEqual(capture.refused.map(item => item.index), [1]);
  assert.match(capture.refused[0].reason, /outside the application root/);
});

test('Copy report works with no store, no route and no agent; Save is not offered', async t => {
  const context = page(t);
  const { copied, copyText } = clipboard();
  const annotation = createAnnotation({ capture: await captureAnnotation(host(context), [context.$('save')]), copyText, now: () => new Date('2026-10-05T10:00:00Z') });
  assert.equal(annotation.getSnapshot().canSave, false);
  assert.equal((await annotation.copy()).kind, 'refused', 'an empty note is not copied');
  annotation.setSaid('The fictional Save button should say what it saves.');
  const copy = await annotation.copy();
  assert.equal(copy.kind, 'copied');
  assert.equal(copied.length, 1);
  const parsed = parseFeedback(new TextEncoder().encode(copied[0]));
  assert.equal(parsed.ok, true, JSON.stringify(parsed.problems));
  assert.equal(parsed.report.author, undefined);
  assert.equal(parsed.report.status, 'open');
  assert.equal(parsed.report.created, '2026-10-05T10:00:00.000Z');
  assert.ok(copied[0].includes(UNTRUSTED_PREFACE));
  assert.ok(!copied[0].includes('Fictional Studio Secret') && !copied[0].includes('Private fictional row') && !copied[0].includes('q=hidden'));
  assert.deepEqual(annotation.getSnapshot().targets, ['the «Save profile» button']);
  const save = await annotation.save();
  assert.equal(save.kind, 'unavailable');
});

test('a pin on an element with grandchildren still gives a parseable report (anchor snapshots stop one level below the element)', async t => {
  const context = page(t);
  const { copied, copyText } = clipboard();
  const capture = await captureAnnotation(host(context), [context.$('exports'), context.root.querySelector('main')]);
  assert.equal(capture.anchors.length, 2);
  for (const anchor of capture.anchors) for (const child of anchor.snapshot.children) assert.deepEqual(child.children, [], 'grandchildren are cut');
  const annotation = createAnnotation({ capture, said: 'Fictional deep pin', copyText });
  assert.equal((await annotation.copy()).kind, 'copied');
  const parsed = parseFeedback(new TextEncoder().encode(copied[0]));
  assert.equal(parsed.ok, true, JSON.stringify(parsed.problems));
});

test('Copy falls back to showing the text when the clipboard refuses', async t => {
  const context = page(t);
  const annotation = createAnnotation({ capture: await captureAnnotation(host(context), [context.$('save')]), said: 'Fictional', copyText: async () => false });
  const copy = await annotation.copy();
  assert.equal(copy.kind, 'manual');
  assert.match(copy.text, /^---\n/);
});

test('Save keeps one operation id per draft across retries; only definite refusals free it for a changed text', async t => {
  const context = page(t);
  const calls = [];
  const answers = [];
  const save = async request => { calls.push(request); const next = answers.shift(); if (next instanceof Error) throw next; return next; };
  const annotation = createAnnotation({ capture: await captureAnnotation(host(context), [context.$('save')]), said: 'First fictional note', save });
  assert.equal(annotation.getSnapshot().canSave, true);
  answers.push(new Error('connection reset'), { kind: 'unknown', reason: 'Lost reply.' }, { kind: 'saved', id: 'fb_1111111111111111', revision: 'r1' });
  assert.equal((await annotation.save()).kind, 'unknown', 'a throw is an unknown outcome, never a failure');
  assert.equal((await annotation.save()).kind, 'unknown');
  // The text changes after an unknown outcome: the id stays, so the store can answer honestly (conflict if the first one landed).
  annotation.setSaid('First fictional note, edited');
  assert.equal((await annotation.save()).kind, 'saved');
  assert.equal(new Set(calls.map(call => call.operationId)).size, 1);
  assert.equal(calls[2].draft.said, 'First fictional note, edited');
  assert.equal((await annotation.save()).kind, 'saved', 'a saved draft is not sent again');
  assert.equal(calls.length, 3);

  const second = createAnnotation({ capture: await captureAnnotation(host(context), [context.$('save')]), said: 'Second fictional note', save });
  answers.push({ kind: 'denied', reason: 'No grant.' }, { kind: 'denied', reason: 'No grant.' }, { kind: 'saved', id: 'fb_2222222222222222', revision: 'r1' });
  await second.save();
  await second.save();
  assert.equal(calls[3].operationId, calls[4].operationId, 'retrying the same text keeps the id');
  second.setSaid('Second fictional note, edited');
  await second.save();
  assert.notEqual(calls[5].operationId, calls[4].operationId, 'nothing was stored, so a changed draft gets a fresh id');
  assert.notEqual(calls[3].operationId, calls[0].operationId, 'each draft has its own id');
});

test('the host route admits the browser operation with the request access: a lost reply is reconciled without a duplicate', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-feedback-ui-'));
  const resources = await openWorkspaceResources(join(dir, 'feedback.sqlite'), 'fictional-feedback', 'fictional-studio');
  t.after(() => { resources.close(); rmSync(dir, { recursive: true, force: true }); });
  const ada = { scopeId: 'fictional-studio', principalId: 'p_fictional_ada', initiatorId: 'p_fictional_ada' };
  const grants = new Set(['host:app-page:fictional-settings:']);
  const view = { kind: 'published' };
  const store = createFeedbackStore({ providerId: 'fictional-feedback', view, reader: resources, publisher: resources.publication, lookup: resources.reconciliation, listFolder: resources.listFolder,
    capabilities: await resources.capabilities({ resource: { providerId: 'fictional-feedback', path: 'feedback' }, view }, ada),
    root: 'feedback/', operationNamespace: 'fictional-ui-test', resolveAccess: () => ada, authorizeSubject: (_access, subject) => [...grants].some(prefix => subject.key.startsWith(prefix)),
    displayName: () => 'Ada Fictional', protection: 'unprotected' });
  // The example's route, without HTTP: parse, admit with this request's access, create, map.
  let loseReply = false;
  const route = async body => {
    const parsed = parseSaveRequest(JSON.parse(JSON.stringify(body)));
    if (!parsed.ok) return { kind: 'invalid', reason: parsed.reason };
    const { operationId, draft } = parsed.request;
    const result = await store.create(draft, ada, { id: operationId, key: store.operationKey('create', draft, ada) });
    if (loseReply) { loseReply = false; throw new Error('reply lost after commit'); }
    return saveResultOf(saveResponseOf(result).body);
  };
  const context = page(t);
  const annotation = createAnnotation({ capture: await captureAnnotation(host(context), [context.$('save')]), said: 'Fictional note kept once', save: route });
  loseReply = true;
  assert.equal((await annotation.save()).kind, 'unknown');
  const saved = await annotation.save();
  assert.equal(saved.kind, 'saved');
  const listed = await store.list({}, ada);
  assert.equal(listed.items.length, 1, 'no duplicate after the retry');
  assert.equal(listed.items[0].id, saved.id);
  assert.equal(protectionNotice(listed.protection), 'This feedback is stored where working tools, shell and Git can change it: the store is unprotected.');
  const read = await store.read(saved.id, ada);
  assert.equal(read.report.author.principalId, 'p_fictional_ada', 'the author comes from the host, not the browser');

  // The same operation id with a changed draft is a conflict; a revoked grant is a refusal the sheet shows.
  const changed = { operationId: annotation.getSnapshot().operationId, draft: { ...annotation.draft(), said: 'A different fictional note' } };
  assert.equal((await route(changed)).kind, 'conflict');
  assert.deepEqual(parseSaveRequest({ operationId: 'x', draft: {} }).ok, false);
  assert.match(parseSaveRequest({ operationId: 'draft_fixture1', draft: { ...annotation.draft(), author: { principalId: 'p_forged', display: 'Forged' } } }).reason, /authorship/);
  grants.clear();
  const denied = createAnnotation({ capture: await captureAnnotation(host(context), [context.$('save')]), said: 'After revocation', save: route });
  assert.equal((await denied.save()).kind, 'denied');
  assert.equal((await store.list({}, ada)).items.length, 0, 'revoked: the list hides the item');
});

test('fetchSaveEndpoint maps transport failures to unknown and authentication refusals to denied', async () => {
  const request = { operationId: 'draft_fixture1', draft: { observed: {}, anchors: [], said: 'x' } };
  assert.equal((await fetchSaveEndpoint('https://fictional.invalid/api/feedback', async () => { throw new Error('offline'); })(request)).kind, 'unknown');
  assert.equal((await fetchSaveEndpoint('https://fictional.invalid/api/feedback', async () => new Response('nope', { status: 401 }))(request)).kind, 'denied');
  let sent;
  const saved = await fetchSaveEndpoint('https://fictional.invalid/api/feedback', async incoming => { sent = await incoming.json(); return Response.json({ kind: 'saved', id: 'fb_1111111111111111', revision: 'r' }); })(request);
  assert.deepEqual(saved, { kind: 'saved', id: 'fb_1111111111111111', revision: 'r' });
  assert.deepEqual(sent, request);
});

test('Show reveals exact and moved pins, numbers ambiguous candidates without revealing, and reports missing, stale and unsupported', async t => {
  const context = page(t);
  const { document, $ } = context;
  const overlay = createOverlay({ document });
  t.after(() => overlay.dispose());
  const capture = await captureAnnotation(host(context), [$('save'), document.querySelector('.export')]);
  const [saveAnchor, exportAnchor] = capture.anchors;
  const show = anchor => showAnchor({ anchor, root: context.root, policy, overlay, note: 'Fictional note' });

  const exact = await show(saveAnchor);
  assert.equal(exact.kind, 'revealed');
  assert.equal(exact.placement, 'exact');
  assert.equal(exact.element, $('save'));
  assert.deepEqual(overlay.drawn(), [{ label: 'Fictional note', tone: 'reveal' }]);

  const choice = await show(exportAnchor);
  assert.equal(choice.kind, 'choose');
  assert.deepEqual(choice.candidates.map(candidate => [candidate.number, candidate.label]), [[1, 'button «Export CSV»'], [2, 'button «Export CSV»']]);
  assert.deepEqual(overlay.drawn(), [{ label: '1', tone: 'candidate' }, { label: '2', tone: 'candidate' }], 'numbers only: nothing is revealed before the choice');
  const chosen = choice.choose(2);
  assert.equal(chosen.kind, 'revealed');
  assert.equal(chosen.placement, 'chosen');
  assert.equal(chosen.element, document.querySelectorAll('.export')[1]);
  assert.equal(choice.choose(3).kind, 'stale');

  // The page changes between Show and the choice: the choice is stale, never a guess.
  const later = await show(exportAnchor);
  document.querySelectorAll('.export')[0].textContent = 'Download';
  assert.equal(later.choose(1).kind, 'stale');
  assert.deepEqual(overlay.drawn(), []);

  // Moved: the identity is unique but the path changed.
  const wrapper = document.createElement('div');
  $('save').before(wrapper);
  wrapper.append($('save'));
  const moved = await show(saveAnchor);
  assert.equal(moved.kind, 'revealed');
  assert.equal(moved.placement, 'moved');

  $('save').remove();
  for (const button of document.querySelectorAll('button')) button.remove();
  const missing = await show(saveAnchor);
  assert.equal(missing.kind, 'missing');
  assert.equal((await show({ kind: 'pdf.rect@7', fallback: 'page 3' })).kind, 'unsupported');
  assert.equal((await show({ kind: 'app.element@1', fallback: '' })).kind, 'unsupported', 'an invalid anchor is refused, not placed');
});

test('list and report data: subject labels, ages, placeable anchors, widenings and the protection notice', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const rows = listRows([{ id: 'fb_1111111111111111', path: 'feedback/fb_1111111111111111.md', status: 'open', subject: 'host:app-page:fictional-settings:%2Fsettings%2F%3Asection', created: '2026-10-05T11:55:00Z', title: 'Fictional title', author: 'p_fictional_ada' }], now);
  assert.deepEqual(rows[0], { id: 'fb_1111111111111111', title: 'Fictional title', status: 'open', where: 'fictional-settings /settings/:section', author: 'p_fictional_ada', age: '5 min ago' });
  assert.equal(subjectLabel('resource:p:x'), 'resource:p:x');
  assert.equal(ageOf('2026-10-03T12:00:00Z', now), '2 days ago');
  assert.equal(protectionNotice('protected'), undefined);
  const view = reportView({ format: 'feedback@1', id: 'fb_1111111111111111', status: 'open', created: '2026-10-05T11:55:00Z', author: { principalId: 'p_fictional_ada', display: 'Ada Fictional' },
    observed: { kind: 'host', subject: { type: 'app-page', app: 'fictional-settings', route: '/settings/:section', build: 'dev' }, snapshot: 'app.dom@1', digest: `sha256:${'a'.repeat(64)}`, policy: { version: 1, widened: ['routeOf'] } },
    anchors: [{ kind: 'app.element@1', signals: { source: 'src/Save.tsx:4', unique: [], path: [] }, snapshot: {}, fallback: 'the «Save» button' }, { kind: 'pdf.rect@7', fallback: 'page 3' }],
    said: '\n  Fictional title\nmore', resolutions: [] });
  assert.equal(view.title, 'Fictional title');
  assert.equal(view.author, 'Ada Fictional');
  assert.deepEqual(view.widened, ['routeOf']);
  assert.deepEqual(view.anchors.map(anchor => [anchor.placeable, anchor.source]), [[true, 'src/Save.tsx:4'], [false, undefined]]);
});

test('annotation only: the ./ui and ./page browser bundle holds no store, agent, source or Node code', async () => {
  const result = await build({ stdin: { contents: "export * from '@hachej/boring-feedback/ui'; export * from '@hachej/boring-feedback/page';", resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some(path => path.includes('feedback/dist/ui/')));
  assert.deepEqual(inputs.filter(path => /feedback\/dist\/(store|agent|source)\/|node:|@earendil-works|@hachej\/boring-agent|sqlite|react/.test(path)), []);
});

test('the registry sheet and Copy pass the privacy canary kit; the sheet shows the Copy text and the Save outcome', { timeout: 30000 }, async t => {
  const out = join(root, '.cache/feedback-ui-test');
  mkdirSync(out, { recursive: true });
  await build({ entryPoints: [join(root, 'registry/feedback/annotate-sheet.tsx')], outfile: join(out, 'annotate-sheet.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const window = new Window({ url: 'https://fictional.invalid/settings/profile', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { AnnotateSheet } = await import(pathToFileURL(join(out, 'annotate-sheet.mjs')).href);
  const { document } = window;
  document.body.innerHTML = '<div id="app"><header data-feedback-visible=""><h1>Fictional settings</h1></header><main></main></div><div id="ui"></div>';
  const app = document.getElementById('app');
  const result = await runPrivacyCanaries({
    page: { document, root: app.querySelector('main') },
    run: async ({ root: section, location }, emit) => {
      const elements = [section, ...section.querySelectorAll('*')];
      const { copied, copyText } = clipboard();
      const capture = await captureAnnotation({ app: 'fictional-settings', root: app, policy: createPrivacyPolicy(), location: () => location }, elements);
      const saves = [];
      const annotation = createAnnotation({ capture, copyText, said: 'A fictional note', save: async request => { saves.push(request); return { kind: 'saved', id: 'fb_1111111111111111', revision: 'r' }; } });
      const container = document.getElementById('ui');
      const reactRoot = createRoot(container);
      await act(async () => reactRoot.render(createElement(AnnotateSheet, { annotation, onClose: () => {}, near: section, protection: 'unprotected' })));
      const button = testid => container.querySelector(`[data-testid=${testid}]`);
      await act(async () => button('feedback-copy').click());
      await act(async () => button('feedback-save').click());
      assert.equal(button('feedback-status').dataset.copy, 'copied');
      assert.equal(button('feedback-status').dataset.save, 'saved');
      assert.equal(button('feedback-copy-text').textContent, copied[0]);
      assert.ok(button('feedback-protection'), 'an unprotected store is stated');
      emit('sheet', container.innerHTML);
      emit('copy', copied);
      emit('save', saves);
      emit('anchors', capture.anchors);
      emit('observed', capture.observed);
      await act(async () => reactRoot.unmount());
      return capture.refused;
    },
  });
  assert.deepEqual(result.hits, []);
  assert.ok(result.scanned > 50);
});
