import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  createPrivacyPolicy, policyRecord, titleFor, serializeElement, serializePage, accessibleNameOf, routeFor, pageDigest, canonicalJson,
  runPrivacyCanaries, defaultCanaries, CANARY_CHANNELS, MASKED_NAME, FEEDBACK_OVERLAY_ATTRIBUTE,
} from '@hachej/boring-feedback/page';

const fixture = name => readFileSync(new URL(`../fixtures/privacy/${name}`, import.meta.url), 'utf8');
const TOKEN = /zz[a-z]+qq/g;

/** A HappyDOM page with no script execution, no loading and no globals installed. */
function open(t, html) {
  const window = new Window({ url: 'https://fictional.invalid/members/4711', settings: {
    enableJavaScriptEvaluation: false, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true,
  } });
  window.document.body.innerHTML = html;
  t.after(() => window.happyDOM.close());
  return window.document;
}

/** Depth-first list of serialized nodes. */
const flatten = node => node ? [node, ...node.children.flatMap(flatten)] : [];
const find = (snapshot, predicate) => flatten(snapshot.root).find(predicate);
const policy = createPrivacyPolicy();

/** The real WP3 path: page snapshot, names of every planted element, route, title and the recorded policy. */
const realPath = active => ({ document, root, location }) => ({
  snapshot: serializePage(document.body, active),
  element: serializeElement(root, active, { subtreeLimit: 500, maxBytes: 64 * 1024 }),
  names: Array.from(root.querySelectorAll('*'), element => accessibleNameOf(element, active)),
  route: routeFor(location, active),
  title: titleFor(active) ?? null,
  policy: policyRecord(active),
});

test('the policy is frozen at version 1 and records every widening', () => {
  assert.equal(policy.version, 1);
  assert.deepEqual(policy.widened, []);
  assert.ok(Object.isFrozen(policy) && Object.isFrozen(policy.widened));
  const wide = createPrivacyPolicy({ allowAttributes: ['TITLE', 'data-testid', 'title'], visibleSelector: ' .chrome ', routeOf: () => '/x', label: 'Members' });
  assert.deepEqual(wide.widened, ['allowAttributes:title', 'visibleSelector:.chrome', 'routeOf', 'label']);
  assert.deepEqual(policyRecord(wide), { version: 1, widened: ['allowAttributes:title', 'visibleSelector:.chrome', 'routeOf', 'label'] });
  for (const name of ['value', 'placeholder', 'onclick', 'srcdoc', 'bad name']) assert.throws(() => createPrivacyPolicy({ allowAttributes: [name] }), TypeError, name);
  assert.throws(() => createPrivacyPolicy({ visibleSelector: ' ' }), TypeError);
  assert.equal(titleFor(policy), undefined, 'the document title is dropped without a label');
  assert.equal(titleFor(wide), 'Members');
});

test('attributes: only the allowlist, digit and @ values dropped, aria-label only in visible regions', t => {
  const document = open(t, fixture('canary-dense.html'));
  const snapshot = serializePage(document.body, policy);
  const card = find(snapshot, node => node.attrs['data-testid'] === 'member-card');
  assert.deepEqual(card.attrs, { 'data-feedback-id': 'member', 'data-testid': 'member-card' });
  assert.deepEqual(find(snapshot, node => node.tag === 'button' && node.attrs['data-source']).attrs,
    { 'aria-expanded': 'false', 'aria-pressed': 'true', 'data-source': 'src/MemberCard.tsx:42', type: 'button' });
  assert.deepEqual(find(snapshot, node => node.attrs.role === 'note').attrs, { role: 'note' }, 'aria-label, aria-description and data-note dropped outside a visible region');
  assert.deepEqual(find(snapshot, node => node.tag === 'nav').attrs, { 'aria-label': 'Primary' }, 'aria-label kept inside a visible region');
  assert.deepEqual(find(snapshot, node => node.tag === 'a' && node.attrs['aria-current']).attrs, { 'aria-current': 'page' }, 'href dropped');
  const spans = flatten(snapshot.root).filter(node => node.tag === 'span');
  assert.ok(spans.every(node => !('data-testid' in node.attrs) && !('data-feedback-id' in node.attrs)), 'three digits or an @ drop a kept value');
  for (const node of flatten(snapshot.root)) for (const name of Object.keys(node.attrs)) assert.ok(!/^(id|class|title|alt|style|on.*|href|src|action|value|placeholder|data-note|data-tenant)$/.test(name), name);
  assert.deepEqual(find(snapshot, node => node.tag === 'img').attrs, {});
});

