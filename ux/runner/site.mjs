// `node ux/runner/cli.mjs site --from <captured folder> --out <site folder>`: a static documentation site (plain HTML, CSS and one small script; no server, no model).
// The home page and every target page open on the playable demo. Facts only, never a judge's grade. Pictures stay out of the way: the recordings load on request.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './build.mjs';
import { slug } from './scenario.mjs';
import { page } from './site-chrome.mjs';
import { summary, targetBody } from './site-page.mjs';
import { siteCss } from './site-theme.mjs';

const json = file => JSON.parse(readFileSync(file, 'utf8'));
const plain = text => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();

// The kit's one line: the bold line of README.md.
function about() {
  const line = readFileSync(join(root, 'README.md'), 'utf8').split('\n').find(l => /^\*\*.+\*\*$/.test(l.trim()));
  return line ? plain(line) : 'Boring UI';
}

function copyTarget(from, out, name, hasDemo) {
  const src = join(from, name), dst = join(out, name);
  mkdirSync(dst, { recursive: true });
  if (existsSync(join(src, 'videos'))) cpSync(join(src, 'videos'), join(dst, 'videos'), { recursive: true });
  if (hasDemo) cpSync(join(from, '_pages', `${name}.html`), join(dst, 'demo.html'));
}

export async function site({ from, out, scenarios = [] }) {
  const targets = readdirSync(from, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(from, d.name, 'target.json')) && existsSync(join(from, d.name, 'result.json'))).map(d => d.name).sort();
  if (!targets.length) throw new Error(`no captured target in ${from} (run: node ux/runner/cli.mjs capture --out ${from})`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'site.css'), siteCss());
  cpSync(join(dirname(fileURLToPath(import.meta.url)), 'site-client.js'), join(out, 'site.js'));
  const cards = [];
  for (const name of targets) {
    const meta = json(join(from, name, 'target.json')), result = json(join(from, name, 'result.json'));
    const scenario = scenarios.find(s => slug(s.target) === name);
    const hasDemo = !!scenario && existsSync(join(from, '_pages', `${name}.html`));
    copyTarget(from, out, name, hasDemo);
    cards.push({ name, meta, result, scenario: hasDemo ? scenario : undefined, kitVersion: meta.kitVersion, sum: summary(scenario, result) });
  }
  const nav = cards.map(c => ({ name: c.name, meta: { ...c.meta, kitVersion: c.kitVersion } }));
  for (const c of cards) {
    writeFileSync(join(out, c.name, 'index.html'), page({ title: `${c.meta.title} · Boring UI`, description: c.meta.purpose, depth: 1, cards: nav, current: c.name, body: targetBody(c) }));
  }
  const main = cards.find(c => c.scenario && c.name === 'layout-bar') ?? cards.find(c => c.scenario && c.meta.level === 'layout') ?? cards.find(c => c.scenario) ?? cards[0];
  writeFileSync(join(out, 'index.html'), page({ title: 'Boring UI', description: about(), depth: 0, cards: nav, current: '', body: targetBody({ ...main, home: 'Boring UI', lead: about(), demoBase: `${main.name}/` }) }));
  console.log(`site: ${cards.length} target${cards.length === 1 ? '' : 's'} -> ${out}`);
}
