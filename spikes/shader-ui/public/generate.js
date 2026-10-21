import { apps, eur } from './data.js';
import { render } from './screen.js';
import { h, api, live } from './util.js';

const inv = apps.invoices.invoices;
const deals = apps.crm.deals;

// Canned screens, so the page works without a model. Same schema the model returns.
const canned = {
  'My invoices as a board, overdue ones glowing': {
    title: 'Invoices', subtitle: 'Overdue ones glow brighter the longer they wait.',
    palette: { c1: '#ff3d71', c2: '#ffaa00' }, background: { material: 'glass' },
    blocks: [
      { type: 'stat', label: 'Overdue', value: eur(inv.filter((i) => i.status === 'overdue').reduce((a, i) => a + i.amount, 0)), hint: '3 invoices', glow: 0.9 },
      { type: 'stat', label: 'Waiting', value: eur(inv.filter((i) => i.status === 'sent').reduce((a, i) => a + i.amount, 0)), hint: 'sent, not due' },
      { type: 'stat', label: 'Paid this month', value: eur(3300), hint: 'Harbor Lights Co.' },
      { type: 'board', columns: ['draft', 'sent', 'overdue', 'paid'].map((st) => ({
        title: st, cards: inv.filter((i) => i.status === st).map((i) => ({ title: `${i.company} · ${eur(i.amount)}`, meta: `${i.id} · ${i.due < 0 ? `${-i.due} days late` : i.due === 0 ? 'settled' : `due in ${i.due} days`}`, glow: i.due < 0 ? Math.min(1, -i.due / 31) : 0 })),
      })) },
    ],
  },
  'Pipeline as a calm morning briefing': {
    title: 'Good morning', subtitle: 'Four deals, one needs you today.',
    palette: { c1: '#f59e0b', c2: '#fde68a' },
    background: { wgsl: `fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let sun = smoothstep(0.5, 0.0, length((uv - vec2f(0.8, 0.15 + 0.05 * sin(u.time * 0.1))) * vec2f(1.6, 1.0)));
  let haze = fbm(uv * vec2f(3.0, 8.0) + vec2f(u.time * 0.02, 0.0));
  let sky = mix(vec3f(0.07, 0.05, 0.1), vec3f(0.18, 0.1, 0.12), uv.y + haze * 0.2);
  return vec4f(sky + u.c1.rgb * sun * 0.45 + haze * 0.03, 1.0);
}` },
    blocks: [
      { type: 'text', body: 'Bluefin Logistics has gone quiet for 44 days and owes 7,600 €. Everything else is moving.', span: 3 },
      ...deals.map((d) => ({ type: 'stat', label: d.title, value: eur(d.value), hint: d.stage, glow: d.risk > 0.5 ? d.risk : 0 })),
      { type: 'chart', label: 'Deal value', labels: deals.map((d) => d.company.split(' ')[0]), values: deals.map((d) => d.value), span: 2 },
    ],
  },
  'Who should I call first? Make it urgent but not stressful': {
    title: 'Call list', subtitle: 'Ordered by money at risk × silence.',
    palette: { c1: '#14b8a6', c2: '#a7f3d0' }, background: { material: 'aura' },
    blocks: [
      { type: 'table', columns: ['Who', 'Company', 'Silent for', 'At risk'],
        rows: apps.crm.contacts.map((c) => [c.name, c.company, `${c.lastTouch} days`, eur(inv.filter((i) => i.company === c.company && i.status === 'overdue').reduce((a, i) => a + i.amount, 0))])
          .sort((a, b) => parseInt(b[2]) - parseInt(a[2])), glowRows: [0] },
    ],
  },
};

export function mount(root) {
  const stage = h('div.screen');
  const err = h('pre.err');
  const src = h('details.src', {}, h('summary', {}, 'Material source'), h('pre.code-view'));
  const busy = h('span.muted');
  const input = h('input.prompt.big', { placeholder: 'Describe the screen you want, with your data…' });

  const show = async (spec) => {
    const r = await render(stage, spec);
    err.textContent = r.error ? `The generated shader did not compile; kept the default material.\n${r.error}` : '';
    err.classList.toggle('on', Boolean(r.error));
    src.querySelector('pre').textContent = r.wgsl.trim();
  };
  const go = async (prompt) => {
    input.value = prompt;
    if (canned[prompt] && (!live || prompt !== input.dataset.forceLive)) return show(canned[prompt]);
    if (!live) { busy.textContent = 'No live model: pick a suggestion.'; return; }
    busy.textContent = 'designing…';
    stage.classList.add('busy');
    try { await show(await api('generate', { prompt })); busy.textContent = ''; } catch (e) { busy.textContent = e.message; }
    stage.classList.remove('busy');
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go(input.value));

  root.append(
    h('div.lede', {}, h('h1', {}, 'Make your own screen'),
      h('p', {}, 'Say what you want to see. The model returns a screen as data (blocks from a trusted set) plus its mood as a shader. Nothing it writes runs in the page except that shader, on the GPU.')),
    h('div.lab-row', {}, input, h('button.primary', { onclick: () => go(input.value) }, 'Make it'), busy),
    h('div.chips', {}, Object.keys(canned).map((p) => h('button.chip', { onclick: () => go(p) }, p)),
      h('button.chip.live', { onclick: () => go('Show my stalled deals as a dramatic night sky where each deal is a dimming star') }, 'live: stalled deals as a night sky'),
      h('button.chip.live', { onclick: () => go('A board of my invoices by company, with a background that feels like a quiet library') }, 'live: invoices by company, quiet library')),
    stage, err, src);
  show(canned[Object.keys(canned)[0]]);
}
