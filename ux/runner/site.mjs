// `node ux/runner/cli.mjs site --from <captured folder> --out <site folder>`: a static site (plain HTML, CSS and a little JS; no server, no model).
// Shows facts only: live demo, pictures, sentences, measurements in plain words, the check status. Never judge grades or scoreboards.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './build.mjs';
import { slug } from './scenario.mjs';
import { esc, head, nav, summary, summaryLine, targetPage } from './site-page.mjs';
import { siteCss } from './site-theme.mjs';

const json = file => JSON.parse(readFileSync(file, 'utf8'));
const plain = text => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();

// Two sentences from README.md: the bold line and the first sentence of the paragraph under it.
function about() {
  const lines = readFileSync(join(root, 'README.md'), 'utf8').split('\n');
  const i = lines.findIndex(l => /^\*\*.+\*\*$/.test(l.trim()));
  if (i < 0) return '';
  const next = lines.slice(i + 1).find(l => l.trim() && !l.startsWith('['));
  return `${plain(lines[i])} ${plain(next ?? '').split(/(?<=\.)\s/)[0]}`.trim();
}

function copyTarget(from, out, name, hasDemo, result) {
  const src = join(from, name), dst = join(out, name);
  mkdirSync(dst, { recursive: true });
  for (const sub of ['states', 'videos']) if (existsSync(join(src, sub))) cpSync(join(src, sub), join(dst, sub), { recursive: true });
  for (const id of existsSync(join(src, 'flows')) ? readdirSync(join(src, 'flows')) : []) {
    mkdirSync(join(dst, 'flows', id), { recursive: true });
    for (const file of readdirSync(join(src, 'flows', id)).filter(f => /^strip-.*\.png$/.test(f))) cpSync(join(src, 'flows', id, file), join(dst, 'flows', id, file));
  }
  for (const run of result.flows) for (const st of run.steps) if (st.frame) {
    mkdirSync(join(dst, 'flows', run.id, run.viewport), { recursive: true });
    cpSync(join(src, 'flows', run.id, run.viewport, st.frame), join(dst, 'flows', run.id, run.viewport, st.frame));
  }
  if (hasDemo) cpSync(join(from, '_pages', `${name}.html`), join(dst, 'demo.html'));
}

export async function site({ from, out, scenarios = [] }) {
  const targets = readdirSync(from, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(from, d.name, 'target.json')) && existsSync(join(from, d.name, 'result.json'))).map(d => d.name).sort();
  if (!targets.length) throw new Error(`no captured target in ${from} (run: node ux/runner/cli.mjs capture --out ${from})`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'site.css'), siteCss());
  const cards = [];
  for (const name of targets) {
    const meta = json(join(from, name, 'target.json')), result = json(join(from, name, 'result.json'));
    const scenario = scenarios.find(s => slug(s.target) === name);
    const hasDemo = !!scenario && existsSync(join(from, '_pages', `${name}.html`));
    copyTarget(from, out, name, hasDemo, result);
    writeFileSync(join(out, name, 'index.html'), targetPage({ meta, scenario: hasDemo ? scenario : undefined, result, folder: join(from, name) }));
    cards.push({ name, meta, sum: summary(scenario, result), flows: new Set(result.flows.map(f => f.id)).size });
  }
  const group = (level, title) => {
    const list = cards.filter(c => c.meta.level === level);
    return list.length ? `<h2>${title}</h2><div class="grid">${list.map(c => `<a class="card" href="${esc(c.name)}/index.html"><h3>${esc(c.meta.title)}</h3><p>${esc(c.meta.purpose.split(/(?<=\.)\s/)[0])}</p><p class="small">${c.flows} flow${c.flows === 1 ? '' : 's'} measured · ${esc(summaryLine(c.sum))}</p></a>`).join('')}</div>` : '';
  };
  const first = cards[0].meta;
  writeFileSync(join(out, 'index.html'), `${head('Boring UI showcase', 0, about())}${nav(0)}<main><h1>Boring UI showcase</h1><p class="lead">${esc(about())}</p>
<p class="muted">Every page below is a live demo of one part of the kit with an invented assistant, plus what a real browser measured while a person-like script used it. The demo company, « Atelier Brun (fictif) », its clients and every amount are invented. Pick a layout or a component.</p>
${group('layout', 'Layouts')}${group('component', 'Components')}
<footer>Kit ${esc(first.kitVersion)} · commit ${esc(first.commit)} · captured ${esc(String(first.capturedAt).slice(0, 10))}. Demo content is invented.</footer></main></body></html>`);
  console.log(`site: ${cards.length} target${cards.length === 1 ? '' : 's'} -> ${out}`);
}
