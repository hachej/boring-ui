// The expert-overview block bundled as an app bundles it (the `@/components/ui` names resolve to the shadcn fixtures) and rendered in
// happy-dom, so a press is a real click. Props in, callbacks out; fictional data only. Happy-dom measures nothing: the 390 px fit, the 44 px
// floor and the contrast are the scenario's (ux/scenarios/component-expert-overview.json).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(join(root, 'registry/expert-overview/expert-overview.tsx'), 'utf8');
const shadcn = join(root, 'examples/app-shell/components/ui');
const alias = {
  name: 'app-aliases',
  setup(b) {
    b.onResolve({ filter: /^@\/components\/ui\/(.+)$/ }, args => ({ path: join(shadcn, `${args.path.split('/').pop()}.tsx`) }));
    b.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({ path: join(root, 'examples/app-shell/lib/utils.ts') }));
  },
};

// The DOM globals are installed by the first test and removed by the last, never at import: the tests of a shard may share one process.
const out = new URL('../../.cache/expert-overview/', import.meta.url);
mkdirSync(out, { recursive: true });
const bundle = new URL('block.mjs', out);
await build({ entryPoints: [join(root, 'registry/expert-overview/expert-overview.tsx')], bundle: true, packages: 'external', format: 'esm', platform: 'node', outfile: bundle.pathname, logLevel: 'silent', jsx: 'automatic', plugins: [alias], absWorkingDir: root });
const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
const { createElement: h, act } = await import('react');
let window, saved, mounted, host, ExpertOverview, ExpertTrack, expertOverviewLabels;
const boot = async () => {
  if (window) return;
  window = new Window({ url: 'https://fictional.invalid/' });
  saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const given = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof given === 'function' && /^[a-z]/.test(name) ? given.bind(window) : given });
  }
  const { createRoot } = await import('react-dom/client');
  ({ ExpertOverview, ExpertTrack, expertOverviewLabels } = await import(bundle.href));
  host = document.createElement('div');
  document.body.append(host);
  mounted = createRoot(host);
};
const draw = async view => { await boot(); await act(async () => mounted.render(view)); };
const press = async element => { await act(async () => { element.click(); }); };
const tokens = element => String(element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const text = () => host.textContent;
const buttons = (scope = host) => [...scope.querySelectorAll('button')];
const named = label => buttons().filter(button => button.getAttribute('aria-label') === label || (!button.hasAttribute('aria-label') && button.textContent.trim() === label));

const calls = [];
const act1 = name => () => calls.push(name);
const item = (id, extra = {}) => ({ id, text: `Sentence ${id}.`, action: { label: `Open ${id}`, onAction: act1(`open-${id}`) }, ...extra });
const question = id => item(id, { later: { onLater: act1(`later-${id}`) } });
const apps = [{ id: 'a', name: 'Atelier', line: '3 features · next for you: Thursday', onOpen: act1('app-a') }, { id: 'd', name: 'Devis', unreadable: true }];
const done = { label: 'Done · 2 live this month', items: [{ id: 'x', title: 'Price list', meta: 'Live since 4 Nov' }, { id: 'y', title: 'Quote page' }], onOpenItem: id => calls.push(`done-${id}`) };
const overview = (props = {}) => h(ExpertOverview, { heading: 'Good evening', intro: 'Two small things.', needsYou: [item('1'), question('2')], apps, done, ...props });
const four = ['Framed', 'Proven', 'Rehearsed', 'Accepted'].map(label => ({ id: label.toLowerCase(), label }));
const features = [
  { id: 'f1', title: 'Quote letters', status: 'Ready for you to try', reached: 3, turn: 'person', line: 'Pick up where you left off', action: { label: 'Open', onAction: act1('feature-f1') } },
  { id: 'f2', title: 'Client summary', status: 'Agents proving it', reached: 1, turn: 'agents', line: 'Ready for you around Thursday' },
  { id: 'f3', title: 'Search past letters', status: 'Framed', reached: 1, turn: 'nobody', line: 'Waits until you finish « Quote letters »' },
];
const track = (props = {}) => h(ExpertTrack, { title: 'Atelier', subtitle: 'Release R0 · 3 features', steps: four, note: 'You act first and last.', features, onBack: act1('back'), done, extra: { label: 'Something else is wrong', onAction: act1('extra') }, ...props });

test('the block reads no clock, fetches nothing, stores nothing and sends nothing by itself', async () => {
  await boot();
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|useEffect|localStorage|sessionStorage|indexedDB|document\.cookie|Date\.now|new Date\b/);
});

