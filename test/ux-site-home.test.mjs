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
  const from = join(dir, 'cap'), out = join(dir, 'site'), names = ['component-design-system', 'layout-bar', 'component-reply-card', 'layout-update-notice'];
  mkdirSync(join(from, '_pages'), { recursive: true });
  const scenarios = names.map(name => {
    const [level, id] = [name.split('-')[0], name.split('-').slice(1).join('-')], target = `${level}:${id}`;
    mkdirSync(join(from, name), { recursive: true });
    writeFileSync(join(from, '_pages', `${name}.html`), '<!doctype html><head><title>Demo</title></head><body>app</body>');
    writeFileSync(join(from, name, 'result.json'), JSON.stringify({ target, states: [], stateFailures: [], errors: [], flows: [] }));
    writeFileSync(join(from, name, 'target.json'), JSON.stringify({ target, title: id, purpose: 'A page.', level, kitVersion: '0.0.0', commit: 'abc1234', capturedAt: '2026-01-01T00:00:00Z' }));
    return { target, title: id, purpose: 'A page.', fixture: { entry: 'x.jsx', query: '', ready: 'body' }, viewports: [{ name: '390', width: 390, height: 844, touch: true }, { name: '1280', width: 1280, height: 800 }], states: [], flows: [], ...(name === 'layout-update-notice' ? { site: false } : {}) };
  });
  await site({ from, out, scenarios });
  const home = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(home, /id="demo"/, 'the app is in a frame');
  assert.match(home, /"base":"component-design-system\/"/, 'the home is the design system');
  assert.doesNotMatch(home, /class="shell"|class="side"|<h1/, 'no site navigation and no title block');
  assert.equal((home.match(/data-vp="/g) ?? []).length, 2, 'the Phone and Desktop switch is in the bar');
  assert.match(home, /<header class="bar"><div class="switcher"><button[^>]*id="pages"/, 'the page switcher is in the same bar');
  assert.match(home, /<a class="sw-item" href="component-design-system\/index\.html"[^>]*aria-current="page">/, 'the current page is marked and a real link');
  // The scenarios here carry no group: they all fall to "More".
  assert.match(home, /<p class="sw-group">More<\/p>/);
  assert.match(home, /href="layout-bar\/index\.html"/);
  assert.match(home, /href="component-reply-card\/index\.html"/);
  assert.doesNotMatch(home, /update-notice/, 'a scenario with site: false is not on the site');
  const page = readFileSync(join(out, 'layout-bar', 'index.html'), 'utf8');
  assert.match(page, /"base":""/, 'a page loads its own demo');
  assert.match(page, /<a class="sw-item" href="\.\.\/layout-bar\/index\.html"[^>]*aria-current="page">/);
});

// A page picks its switcher group and one-line hint in its scenario; a missing or unknown group falls to "More".
test('the switcher groups pages by their scenario, in order, and an unknown or missing group falls to More', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ux-groups-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const from = join(dir, 'cap'), out = join(dir, 'site');
  const rows = [['component-design-system', 'Start here', 'every part'], ['component-reply-card', 'Chat and files', 'choices'], ['layout-bar', 'Composer and layout', 'the bar'], ['component-people', 'Nonsense', 'x'], ['component-tool-steps', undefined, undefined]];
  mkdirSync(join(from, '_pages'), { recursive: true });
  const scenarios = rows.map(([name, group, hint]) => {
    const [level, id] = [name.split('-')[0], name.split('-').slice(1).join('-')], target = `${level}:${id}`;
    mkdirSync(join(from, name), { recursive: true });
    writeFileSync(join(from, '_pages', `${name}.html`), '<!doctype html><body>app</body>');
    writeFileSync(join(from, name, 'result.json'), JSON.stringify({ target, states: [], stateFailures: [], errors: [], flows: [] }));
    writeFileSync(join(from, name, 'target.json'), JSON.stringify({ target, title: id, purpose: 'A page.', level, kitVersion: '0.0.0', commit: 'abc1234', capturedAt: '2026-01-01T00:00:00Z' }));
    return { target, title: id, purpose: 'A page.', group, hint, fixture: { entry: 'x.jsx', query: '', ready: 'body' }, viewports: [{ name: '390', width: 390, height: 844, touch: true }, { name: '1280', width: 1280, height: 800 }], states: [], flows: [] };
  });
  await site({ from, out, scenarios });
  const home = readFileSync(join(out, 'index.html'), 'utf8');
  assert.deepEqual([...home.matchAll(/<p class="sw-group">([^<]*)<\/p>/g)].map(m => m[1]), ['Start here', 'Composer and layout', 'Chat and files', 'More']);
  const more = home.slice(home.indexOf('<p class="sw-group">More</p>'));
  assert.ok(more.includes('href="component-people/index.html"') && more.includes('href="component-tool-steps/index.html"'), 'unknown and missing groups share More');
  assert.match(home, /<small class="sw-hint">choices<\/small>/);
});
