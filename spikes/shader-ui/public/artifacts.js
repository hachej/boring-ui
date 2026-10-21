// The pi chat layout (thread + artifact panel) with what shaders and generation could add:
// a living card, an artifact that materialises while it streams, remix by prompt,
// and versions you scrub with the change pointed out.
import { Surface, tween } from './gpu.js';
import { materials } from './materials.js';
import { apps, eur } from './data.js';
import { render } from './screen.js';
import { h, api, live, sleep } from './util.js';

const inv = apps.invoices.invoices;
const overdue = (list) => list.filter((i) => i.status === 'overdue');

// Three versions of one fictional artifact. Each paragraph has a key so changes can be found.
const versions = [
  { note: 'First draft.', paras: [
    ['a', 'Cash is healthy but three invoices are late.'],
    ['b', `Overdue: ${eur(overdue(inv).reduce((s, i) => s + i.amount, 0))} across Harbor Lights, Copperleaf and Bluefin.`],
    ['c', 'Bluefin Logistics is the outlier: 31 days late and silent for 44.'],
  ] },
  { note: 'Copperleaf paid INV-1043, so I lowered the total.', changed: 'b', paras: [
    ['a', 'Cash is healthy but three invoices are late.'],
    ['b', `Overdue: ${eur(4200 + 7600)} across Harbor Lights and Bluefin (Copperleaf paid this morning).`],
    ['c', 'Bluefin Logistics is the outlier: 31 days late and silent for 44.'],
  ] },
  { note: 'Teo asked for a recommendation, so I added one.', changed: 'd', paras: [
    ['a', 'Cash is healthy but two invoices are late.'],
    ['b', `Overdue: ${eur(4200 + 7600)} across Harbor Lights and Bluefin (Copperleaf paid this morning).`],
    ['c', 'Bluefin Logistics is the outlier: 31 days late and silent for 44.'],
    ['d', 'Recommendation: call Jonas Reed this week and pause the Bluefin rollout until INV-1044 is settled.'],
  ] },
];

const views = {
  document: null,
  board: { title: 'Cash brief · board', palette: { c1: '#ff3d71', c2: '#ffaa00' }, background: { material: 'glass' },
    blocks: [{ type: 'board', columns: ['sent', 'overdue', 'paid'].map((st) => ({ title: st, cards: inv.filter((i) => i.status === st).map((i) => ({ title: `${i.company}`, meta: `${i.id} · ${eur(i.amount)}`, glow: i.due < 0 ? Math.min(1, -i.due / 31) : 0 })) })) }] },
  chart: { title: 'Cash brief · chart', palette: { c1: '#7c3aed', c2: '#22d3ee' }, background: { material: 'aura' },
    blocks: [{ type: 'chart', label: 'Overdue by company', labels: ['Harbor', 'Copper', 'Bluefin'], values: [4200, 950, 7600], span: 3 },
      { type: 'stat', label: 'Overdue total', value: eur(12750), glow: 0.7 }, { type: 'stat', label: 'Worst', value: 'Bluefin, 31 d', glow: 1 }, { type: 'stat', label: 'Paid this week', value: eur(3300) }] },
};