test('For you: five items show the first three; no box, badge, count or destructive colour', async () => {
  await draw(overview({ needsYou: ['1', '2', '3', '4', '5'].map(id => item(id)) }));
  const rows = [...host.querySelectorAll('[data-testid=expert-item]')];
  assert.equal(rows.length, 3);
  assert.match(text(), /Sentence 1\./); assert.match(text(), /Sentence 3\./);
  assert.doesNotMatch(text(), /Sentence 4\.|Sentence 5\./);
  const classes = [...host.querySelectorAll('*')].flatMap(tokens).filter(name => !name.includes('aria-invalid'));
  assert.equal(classes.some(name => /destructive|^badge$/.test(name)), false, 'no destructive tone, no badge');
  assert.doesNotMatch(source, /destructive|Badge|badge/, 'the block never names them');
  assert.equal(host.querySelector('[data-slot=badge]'), null);
  for (const row of rows) assert.equal(tokens(row).some(name => /^(bg-|border|shadow|ring)/.test(name) && !row.matches('button')), false, 'an item is not a box');  assert.equal(host.querySelectorAll('h1').length, 1);
  assert.match(host.querySelector('h1').textContent, /Good evening/);
  assert.match(text(), /Two small things\./);
});

test('an item without `later` is one row-wide button named by its action; with `later` it has two buttons and is not itself a button', async () => {
  calls.length = 0;
  await draw(overview());
  const [plain, asked] = [...host.querySelectorAll('[data-testid=expert-item]')];
  assert.equal(plain.tagName, 'BUTTON');
  assert.equal(plain.getAttribute('aria-label'), 'Open 1');
  assert.ok(document.getElementById(plain.getAttribute('aria-describedby')).textContent.includes('Sentence 1.'), 'the sentence still describes the button');
  assert.doesNotMatch(plain.textContent, /Open 1/, 'no visible gesture word on a row');
  assert.ok(plain.querySelector('svg'), 'a caret ends the row');
  assert.equal(asked.tagName, 'DIV');
  assert.deepEqual(buttons(asked).map(button => button.textContent.trim()), ['Open 2', 'Later']);
  await press(plain);
  assert.deepEqual(calls, ['open-1']);
  await press(buttons(asked)[1]);
  assert.deepEqual(calls, ['open-1', 'later-2']);
  await press(buttons(asked)[0]);
  assert.deepEqual(calls, ['open-1', 'later-2', 'open-2']);
});

test('the « Later » word comes from `later.label` first, then the labels', async () => {
  await draw(overview({ needsYou: [item('1', { later: { label: 'Plus tard', onLater() {} } })] }));
  assert.ok(named('Plus tard').length === 1);
});

test('apps: one line each, a caret and a button only with `onOpen`, unreadable said in words, an app with nothing to say throws naming `line`', async () => {
  calls.length = 0;
  await draw(overview());
  const [atelier, devis] = [...host.querySelectorAll('[data-testid=expert-app]')];
  assert.equal(atelier.tagName, 'BUTTON'); assert.ok(atelier.querySelector('svg'));
  assert.match(atelier.textContent, /3 features · next for you: Thursday/);
  assert.equal(devis.tagName, 'DIV'); assert.equal(devis.querySelector('svg'), null); assert.equal(buttons(devis).length, 0);
  assert.match(devis.textContent, /Status unreadable/);
  assert.match(text(), /In progress/);
  await press(atelier);
  assert.deepEqual(calls, ['app-a']);
  const failing = console.error; console.error = () => {};
  try {
    await assert.rejects(async () => draw(overview({ apps: [{ id: 'z', name: 'Vide' }] })), /line/);
  } finally { console.error = failing; }
});

test('done is folded until « Show » and folds again with « Hide »; its items open through `onOpenItem`', async () => {
  calls.length = 0;
  await draw(overview());
  assert.doesNotMatch(text(), /Price list/);
  const fold = buttons().find(button => button.textContent.includes('Done · 2 live this month'));
  assert.equal(fold.getAttribute('aria-expanded'), 'false'); assert.match(fold.textContent, /Show/);
  await press(fold);
  assert.match(text(), /Price list/); assert.match(text(), /Live since 4 Nov/); assert.match(fold.textContent, /Hide/);
  assert.equal(fold.getAttribute('aria-expanded'), 'true');
  await press(buttons().find(button => button.textContent.includes('Price list')));
  assert.deepEqual(calls, ['done-x']);
  await press(fold);
  assert.doesNotMatch(text(), /Price list/);
});

test('calm: nothing needs the person, so the calm heading and text replace the heading and intro', async () => {
  await draw(overview({ needsYou: [], calm: { heading: 'Nothing needs you', text: 'It will show here when it is ready.' } }));
  assert.equal(host.querySelector('[data-testid=expert-item]'), null);
  assert.match(host.querySelector('h1').textContent, /Nothing needs you/);
  assert.match(text(), /It will show here when it is ready\./);
  assert.doesNotMatch(text(), /Good evening|Two small things/);
  assert.match(text(), /Atelier/); assert.match(text(), /Done · 2 live/);
  await draw(overview({ needsYou: [] }));
  assert.equal(host.querySelector('h1').textContent, expertOverviewLabels.calmHeading);
  assert.equal(host.querySelectorAll('p').length, 0, 'no sentence without `calm.text`');
});

