import assert from 'node:assert/strict';
import test from 'node:test';
import { ANCHOR_CONFORMANCE_VERDICT, runAnchorConformance } from '@hachej/boring-ui-kit/anchor-conformance';
import {
  anchorOf, appElementResolution, appElementSchema, fallbackOf, rangeOf, resolveAppElement, revealElement, APP_ELEMENT_KIND,
  createPrivacyPolicy, serializePage, pageDigest, runPrivacyCanaries, FEEDBACK_IGNORE_ATTRIBUTE, FEEDBACK_OVERLAY_ATTRIBUTE,
} from '@hachej/boring-feedback/page';
import { CORPUS_NAME, appCorpus } from '../fixtures/anchors/app/corpus.mjs';
import { buildAppCorpus, openPage } from '../fixtures/anchors/app/build.mjs';

const policy = createPrivacyPolicy();
const REQUIRED_GROUPS = ['identity', 'duplicate', 'reorder', 'source', 'look-alike', 'text', 'truncated', 'unknown-kind'];

function page(t, html) {
  const opened = openPage(html);
  t.after(() => opened.window.happyDOM.close());
  return opened;
}

const capture = (element, root, options = {}) => anchorOf(element, policy, { root, ...options });
function captured(element, root, options) {
  const result = capture(element, root, options);
  assert.equal(result.kind, 'captured', result.reason);
  return result.anchor;
}

test(`app.element@1 passes the ${CORPUS_NAME} corpus with zero wrong spots`, async () => {
  const cases = await buildAppCorpus();
  const report = runAnchorConformance({ resolution: appElementResolution, cases });
  assert.deepEqual(report.results.flatMap(result => result.failures), []);
  assert.equal(report.passed, true);
  assert.equal(report.wrongSpots, 0);
  assert.equal(report.verdict, ANCHOR_CONFORMANCE_VERDICT);
  assert.deepEqual(Object.keys(report.rates).sort(), [...REQUIRED_GROUPS].sort());
  assert.equal(cases.length, appCorpus.length);
  // Rates are reported, never thresholded; structure alone never places.
  for (const group of ['duplicate', 'source', 'look-alike', 'text', 'truncated']) assert.equal(report.rates[group].automatic, 0, group);
  assert.ok(report.rates.identity.placements.exact > 0 && report.rates.identity.placements.moved > 0);
  assert.equal(report.rates['unknown-kind'].placements.unsupported, 1);
  // Every step resolves a real, distinct page digest.
  for (const item of cases) for (const step of item.steps) assert.match(step.evaluated, /^[0-9a-f]{64}$/);
});

test('mutants fail the corpus: a nearest-candidate guesser and a resolver that trusts truncated snapshots', async () => {
  const cases = await buildAppCorpus();
  const guesser = {
    ...appElementResolution,
    resolve(anchor, snapshot, evaluated) {
      const placement = resolveAppElement(anchor, snapshot, evaluated);
      return placement.kind === 'ambiguous' ? { kind: 'moved', range: placement.candidates.at(-1), evaluated } : placement;
    },
  };
  const guessed = runAnchorConformance({ resolution: guesser, cases });
  assert.ok(guessed.wrongSpots > 0);
  assert.notEqual(guessed.verdict, ANCHOR_CONFORMANCE_VERDICT);
  const trusting = { ...appElementResolution, resolve: (anchor, snapshot, evaluated) => resolveAppElement(anchor, { ...snapshot, truncated: false }, evaluated) };
  const trusted = runAnchorConformance({ resolution: trusting, cases });
  assert.equal(trusted.passed, false);
  assert.ok(trusted.rates.truncated.wrongSpots > 0, 'an automatic placement on a truncated snapshot counts as a wrong spot');
});

