import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { site } from '../ux/runner/site.mjs';

// The site is one top bar (page menu, Phone and Desktop switch, theme switch) over the app in a frame, with the design system as the default page.
test('every demo page is a top bar over a frame, the home is the design system, and the menu lists the pages', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ux-home-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const from = join(dir, 'cap'), out = join(dir, 'site'), names = ['component-design-system', 'layout-bar', 'component-reply-card'];
  mkdirSync(join(from, '_pages'), { recursive: true });
  const scenarios = names.map(name => {
    const [level, id] = [name.split('-')[0], name.split('-').slice(1).join('-')], target = `${level}:${id}`;
    mkdirSync(join(from, name), { recursive: true });
    writeFileSync(join(from, '_pages', `${name}.html`), '<!doctype html><head><title>Demo</title></head><body>app</body>');
    writeFileSync(join(from, name, 'result.json'), JSON.stringify({ target, states: [], stateFailures: [], errors: [], flows: [] }));
    writeFileSync(join(from, name, 'target.json'), JSON.stringify({ target, title: id, purpose: 'A page.', level, kitVersion: '0.0.0', commit: 'abc1234', capturedAt: '2026-01-01T00:00:00Z' }));
    return { target, title: id, purpose: 'A page.', fixture: { entry: 'x.jsx', query: '', ready: 'body' }, viewports: [{ name: '390', width: 390, height: 844, touch: true }, { name: '1280', width: 1280, height: 800 }], states: [], flows: [] };
  });
  await site({ from, out, scenarios });
  const home = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(home, /id="demo"/, 'the app is in a frame');
  assert.match(home, /"base":"component-design-system\/"/, 'the home is the design system');
  assert.doesNotMatch(home, /class="shell"|class="side"|<h1/, 'no site navigation and no title block');
  assert.equal((home.match(/data-vp="/g) ?? []).length, 2, 'the Phone and Desktop switch is in the bar');
  assert.match(home, /<header class="bar"><select[^>]*id="pages"/, 'the page menu is in the same bar');
  assert.match(home, /<optgroup label="Start"><option value="component-design-system\/index\.html" selected>/);
  assert.match(home, /<optgroup label="Layouts"><option value="layout-bar\/index\.html"/);
  assert.match(home, /<optgroup label="Components"><option value="component-reply-card\/index\.html"/);
  const page = readFileSync(join(out, 'layout-bar', 'index.html'), 'utf8');
  assert.match(page, /"base":""/, 'a page loads its own demo');
  assert.match(page, /<option value="\.\.\/layout-bar\/index\.html" selected>/);
});