export function mount(root) {
  const thread = h('div.thread');
  const composer = h('div.composer', {}, h('span.muted', {}, 'Message Orbit…'), h('button.primary', { onclick: () => play() }, 'Play the conversation'));
  const chat = h('div.chat', {}, h('div.chat-head', {}, h('strong', {}, 'Orbit'), h('span.muted', {}, 'pi chat')), thread, composer);

  // Panel: content + reveal overlay + ripple overlay + presence.
  const content = h('div.doc');
  const revealCanvas = h('canvas.overlay');
  const rippleCanvas = h('canvas.overlay');
  const orbCanvas = h('canvas.orb.small');
  const pointer = h('div.pointer', {}, orbCanvas, h('span'));
  const body = h('div.panel-scroll', {}, content, revealCanvas, rippleCanvas, pointer);
  const tabs = h('div.view-tabs', {}, Object.keys(views).map((k) => h('button', { className: k === 'document' ? 'on' : '', onclick: () => remix(k) }, k)));
  const remixIn = h('input.prompt', { placeholder: 'Remix as… "a timeline", "a letter to Teo", "a table by days late"' });
  const slider = h('input', { type: 'range', min: 1, max: 3, value: 3, step: 1, disabled: true });
  const vLabel = h('span.muted.small', {}, 'v3');
  const panel = h('div.art-panel.closed', {},
    h('div.art-head', {}, h('div', {}, h('strong', {}, 'Cash brief, week 43'), h('div.muted.small', {}, 'Document')), tabs),
    h('div.art-tools', {}, remixIn, h('div.scrub', {}, h('span.muted.small', {}, 'Versions'), slider, vLabel)),
    body);
  const plainToggle = h('label.toggle', {}, h('input', { type: 'checkbox', onchange: (e) => root.classList.toggle('plain', e.target.checked) }), 'Show today\'s look (no shaders)');
  root.append(
    h('div.lede', {}, h('h1', {}, 'Artifacts in the chat'),
      h('p', {}, 'The pi chat layout: thread on the left, artifact panel on the right. Play the conversation: the card is alive while the artifact is made, the artifact materialises as it streams, you can remix it into another view, and scrub its versions with the change pointed out.'), plainToggle),
    h('div.chat-layout', {}, chat, panel));

  const reveal = new Surface(revealCanvas, materials.reveal, { c1: '#7c3aed', c2: '#22d3ee' });
  const ripple = new Surface(rippleCanvas, materials.ripple, { c1: '#a78bfa' });
  const orb = new Surface(orbCanvas, materials.orb, { c1: '#7c3aed', c2: '#06b6d4' });
  orb.set({ energy: 0.6 });
  reveal.set({ energy: 1.2 });
  ripple.set({ energy: 1 });

  let version = 3;
  let view = 'document';
  const drawDoc = (v, streamed = Infinity) => {
    let left = streamed;
    content.replaceChildren(h('h2', {}, 'Cash brief, week 43'), ...versions[v - 1].paras.map(([k, t]) => {
      const shown = t.slice(0, Math.max(0, left));
      left -= t.length;
      return h('p', { id: `p-${k}` }, shown);
    }));
  };

  const msg = (who, ...kids) => { const m = h(`div.msg.${who}`, {}, ...kids); thread.append(m); thread.scrollTop = 1e6; return m; };

  let played = false;
  async function play() {
    if (played) return;
    played = true;
    composer.querySelector('button').disabled = true;
    msg('user', 'Turn this week\'s invoices into a one-page brief for Teo.');
    await sleep(500);
    const thinking = msg('agent.thinking', h('canvas.mat'), h('span', {}, 'Reading Tally Invoices and Orbit CRM…'));
    const tS = new Surface(thinking.querySelector('canvas'), materials.aura, { c1: '#4c1d95', c2: '#0e7490' });
    tS.set({ state: 1, energy: 0.8 });
    await sleep(1600);
    tS.destroy();
    thinking.remove();
    msg('agent', 'Here is the brief. Bluefin is the one to watch.');

    // The card: a living thumbnail instead of an icon.
    const thumb = h('canvas.thumb');
    const card = h('button.art-card.streaming', { onclick: () => panel.classList.remove('closed') }, thumb,
      h('span.art-card-text', {}, h('strong', {}, 'Cash brief, week 43'), h('span.muted.small', {}, 'Document · writing…')));
    msg('agent', card);
    const thumbS = new Surface(thumb, materials.aura, { c1: '#6d28d9', c2: '#22d3ee' });
    thumbS.set({ state: 2, energy: 1 });

    // The panel opens and the artifact materialises while it streams.
    panel.classList.remove('closed');
    await sleep(350);
    const total = versions[0].paras.reduce((s, [, t]) => s + t.length, 0);
    for (let n = 0; n <= total; n += 3) {
      drawDoc(1, n);
      reveal.set({ energy: n / total });
      await sleep(18);
    }
    reveal.set({ energy: 1.2 });
    tween(thumbS, 'state', 0, 1200);
    tween(thumbS, 'energy', 0.25, 1200);
    card.classList.remove('streaming');
    card.querySelector('.small').textContent = 'Document · v1';
    version = 1; slider.value = 1; vLabel.textContent = 'v1';

    // Two later edits arrive; each one is pointed out.
    for (const v of [2, 3]) {
      await sleep(2200);
      msg('user', v === 2 ? 'Copperleaf just paid INV-1043.' : 'Teo wants a recommendation at the end.');
      await sleep(900);
      await setVersion(v, true);
      card.querySelector('.small').textContent = `Document · v${v}`;
      msg('agent', versions[v - 1].note);
    }
    slider.disabled = false;
  }

  async function setVersion(v, announce) {
    const from = version;
    version = v;
    vLabel.textContent = `v${v}`;
    slider.value = v;
    if (view !== 'document') await remix('document');
    drawDoc(v);
    // Find what differs from the previous version shown, and point at it.
    const prev = new Map(versions[from - 1].paras);
    const changed = versions[v - 1].paras.find(([k, t]) => prev.get(k) !== t)?.[0]
      ?? versions[from - 1].paras.find(([k]) => !versions[v - 1].paras.some(([k2]) => k2 === k))?.[0];
    const el = changed && content.querySelector(`#p-${changed}`);
    if (!el) { pointer.classList.remove('on'); return; }
    el.classList.add('changed');
    const b = body.getBoundingClientRect(), r = el.getBoundingClientRect();
    ripple.set({ mouse: [(r.left - b.left + 40) / b.width, 1 - (r.top - b.top + r.height / 2) / b.height] });
    ripple.u.energy = 0;
    tween(ripple, 'energy', 1, 1400);
    pointer.style.transform = `translate(${r.left - b.left - 44}px, ${r.top - b.top + body.scrollTop - 4}px)`;
    pointer.querySelector('span').textContent = announce || v > from ? versions[v - 1].note : `back to v${v}`;
    pointer.classList.add('on');
    setTimeout(() => pointer.classList.remove('on'), 4000);
  }
  slider.addEventListener('input', () => setVersion(Number(slider.value), false));

  async function remix(to, spec) {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === to));
    // Wipe out, swap, materialise back in.
    for (let k = 1.2; k >= 0; k -= 0.08) { reveal.set({ energy: k }); await sleep(12); }
    view = to;
    content.className = to === 'document' ? 'doc' : 'doc screen';
    if (to === 'document') drawDoc(version);
    else await render(content, spec ?? views[to]);
    for (let k = 0; k <= 1.2; k += 0.06) { reveal.set({ energy: k }); await sleep(14); }
  }

  remixIn.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !remixIn.value.trim()) return;
    if (!live) { remixIn.value = ''; remixIn.placeholder = 'No live model: use the view tabs.'; return; }
    const as = remixIn.value;
    remixIn.disabled = true;
    remixIn.value = `remixing as ${as}…`;
    const artifact = { title: 'Cash brief, week 43', paragraphs: versions[version - 1].paras.map(([, t]) => t), invoices: inv };
    try { await remix(as, await api('remix', { artifact, as })); } catch (err) { remixIn.placeholder = err.message; }
    remixIn.disabled = false;
    remixIn.value = '';
  });

  drawDoc(3);
}