test('text: masked with equal length unless an ancestor is visible', t => {
  const document = open(t, '<main><h1 data-feedback-visible>Members  overview</h1><p>Ada  Quill</p><div data-feedback-visible><p>Shown <b>bold</b></p></div></main>');
  const snapshot = serializePage(document.body, policy);
  const [h1, p, div] = snapshot.root.children[0].children;
  assert.equal(h1.text, 'Members overview');
  assert.equal(p.text, '*********', 'whitespace-normalized then masked per code point');
  assert.equal(div.children[0].text, 'Shown');
  assert.equal(div.children[0].children[0].text, 'bold');
  const selector = serializePage(document.body, createPrivacyPolicy({ visibleSelector: 'main > p' }));
  assert.equal(selector.root.children[0].children[1].text, 'Ada Quill');
});

test('form values, textarea, select and contenteditable stay masked inside a visible region; values are never read', t => {
  const document = open(t, fixture('canary-dense.html'));
  const email = document.getElementById('email');
  email.value = 'zzlivevalueqq';
  const form = document.querySelector('form');
  const snapshot = serializeElement(form, policy, { subtreeLimit: 100, maxBytes: 8192 });
  const json = canonicalJson(snapshot);
  assert.deepEqual(json.match(TOKEN), null, json);
  const nodes = flatten(snapshot.root);
  assert.equal(nodes.find(node => node.tag === 'label').text, 'Email');
  assert.equal(nodes.find(node => node.tag === 'textarea').text, '************');
  assert.equal(nodes.find(node => node.tag === 'option').text, '**************');
  assert.equal(nodes.find(node => node.attrs.type === 'submit' && node.tag === 'button').text, 'Save member');
  assert.equal(nodes.find(node => node.tag === 'div').text, '************', 'contenteditable');
});

test('ignored subtrees, the overlay, scripts, templates, shadow roots and iframe documents are omitted', t => {
  const document = open(t, fixture('canary-dense.html'));
  document.getElementById('shadow-host').attachShadow({ mode: 'open' }).innerHTML = '<p data-feedback-visible>zzshadowqq</p>';
  const snapshot = serializePage(document.body, policy);
  const tags = flatten(snapshot.root).map(node => node.tag);
  assert.ok(!tags.includes('header') && !tags.includes('script') && !tags.includes('template'));
  assert.ok(!flatten(snapshot.root).some(node => FEEDBACK_OVERLAY_ATTRIBUTE in node.attrs));
  assert.deepEqual(find(snapshot, node => node.tag === 'iframe').children, []);
  assert.equal(find(snapshot, node => node.tag === 'div' && node.children.length === 0 && node.text === '' && node.index > 0) !== undefined, true);
  assert.equal(canonicalJson(snapshot).match(TOKEN), null);
  assert.equal(serializeElement(document.querySelector('header button'), policy).root, null, 'an element inside an ignored subtree yields nothing');
  assert.equal(serializeElement(document.querySelector(`[${FEEDBACK_OVERLAY_ATTRIBUTE}] span`), policy).root, null);
});