test('capture refuses ignored subtrees, the overlay, shadow roots, iframes, portals, detached and truncated-away elements', t => {
  const { document } = page(t, `<div id="app"><main><button>Save</button><div ${FEEDBACK_IGNORE_ATTRIBUTE}><button>Chrome</button></div>
    <div id="host"></div></main></div><div id="portal"><button>Portal</button></div><div ${FEEDBACK_OVERLAY_ATTRIBUTE}><span>Label</span></div>`);
  const app = document.getElementById('app');
  const shadow = document.getElementById('host').attachShadow({ mode: 'open' });
  shadow.innerHTML = '<button>Inside</button>';
  const reason = (element, options) => { const result = capture(element, app, options); assert.equal(result.kind, 'refused'); return result.reason; };
  assert.match(reason(document.querySelector(`[${FEEDBACK_IGNORE_ATTRIBUTE}] button`)), /ignored subtree/);
  assert.match(reason(document.querySelector(`[${FEEDBACK_OVERLAY_ATTRIBUTE}] span`)), /overlay/);
  assert.match(reason(shadow.querySelector('button')), /shadow root/);
  assert.match(reason(document.querySelector('#portal button')), /portal/);
  assert.match(reason(document.createElement('button')), /not in the page/);
  const other = page(t, '<button>Framed</button>');
  assert.match(reason(other.document.querySelector('button')), /iframe/);
  const lastButton = app.querySelector('main > button');
  const tiny = serializePage(app, policy, { maxNodes: 2 });
  assert.equal(tiny.truncated, true);
  assert.equal(reason(lastButton, { page: tiny }).includes('truncated'), true);
  assert.equal(capture(lastButton, app).kind, 'captured', 'the same element is captured from a complete snapshot');
});

test('signals come only through the policy: dropped attributes, masked names and refused source paths never appear', t => {
  const { document, root } = page(t, `<main>
    <form><div><button id="secret-id" class="secret-class" title="secret-title" data-record="secret-data" data-testid="member-4711" data-source="/home/fictional/App.tsx:3">Delete member</button></div></form>
    <div data-feedback-visible><button data-source="src/settings/SaveBar.tsx:42" data-testid="save-settings">Save</button></div>
  </main>`);
  const masked = captured(document.querySelector('form button'), root);
  assert.deepEqual(masked.signals, { unique: [], role: 'button', path: ['main', 'form:nth-of-type(1)', 'div:nth-of-type(1)', 'button:nth-of-type(1)'] });
  assert.equal(masked.fallback, 'a masked button in main › form');
  assert.doesNotMatch(JSON.stringify(masked), /secret|4711|home|Delete/);
  const visible = captured(document.querySelector('[data-feedback-visible] button'), root);
  assert.deepEqual(visible.signals, {
    testId: 'save-settings', unique: ['testId'], source: 'src/settings/SaveBar.tsx:42', sourceIndex: 0, role: 'button', name: 'Save',
    path: ['main', 'div:nth-of-type(1)', 'button:nth-of-type(1)'],
  });
  assert.equal(visible.fallback, 'the «Save» button (SaveBar.tsx:42)');
  assert.equal(visible.kind, APP_ELEMENT_KIND);
  assert.deepEqual(visible.snapshot, { tag: 'button', attrs: { 'data-source': 'src/settings/SaveBar.tsx:42', 'data-testid': 'save-settings' }, text: 'Save', children: [], index: 0 });
});

test('the privacy canaries find nothing in anchors, fallbacks and placements from the capture path', async t => {
  const { document } = page(t, '<main><p>Fictional page</p></main>');
  const result = await runPrivacyCanaries({
    page: { document, root: document.querySelector('main') },
    run: async ({ document: doc }, emit) => {
      const root = doc.body;
      const snapshot = serializePage(root, policy);
      const evaluated = await pageDigest(snapshot);
      let count = 0;
      for (const element of [root, ...root.querySelectorAll('*')]) {
        const outcome = anchorOf(element, policy, { root, page: snapshot });
        emit(`capture${count}`, outcome);
        if (outcome.kind !== 'captured') continue;
        count++;
        emit(`fallback${count}`, appElementResolution.fallback(outcome.anchor));
        emit(`placement${count}`, appElementResolution.resolve(outcome.anchor, snapshot, evaluated));
      }
      assert.ok(count > 30, `captured ${count} planted elements`);
      return count;
    },
  });
  assert.deepEqual(result.hits, []);
  assert.equal(result.ok, true);
  assert.ok(result.scanned > 100);
});