test('track: segment tokens by turn, status tones, said progress, back, extra', async () => {
  calls.length = 0;
  await draw(track());
  const rows = [...host.querySelectorAll('[data-testid=expert-feature]')];
  const segments = row => [...row.querySelectorAll('[data-segment]')].map(segment => tokens(segment).find(name => /^bg-/.test(name)));
  const [one, two, three] = ['bg-info', 'bg-[color-mix(in_oklab,var(--info),var(--success))]', 'bg-success'];
  assert.deepEqual(segments(rows[0]), [one, two, three, 'bg-warning-soft']);
  assert.deepEqual(segments(rows[1]), [one, 'bg-muted-foreground', 'bg-border', 'bg-border']);
  assert.deepEqual(segments(rows[2]), [one, 'bg-border', 'bg-border', 'bg-border']);
  const words = [...host.querySelectorAll('ol li')].map(li => tokens(li).find(name => /^text-/.test(name)));
  assert.equal(new Set(words).size, 4, 'each step word has its own colour');
  assert.ok(words.every(name => !/destructive|red/.test(name)), 'no red');
  assert.equal(rows[0].getAttribute('aria-label'), 'Quote letters: Ready for you to try, 3 of 4 steps done');
  assert.equal(rows[2].getAttribute('aria-label'), 'Search past letters: Framed, 1 of 4 steps done');
  const status = row => tokens([...row.querySelectorAll('span')].find(span => span.textContent === row.getAttribute('aria-label').split(': ')[1].split(',')[0]));
  assert.ok(status(rows[0]).includes('text-warning-soft-foreground'));
  assert.ok(status(rows[1]).includes('text-muted-foreground') && !status(rows[1]).includes('text-warning-soft-foreground'));
  assert.deepEqual([...host.querySelectorAll('ol li')].map(li => li.textContent), ['Framed', 'Proven', 'Rehearsed', 'Accepted']);
  assert.match(text(), /You act first and last\./);
  assert.match(text(), /Atelier/); assert.match(text(), /Release R0 · 3 features/);
  assert.match(buttons()[0].textContent, /Back/);
  await press(buttons()[0]); await press(named('Something else is wrong')[0]); await press(named('Open')[0]);
  assert.deepEqual(calls, ['back', 'extra', 'feature-f1']);
  await draw(track({ features: [{ ...features[0], reached: 4 }] }));
  assert.deepEqual([...host.querySelectorAll('[data-segment]')].map(segment => tokens(segment).find(name => /^bg-/.test(name))), ['bg-info', 'bg-[color-mix(in_oklab,var(--info),var(--success))]', 'bg-success', 'bg-[color-mix(in_oklab,var(--success),var(--warning))]']);
  await draw(track({ extra: undefined, onBack: undefined, done: undefined }));
  assert.equal(named('Something else is wrong').length, 0); assert.doesNotMatch(text(), /Back|Done ·/);
});

test('track: three or five steps throw naming `steps`', async () => {
  const failing = console.error; console.error = () => {};
  try {
    for (const steps of [four.slice(0, 3), [...four, { id: 'x', label: 'Extra' }]]) await assert.rejects(async () => draw(track({ steps })), /steps/);
  } finally { console.error = failing; }
});

test('French labels for every key leave no English word of the block in the markup', async () => {
  const fr = { inProgress: 'En cours', later: 'Plus tard', show: 'Voir', hide: 'Masquer', unreadable: 'Statut illisible', calmHeading: 'Rien ne vous attend', back: 'Retour', progress: (reached, total) => `${reached} étapes sur ${total}` };
  const english = /\b(?:In progress|Later|Show|Hide|unreadable|Nothing needs you|Back|steps done)\b/;
  await draw(overview({ labels: fr, needsYou: [{ id: 'q', text: 'Une phrase.', action: { label: 'Répondre', onAction() {} }, later: { onLater() {} } }] }));
  assert.match(text(), /En cours/); assert.match(text(), /Plus tard/); assert.match(text(), /Statut illisible/); assert.match(text(), /Voir/);
  assert.doesNotMatch(text() + host.innerHTML.replace(/class="[^"]*"/g, ''), english);
  await draw(overview({ labels: fr, needsYou: [] }));
  assert.match(host.querySelector('h1').textContent, /Rien ne vous attend/);
  await draw(track({ labels: fr }));
  assert.match(buttons()[0].textContent, /Retour/);
  assert.equal(host.querySelector('[data-testid=expert-feature]').getAttribute('aria-label'), 'Quote letters: Ready for you to try, 3 étapes sur 4');
});

test('the DOM globals are given back as they were found', async () => {
  await act(async () => mounted.unmount());
  await window.happyDOM.close();
  for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  assert.equal(typeof globalThis.matchMedia, saved.get('matchMedia') ? 'function' : 'undefined');
  assert.equal(globalThis.IS_REACT_ACT_ENVIRONMENT, saved.get('IS_REACT_ACT_ENVIRONMENT')?.value);
});