test('accessible names come only from allowed sources, else "masked"', t => {
  const document = open(t, fixture('canary-dense.html'));
  const name = selector => accessibleNameOf(document.querySelector(selector), policy);
  assert.equal(name('nav a'), 'Members');
  assert.equal(name('nav'), 'Primary');
  assert.equal(name('button[data-source]'), MASKED_NAME, 'own text outside a visible region');
  assert.equal(name('#email'), 'Email', 'a visible label names the field; value and placeholder are never used');
  assert.equal(name('#branch'), 'Branch');
  assert.equal(name('textarea'), MASKED_NAME, 'a label wrapping a textarea would carry its content');
  assert.equal(name('[contenteditable]'), 'Draft', 'aria-label inside a visible region');
  assert.equal(name('input[type=submit]'), MASKED_NAME, 'a submit value is never read');
  assert.equal(name('[role=note]'), MASKED_NAME, 'aria-label outside a visible region');
  assert.equal(name('img'), MASKED_NAME, 'alt is dropped');
  assert.equal(name('header button'), MASKED_NAME, 'ignored chrome');
  assert.equal(name('form button[type=submit]'), 'Save member');
  const extra = open(t, '<div data-feedback-visible><span id="a">Ship</span><span id="b">now</span><button aria-labelledby="a b">x</button><button aria-labelledby="a c">y</button><button aria-label="Order 12345">z</button><button aria-label="mail me@x">w</button><label>Agree <input type="checkbox"></label><label>Name <input type="text" value="zzqq"></label></div><span id="c">secret</span>');
  const named = Array.from(extra.querySelectorAll('button, input'), element => accessibleNameOf(element, policy));
  assert.deepEqual(named, ['Ship now', MASKED_NAME, MASKED_NAME, MASKED_NAME, 'Agree', MASKED_NAME]);
});

test('routes: the template from routeOf, or every segment masked; never query or fragment', () => {
  const location = { pathname: '/members/4711/loans', search: '?q=zzqueryqq', hash: '#zzfragqq' };
  assert.equal(routeFor(location, policy), '/*******/****/*****');
  assert.equal(routeFor({ pathname: '/' }, policy), '/');
  const seen = [];
  const templated = createPrivacyPolicy({ routeOf: where => { seen.push(where); return '/members/:id/loans?leak=1#x'; } });
  assert.equal(routeFor(location, templated), '/members/:id/loans');
  assert.deepEqual(seen, [{ pathname: '/members/4711/loans', search: '', hash: '' }], 'routeOf never sees query or fragment');
  assert.equal(routeFor(location, createPrivacyPolicy({ routeOf: () => { throw new Error('no'); } })), '/*******/****/*****');
  assert.equal(routeFor(location, createPrivacyPolicy({ routeOf: () => 42 })), '/*******/****/*****');
});

test('the serializer is deterministic and the digest is the SHA-256 of canonical JSON', async t => {
  const a = open(t, '<main><p data-testid="x" role="note" aria-hidden="false">One</p></main>');
  const b = open(t, '<main><p aria-hidden="false" role="note" data-testid="x">One</p></main>');
  const first = serializePage(a.body, policy), again = serializePage(a.body, policy), other = serializePage(b.body, policy);
  assert.deepEqual(first, again);
  assert.equal(canonicalJson(first), canonicalJson(other), 'attribute source order does not matter');
  assert.deepEqual(Object.keys(find(first, node => node.tag === 'p').attrs), ['aria-hidden', 'data-testid', 'role']);
  assert.ok(Object.isFrozen(first.root.children[0]));
  const digest = await pageDigest(first);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, createHash('sha256').update(canonicalJson(first)).digest('hex'));
  assert.equal(await pageDigest(other), digest);
  a.querySelector('p').textContent = 'Three';
  assert.notEqual(await pageDigest(serializePage(a.body, policy)), digest, 'a changed masked length changes the digest');
});