test('anchors stay within 4 KiB with snapshots within 2 KiB; the schema round-trips and refuses bad shapes', t => {
  const rows = Array.from({ length: 80 }, (_, index) => `<li data-testid="row-${'abcdefghij'[index % 10]}">Row text</li>`).join('');
  const { document, root } = page(t, `<main><ul data-feedback-id="big-list">${rows}</ul></main>`);
  const anchor = captured(document.querySelector('ul'), root);
  assert.ok(new TextEncoder().encode(JSON.stringify(anchor)).length <= 4096);
  assert.ok(new TextEncoder().encode(JSON.stringify(anchor.snapshot)).length <= 2048);
  assert.deepEqual(appElementSchema.parse(JSON.parse(JSON.stringify(anchor))), anchor);
  const bad = [
    { ...anchor, extra: 1 },
    { ...anchor, kind: 'app.element@2' },
    { ...anchor, fallback: ' ' },
    { ...anchor, signals: { ...anchor.signals, name: 'masked' } },
    { ...anchor, signals: { ...anchor.signals, unique: ['testId'] } },
    { ...anchor, box: [1, 2, 3] },
  ];
  for (const value of bad) assert.throws(() => appElementSchema.parse(value), TypeError);
});

test('fallback wording uses allowed parts only', () => {
  assert.equal(fallbackOf({ unique: [], role: 'button', name: 'Save', source: 'src/settings/SaveBar.tsx:42', path: ['main', 'button:nth-of-type(1)'] }, 'button'), 'the «Save» button (SaveBar.tsx:42)');
  assert.equal(fallbackOf({ unique: [], role: 'button', path: ['main', 'form:nth-of-type(1)', 'div:nth-of-type(3)', 'button:nth-of-type(1)'] }, 'button'), 'a masked button in main › form');
  assert.equal(fallbackOf({ feedbackId: 'row', unique: ['feedbackId'], role: 'textbox', path: ['[data-feedback-id="card"]', 'input:nth-of-type(1)'] }, 'input'), 'a masked text field «row» in «card»');
  assert.equal(fallbackOf({ unique: [], path: ['body', 'div:nth-of-type(1)'] }, 'div'), 'a masked div element in body');
});

test('reveal finds the live element for a placement and returns stale when the page changed', async t => {
  const html = '<main><form><div><button data-feedback-id="save-settings">Save</button></div></form></main>';
  const { document, root } = page(t, html);
  const element = document.querySelector('button');
  const anchor = captured(element, root);
  const snapshot = serializePage(root, policy);
  const placement = resolveAppElement(anchor, snapshot, await pageDigest(snapshot));
  assert.equal(placement.kind, 'exact');
  assert.deepEqual(rangeOf(element, root, snapshot), placement.range);
  let scrolled = 0;
  element.scrollIntoView = () => { scrolled++; };
  const revealed = revealElement(placement.range, root, snapshot, policy);
  assert.equal(revealed.kind, 'revealed');
  assert.equal(revealed.element, element);
  assert.equal(scrolled, 1);

  const mutations = {
    'element removed': live => live.remove(),
    'sibling inserted before': live => live.before(document.createElement('button')),
    'identity changed': live => live.setAttribute('data-feedback-id', 'other'),
    'text changed': live => { live.textContent = 'Saved!'; },
    'ancestor replaced': live => live.closest('form').replaceWith(document.createElement('form')),
    'moved into an ignored subtree': live => live.parentElement.setAttribute(FEEDBACK_IGNORE_ATTRIBUTE, ''),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    root.innerHTML = html;
    const live = root.querySelector('button');
    const atResolve = serializePage(root, policy);
    const range = rangeOf(live, root, atResolve);
    assert.equal(revealElement(range, root, atResolve, policy).kind, 'revealed', name);
    mutate(live);
    const result = revealElement(range, root, atResolve, policy);
    assert.equal(result.kind, 'stale', name);
    assert.equal(typeof result.reason, 'string');
  }
});
