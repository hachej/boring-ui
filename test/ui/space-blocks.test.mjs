// SpaceCard and WiringChips bundled as an app bundles them (see attention-blocks.test.mjs for the pattern): rendered to static markup.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const shadcn = join(root, 'examples/app-shell/components/ui');
const utils = join(root, 'examples/app-shell/lib/utils.ts');

const entry = `
import { renderToStaticMarkup as r } from 'react-dom/server';
import { createElement as h } from 'react';
import { SpaceCard } from '${join(root, 'registry/space-card/space-card.tsx')}';
import { StatusNarrative } from '${join(root, 'registry/status-narrative/status-narrative.tsx')}';
import { runInNewContext } from 'node:vm';
import { WiringChips } from '${join(root, 'registry/wiring-chips/wiring-chips.tsx')}';
const on = () => {};
export const html = {
  busy: () => r(h(SpaceCard, { name: 'Studio', activity: { working: 2, waiting: 1 }, lastShip: '2h ago', onOpen: on })),
  quiet: () => r(h(SpaceCard, { name: 'Reports', activity: { working: 0, waiting: 0 }, lastShip: '3d ago' })),
  unknown: () => r(h(SpaceCard, { name: 'Calendar sync', activity: 'unknown', lastShip: '3d ago' })),
  noShip: () => r(h(SpaceCard, { name: 'Compta', activity: { working: 1, waiting: 0 } })),
  shipDate: () => r(h(SpaceCard, { name: 'Studio', activity: { working: 1, waiting: 0 }, lastShip: new Date(new Date().getFullYear(), 10, 6, 12) })),
  shipOld: () => r(h(SpaceCard, { name: 'Studio', activity: { working: 1, waiting: 0 }, lastShip: new Date(2020, 10, 6, 12) })),
  shipForeign: () => r(h(SpaceCard, { name: 'Studio', activity: { working: 1, waiting: 0 }, lastShip: runInNewContext('new Date(' + new Date(new Date().getFullYear(), 10, 6, 12).getTime() + ')') })),
  narrativeForeign: () => r(h(StatusNarrative, { segments: ['Studio is calm.'], at: runInNewContext('new Date(' + new Date(new Date().getFullYear(), 10, 6, 12).getTime() + ')') })),
  shipInvalid: () => r(h(SpaceCard, { name: 'Studio', activity: { working: 1, waiting: 0 }, lastShip: new Date('nope') })),
  narrative: () => r(h(StatusNarrative, { segments: ['Studio is calm.'], at: new Date(new Date().getFullYear(), 10, 6, 12) })),
  narrativeOld: () => r(h(StatusNarrative, { segments: ['Studio is calm.'], at: new Date(2020, 10, 6, 12) })),
  fr: () => r(h(SpaceCard, { name: 'Compta', activity: { working: 0, waiting: 0 }, labels: { quiet: 'Calme' } })),
  chips: () => r(h(WiringChips, { chips: [{ label: 'notes.demo.boringbots.ai', state: 'ok' }, { label: 'Calendar needs sign-in', state: 'warn' }, { label: 'Slack', state: 'unknown' }] })),
  chipNoState: () => r(h(WiringChips, { chips: [{ label: 'Slack' }] })),
  chipsFr: () => r(h(WiringChips, { chips: [{ label: 'Slack', state: 'unknown' }], labels: { unknown: 'illisible' } })),
};
`;

const dir = mkdtempSync(join(tmpdir(), 'space-blocks-'));
const outfile = join(dir, 'bundle.cjs');
const plugin = {
  name: 'app-aliases',
  setup(b) {
    b.onResolve({ filter: /^@\/components\/ui\/(.+)$/ }, args => ({ path: join(shadcn, `${args.path.split('/').pop()}.tsx`) }));
    b.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({ path: utils }));
  },
};
await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx', sourcefile: join(dir, 'entry.tsx') }, bundle: true, format: 'cjs', platform: 'node', outfile, write: true, logLevel: 'silent', jsx: 'automatic', plugins: [plugin], absWorkingDir: root });
const { html } = createRequire(import.meta.url)(outfile);
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a busy space shows working and waiting counts, the last ship, and is a button when it can open', () => {
  const markup = html.busy();
  assert.match(markup, /<button/); assert.match(markup, />2<\/b>/); assert.match(markup, />1<\/b>/);
  assert.match(markup, /wait on you/); assert.match(markup, /Last ship 2h ago/); assert.doesNotMatch(markup, /Quiet/);
});

test('a space with nothing working or waiting reads Quiet, and is static without onOpen', () => {
  const markup = html.quiet();
  assert.match(markup, /Quiet/); assert.doesNotMatch(markup, /<button/); assert.doesNotMatch(markup, /working/);
  assert.match(html.fr(), /Calme/);
});

test('an unreadable space is never shown as Quiet and hides the last ship', () => {
  const markup = html.unknown();
  assert.match(markup, /Status unreadable/); assert.doesNotMatch(markup, /Quiet/); assert.doesNotMatch(markup, /Last ship/);
});

test('the last ship is optional', () => {
  assert.doesNotMatch(html.noShip(), /Last ship/);
});

const timeText = markup => /<time[^>]*>([^<]*)<\/time>/.exec(markup)?.[1];

test('a Date last ship is formatted by the kit, the same text StatusNarrative prints for the same Date', () => {
  const card = html.shipDate();
  const short = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(new Date().getFullYear(), 10, 6, 12));
  const withYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(2020, 10, 6, 12));
  assert.equal(timeText(card), short);
  assert.match(card, />Last ship </);
  assert.equal(timeText(card), timeText(html.narrative()));
  assert.equal(timeText(html.shipOld()), withYear);
  assert.equal(timeText(html.shipOld()), timeText(html.narrativeOld()));
});

test('a Date from another realm (an iframe) is formatted, not crashed on', () => {
  const same = timeText(html.shipDate());
  assert.equal(timeText(html.shipForeign()), same);
  assert.equal(timeText(html.narrativeForeign()), same);
});

test('an invalid Date last ship is absent: no throw, no "Invalid Date"', () => {
  assert.doesNotMatch(html.shipInvalid(), /Invalid Date|Last ship|<time/);
});

test('a string last ship still renders as given', () => {
  assert.match(html.busy(), /Last ship 2h ago/); assert.doesNotMatch(html.busy(), /<time/);
});

test('wiring chips carry a state dot and a spoken state for anything but ok', () => {
  const markup = html.chips();
  assert.equal((markup.match(/<li/g) ?? []).length, 3);
  assert.match(markup, /bg-success/); assert.match(markup, /bg-warning/);
  assert.match(markup, /sr-only">needs attention</); assert.match(markup, /sr-only">not readable</);
  assert.equal((markup.match(/sr-only/g) ?? []).length, 2, 'ok says nothing extra');
  assert.match(html.chipsFr(), /illisible/);
});

test('space blocks never fetch or touch storage', () => {
  for (const file of ['registry/space-card/space-card.tsx', 'registry/wiring-chips/wiring-chips.tsx']) {
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /\bfetch\s*\(|XMLHttpRequest|useEffect|localStorage|Date\.now|new Date/);
  }
});

test('a chip with no state reads as unknown, never ok', () => {
  const markup = html.chipNoState();
  assert.doesNotMatch(markup, /bg-success/); assert.match(markup, /bg-muted-foreground/); assert.match(markup, /sr-only">not readable</);
});