test('limits are explicit and an incomplete snapshot is marked truncated', t => {
  const document = open(t, `<main>${'<section><p>row</p><p>row</p></section>'.repeat(30)}</main>`);
  const main = document.querySelector('main');
  const whole = serializePage(document.body, policy);
  assert.equal(whole.truncated, false);
  assert.equal(whole.nodes, 92);
  assert.deepEqual(whole.limits, { maxNodes: 5000, maxDepth: 64, maxBytes: 512 * 1024 });
  const element = serializeElement(main, policy);
  assert.equal(element.truncated, true);
  assert.equal(element.nodes, flatten(element.root).length);
  assert.ok(element.nodes <= 50);
  assert.ok(new TextEncoder().encode(canonicalJson(element.root)).length <= 2048);
  const few = serializeElement(main, policy, { subtreeLimit: 4 });
  assert.deepEqual(flatten(few.root).map(node => node.tag), ['main', 'section', 'p', 'p'], 'a document-order prefix');
  assert.equal(few.truncated, true);
  const shallow = serializePage(document.body, policy, { maxDepth: 1 });
  assert.equal(shallow.truncated, true);
  assert.deepEqual(flatten(shallow.root).map(node => node.tag), ['body', 'main']);
  for (const maxBytes of [0, 60, 300, 1000]) {
    const bounded = serializePage(document.body, policy, { maxBytes });
    assert.equal(bounded.truncated, true);
    assert.ok(bounded.root === null || new TextEncoder().encode(canonicalJson(bounded.root)).length <= maxBytes, String(maxBytes));
  }
  assert.equal(serializeElement(document.querySelector('p'), policy).truncated, false);
  assert.throws(() => serializePage(document.body, policy, { maxNodes: -1 }), RangeError);
  assert.equal(whole.root.children[0].children[29].index, 29, 'index counts same-tag siblings');
});

test('the canary kit passes on the default policy and the real WP3 path', async t => {
  const document = open(t, fixture('canary-dense.html'));
  document.title = 'Fictional library';
  const result = await runPrivacyCanaries({ page: { document, root: document.querySelector('main') }, run: realPath(policy) });
  assert.deepEqual(result.hits, []);
  assert.equal(result.ok, true);
  assert.ok(result.scanned > 100, `scanned ${result.scanned}`);
  assert.deepEqual(result.channels, CANARY_CHANNELS);
  assert.equal(document.querySelector('[data-feedback-canaries]'), null, 'the planted section is removed');
  assert.equal(document.title, 'Fictional library', 'the title is restored');
});

test('mutant: an attribute missing from the allowlist stays dropped', t => {
  const document = open(t, '<p data-record="zzrecordqq" data-new="zznewqq" title="zztitleqq">x</p>');
  const narrow = createPrivacyPolicy({ allowAttributes: ['data-other'] });
  assert.deepEqual(serializeElement(document.querySelector('p'), narrow).root.attrs, {});
  assert.deepEqual(narrow.widened, ['allowAttributes:data-other']);
});

test('mutant: an element outside a visible region stays masked', t => {
  const document = open(t, '<div data-feedback-visible><h2>Shown</h2></div><p>zzsecretqq</p><section data-feedback-visible="false"><p>visible by presence</p></section>');
  const snapshot = serializePage(document.body, policy);
  assert.equal(find(snapshot, node => node.tag === 'h2').text, 'Shown');
  assert.equal(snapshot.root.children[1].text, '**********');
  assert.equal(accessibleNameOf(document.querySelector('body > p'), policy), MASKED_NAME);
  assert.equal(serializePage(document.body, createPrivacyPolicy({ visibleSelector: ':::bad' })).root.children[1].text, '**********', 'an invalid selector widens nothing');
});

