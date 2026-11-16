import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { site } from '../ux/runner/site.mjs';

// The showcase's home is the design system page (the kit's defaults, built from kit parts), not an app demo.
test('the site home opens on the design system demo, and the app demo stays a page of its own', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ux-home-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const from = join(dir, 'cap'), out = join(dir, 'site'), names = ['component-design-system', 'layout-bar'];
  mkdirSync(join(from, '_pages'), { recursive: true });
  const scenarios = names.map(name => {
    const [level, id] = [name.split('-')[0], name.split('-').slice(1).join('-')], target = `${level}:${id}`;
    mkdirSync(join(from, name), { recursive: true });
    writeFileSync(join(from, '_pages', `${name}.html`), '<!doctype html><title>Demo</title>');
    writeFileSync(join(from, name, 'result.json'), JSON.stringify({ target, states: [], stateFailures: [], errors: [], flows: [] }));
    writeFileSync(join(from, name, 'target.json'), JSON.stringify({ target, title: id, purpose: 'A page.', level, kitVersion: '0.0.0', commit: 'abc1234', capturedAt: '2026-01-01T00:00:00Z' }));
    return { target, title: id, purpose: 'A page.', fixture: { entry: 'x.jsx', query: '', ready: 'body' }, viewports: [{ name: '390', width: 390, height: 844, touch: true }], states: [], flows: [] };
  });
  await site({ from, out, scenarios });
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /"base":"component-design-system\/"/);
  assert.ok(existsSync(join(out, 'layout-bar', 'index.html')));
});
