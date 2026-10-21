// The souffleur: while you write in one app, it reads the others (through their manifests)
// and composes a side view of what they know, plus a whispered continuation (Tab accepts).
import { Surface, tween } from './gpu.js';
import { materials } from './materials.js';
import { apps, eur } from './data.js';
import { h, api, live } from './util.js';

const { contacts, deals } = apps.crm;
const { invoices } = apps.invoices;

const START = `Weekly note — sales and cash

This week we met Harbor Lights Co. about the renewal. `;

// Offline souffleur: entity matching over the fictional apps.
function heuristic(text) {
  const tail = text.slice(-600).toLowerCase();
  const hits = contacts.filter((c) => tail.includes(c.company.toLowerCase().split(' ')[0]) || tail.includes(c.name.split(' ')[0].toLowerCase()));
  const cards = [];
  for (const c of hits.slice(-2)) {
    const d = deals.find((x) => x.company === c.company);
    const late = invoices.filter((i) => i.company === c.company && i.status === 'overdue');
    cards.push({ app: 'crm', title: `${c.name} · ${c.company}`, body: `${c.role}, last touch ${c.lastTouch} days ago. ${d.title} is at ${d.stage}.`, figure: eur(d.value), insert: `${c.name} (${c.role}) is our contact; ${d.title.toLowerCase()} is worth ${eur(d.value)} and sits at ${d.stage}.` });
    if (late.length) cards.push({ app: 'invoices', title: `${late.length} overdue · ${c.company}`, body: late.map((i) => `${i.id}: ${eur(i.amount)}, ${-i.due} days late`).join(' · '), figure: eur(late.reduce((a, i) => a + i.amount, 0)), insert: `They still owe ${eur(late.reduce((a, i) => a + i.amount, 0))} on ${late.map((i) => i.id).join(', ')}.` });
  }
  const last = hits.at(-1);
  const d = last && deals.find((x) => x.company === last.company);
  const ghost = last && text.endsWith(' ') && !text.includes(`${last.name.split(' ')[0]} wants`)
    ? `${last.name.split(' ')[0]} wants a decision before the ${d.stage === 'proposal' ? 'proposal expires' : 'end of the month'}.`
    : '';
  return { ghost, cards: cards.slice(0, 3) };
}

export function mount(root) {
  const paperCanvas = h('canvas.mat');
  const paper = new Surface(paperCanvas, materials.paper, { c1: '#7c3aed' });
  const ta = h('textarea.writer', { spellcheck: false, value: START });
  const mirror = h('div.mirror');
  const editor = h('div.editor', {}, paperCanvas, mirror, ta);

  const sideCanvas = h('canvas.mat');
  const side = new Surface(sideCanvas, materials.aura, { c1: '#1e1b4b', c2: '#7c3aed' });
  side.set({ energy: 0.15 });
  const sources = h('div.sources', {}, Object.entries(apps).map(([k, a]) => h('div.source', { id: `src-${k}` }, h('i'), a.name)));
  const cardsEl = h('div.s-cards');
  const mode = h('div.muted.small');
  const sidePanel = h('aside.souffleur', {}, sideCanvas, h('div.panel-body', {}, h('div.s-head', {}, h('strong', {}, 'Souffleur'), mode), sources, cardsEl));

  root.append(
    h('div.lede', {}, h('h1', {}, 'The souffleur'),
      h('p', {}, 'You write in Ledger Notes. The souffleur reads Orbit CRM and Tally Invoices through their manifests and composes a view across them, live, beside your text. It whispers the next words in grey: Tab takes them. Mention Copperleaf, Bluefin or Teo to see it move.')),
    h('div.s-layout', {}, h('div.app-frame', {}, h('div.app-bar', {}, h('i'), h('i'), h('i'), h('span', {}, 'Ledger Notes · Weekly note')), editor), sidePanel));

  let ghost = '';
  const paint = () => {
    mirror.replaceChildren(document.createTextNode(ta.value), h('span.ghost', {}, ghost));
    mirror.scrollTop = ta.scrollTop;
  };
  ta.addEventListener('scroll', () => { mirror.scrollTop = ta.scrollTop; });

  const insert = (s) => {
    const pre = ta.value.endsWith(' ') || ta.value.endsWith('\n') ? '' : ' ';
    ta.value += pre + s + ' ';
    ta.focus();
    think();
  };

  const showCards = (cards) => {
    document.querySelectorAll('.source').forEach((s) => s.classList.remove('on'));
    document.getElementById('src-writing').classList.add('on');
    for (const c of cards) document.getElementById(`src-${c.app}`)?.classList.add('on');
    const prev = new Set([...cardsEl.children].map((c) => c.dataset.key));
    cardsEl.replaceChildren(...cards.map((c) => {
      const el = h(`div.s-card.${c.app}${prev.has(c.title) ? '' : '.fresh'}`, {},
        h('div.s-card-app', {}, apps[c.app]?.name ?? c.app), h('div.s-card-title', {}, c.title, c.figure && h('b', {}, c.figure)),
        h('p', {}, c.body), c.insert && h('button.chip', { onclick: () => insert(c.insert) }, 'Insert'));
      el.dataset.key = c.title;
      return el;
    }));
    if (!cards.length) cardsEl.append(h('p.muted.small', {}, 'Nothing from the other apps yet. Mention a client.'));
    const fresh = cards.some((c) => !prev.has(c.title));
    if (fresh) { tween(side, 'energy', 0.9, 300); tween(paper, 'energy', 1, 300); setTimeout(() => { tween(side, 'energy', 0.15, 1800); tween(paper, 'energy', 0, 2500); }, 700); }
  };

  let seq = 0;
  const think = async () => {
    const my = ++seq;
    const local = heuristic(ta.value);
    ghost = local.ghost;
    paint();
    showCards(local.cards);
    mode.textContent = live ? 'reading…' : 'offline: matching names';
    if (!live) return;
    clearTimeout(think.t);
    think.t = setTimeout(async () => {
      try {
        const r = await api('souffleur', { text: ta.value });
        if (my !== seq) return;
        ghost = r.ghost ? (ta.value.endsWith(' ') || ta.value.endsWith('\n') ? '' : ' ') + r.ghost : '';
        paint();
        showCards((r.cards ?? []).filter((c) => apps[c.app]));
        mode.textContent = 'live model';
      } catch { mode.textContent = 'offline: matching names'; }
    }, 900);
  };
  ta.addEventListener('input', think);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && ghost) { e.preventDefault(); ta.value += ghost; ghost = ''; paint(); think(); }
  });
  think();
}