test('mutant: a deliberately widened canary fails the kit, and the widening is recorded', async t => {
  const document = open(t, '<main></main>');
  const page = { document, root: document.querySelector('main') };
  const title = createPrivacyPolicy({ allowAttributes: ['title'] });
  const leaked = await runPrivacyCanaries({ page, run: realPath(title) });
  assert.equal(leaked.ok, false);
  assert.deepEqual([...new Set(leaked.hits.map(hit => hit.channel))], ['title', 'title-entity']);
  assert.ok(leaked.hits.some(hit => hit.output.startsWith('$.result.snapshot.root')), JSON.stringify(leaked.hits));
  assert.ok(title.widened.includes('allowAttributes:title'));
  const region = createPrivacyPolicy({ visibleSelector: '[data-feedback-canaries]' });
  const shown = await runPrivacyCanaries({ page, run: realPath(region) });
  const channels = new Set(shown.hits.map(hit => hit.channel));
  for (const channel of ['text', 'text-entity', 'text-percent', 'labelled-by', 'aria-label', 'aria-description']) assert.ok(channels.has(channel), channel);
  for (const channel of shown.hits.map(hit => hit.channel)) assert.ok(!/value|placeholder|textarea|select|contenteditable|route|title|href|src|action/.test(channel), `${channel} must stay masked even when widened`);
  assert.ok(region.widened.includes('visibleSelector:[data-feedback-canaries]'));
});

test('mutant: a broken path is caught on every output channel, case-insensitively after decoding', async t => {
  const document = open(t, '<main></main>');
  const tokens = defaultCanaries();
  const result = await runPrivacyCanaries({ page: { document }, run: ({ document: doc, root, location }, emit) => {
    emit('label', doc.title.toUpperCase());
    emit('route', location.pathname);
    emit('fallback', encodeURIComponent(location.search));
    emit('report', { said: `&#x${tokens.textarea.charCodeAt(0).toString(16)};${tokens.textarea.slice(1)}`, [location.hash]: true });
    return [root.querySelector('input').value, root.querySelector('[contenteditable]').textContent];
  } });
  const found = Object.fromEntries(result.hits.map(hit => [hit.channel, hit.output]));
  assert.deepEqual(found, {
    textarea: '$.report.said', 'input-value': '$.result[0]', contenteditable: '$.result[1]', 'document-title': '$.label',
    'route-segment': '$.route', 'route-percent': '$.route', 'route-query': '$.fallback', 'route-fragment': '$.report.<key #xqroutefragmentvz>',
  });
  assert.equal(result.ok, false);
});

test('the Northwind Console copy with nothing marked visible: all text masked, no readable names, no leaks', async t => {
  const document = open(t, fixture('northwind-console.html'));
  const snapshot = serializePage(document.body, policy);
  assert.ok(flatten(snapshot.root).every(node => /^\**$/.test(node.text)));
  const interactive = Array.from(document.querySelectorAll('button, a[href], input, select, textarea'));
  assert.equal(interactive.length, 14);
  assert.ok(interactive.every(element => accessibleNameOf(element, policy) === MASKED_NAME));
  const result = await runPrivacyCanaries({ page: { document, root: document.querySelector('main') }, run: realPath(policy) });
  assert.deepEqual(result.hits, []);
});

test('data-source keeps a project-relative path:line at any line number and drops anything else', async () => {
  const { SOURCE_LOCATION } = await import('@hachej/boring-feedback/page');
  for (const ok of ['src/SaveBar.tsx:6', 'src/cards/Card.tsx:142', 'app/routes/orders.$id.tsx:1203', 'app/[slug]/(group)/page.tsx:12', 'Main.jsx:9'])
    assert.ok(SOURCE_LOCATION.test(ok), ok);
  for (const bad of ['/home/me/app/src/A.tsx:12', 'C:/app/A.tsx:3', '../secret/A.tsx:3', 'src/../x/A.tsx:4', 'https://x.test/A.tsx:1', 'src/A.tsx', 'src/A.tsx:0', 'src/notes.txt:12', 'src/a@b.tsx:1', 'src/A.tsx:12;alert(1)'])
    assert.ok(!SOURCE_LOCATION.test(bad), bad);
});
