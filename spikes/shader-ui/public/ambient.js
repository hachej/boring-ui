// The ambient agent: no chat box. A small presence lives on the page, drifts to what it has
// something to say about, says it in one line, and leaves you alone if you ignore it.
import { Surface, tween } from './gpu.js';
import { materials } from './materials.js';
import { apps, eur } from './data.js';
import { h, sleep } from './util.js';

const deals = apps.crm.deals;
const contacts = apps.crm.contacts;

export function mount(root) {
  const rows = deals.map((d) => {
    const c = contacts.find((x) => x.company === d.company);
    return h('tr', {},
      h('td', {}, h('strong', {}, d.title), h('div.muted', {}, d.company)),
      h('td', {}, c.name), h('td', {}, d.stage), h('td.num', {}, eur(d.value)), h('td.num', {}, `${c.lastTouch} d`));
  });
  const amount = h('input.field', { value: '310000', id: 'amount' });
  const close = h('input.field', { value: '2026-09-30', id: 'close' });
  const form = h('div.form', {},
    h('label', {}, 'New deal: Bluefin phase 2'),
    h('div.form-row', {}, h('span.muted', {}, 'Amount (€)'), amount),
    h('div.form-row', {}, h('span.muted', {}, 'Expected close'), close),
    h('div.form-row', {}, h('span.muted', {}, 'Owner'), h('input.field', { value: 'You' })));
  const table = h('table.crm', {}, h('thead', {}, h('tr', {}, ['Deal', 'Contact', 'Stage', 'Value', 'Silent'].map((t) => h('th', {}, t)))), h('tbody', {}, rows));
  const page = h('div.crm-page', {}, h('div.crm-head', {}, h('h2', {}, 'Orbit CRM'), h('span.muted', {}, 'Pipeline')), table, form);

  // The presence.
  const orbCanvas = h('canvas.orb');
  const bubble = h('div.bubble', {}, h('p'), h('div.bubble-actions'));
  const presence = h('div.presence', {}, orbCanvas, bubble);
  const stage = h('div.ambient-stage', {}, page, presence);
  const orb = new Surface(orbCanvas, materials.orb, { c1: '#7c3aed', c2: '#06b6d4' });
  orb.set({ energy: 0.2 });

  const log = h('ol.ambient-log');
  root.append(
    h('div.lede', {}, h('h1', {}, 'An agent that is just there'),
      h('p', {}, 'No chat box. The presence watches the page, drifts to what deserves your attention, says it in one line, and fades if you ignore it. Try typing in the form: it reacts to what you do.')),
    stage, h('div.muted.small', {}, 'What it noticed:'), log);

  // Spring-follow so motion feels physical.
  let pos = { x: 40, y: 40 }, vel = { x: 0, y: 0 }, target = { x: 40, y: 40 };
  const tick = () => {
    const k = 0.06, damp = 0.78;
    vel.x = (vel.x + (target.x - pos.x) * k) * damp;
    vel.y = (vel.y + (target.y - pos.y) * k) * damp;
    pos.x += vel.x; pos.y += vel.y;
    const idle = performance.now() / 1000;
    presence.style.transform = `translate(${pos.x}px, ${pos.y + Math.sin(idle * 1.3) * 3}px)`;
    orb.set({ energy: Math.min(1, 0.2 + Math.hypot(vel.x, vel.y) / 10 + (presence.classList.contains('talking') ? 0.5 : 0)) });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const goTo = (el, side = 'right') => {
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // Stay inside the stage: the orb plus a 300px bubble must fit to its right.
    const x = side === 'right' ? r.right - s.left + 8 : r.left - s.left - 64;
    target = { x: Math.max(0, Math.min(x, s.width - 360)), y: r.top - s.top + r.height / 2 - 28 };
  };

  let current = null;
  const say = async (el, text, actions = [], { side = 'right' } = {}) => {
    const token = Symbol('say');
    current = token;
    document.querySelectorAll('.attn').forEach((x) => x.classList.remove('attn'));
    el.classList.add('attn');
    goTo(el, side);
    await sleep(500);
    if (current !== token) return;
    bubble.querySelector('p').textContent = text;
    bubble.querySelector('.bubble-actions').replaceChildren(...actions.map(([label, fn]) => h('button.chip', { onclick: () => { fn?.(); dismiss(true); } }, label)), h('button.chip.quiet', { onclick: () => dismiss(false) }, 'Not now'));
    presence.classList.add('talking');
    log.prepend(h('li', {}, text));
    // Ignored for 9 s: it fades back to the corner by itself.
    setTimeout(() => { if (current === token) dismiss(false); }, 9000);
  };
  const dismiss = (done) => {
    current = null;
    presence.classList.remove('talking');
    document.querySelectorAll('.attn').forEach((x) => { x.classList.remove('attn'); if (done) x.classList.add('done'); });
    target = { x: stage.clientWidth - 70, y: 8 };
  };

  // What it notices: silence, risk, and odd input.
  const notices = [
    () => say(rows[3], 'Bluefin rollout is stalled and Jonas Reed has been silent for 44 days, with 7,600 € overdue. Draft a short check-in?', [['Draft it', () => {}]]),
    () => say(rows[0], 'Mira Kestrel (Harbor Lights) was warm 3 weeks ago. The renewal proposal is still open: a nudge now usually lands.', [['Nudge Mira', () => {}]]),
  ];
  let n = 0;
  const loop = async () => {
    await sleep(1200);
    while (root.isConnected) {
      if (!current && root.classList.contains('on')) notices[n++ % notices.length]();
      await sleep(13000);
    }
  };
  loop();

  amount.addEventListener('input', () => {
    const v = Number(amount.value.replace(/\D/g, ''));
    if (v > 100000) say(amount, `${eur(v)} is 10× Bluefin's first deal (31,000 €). Missing a zero?`, [['Make it 31,000 €', () => { amount.value = '31000'; }]], { side: 'right' });
  });
  close.addEventListener('change', () => {
    if (close.value < '2026-10-21') say(close, 'That date is already past. Next month instead?', [['Set 2026-11-30', () => { close.value = '2026-11-30'; }]]);
  });
  amount.addEventListener('focus', () => amount.dispatchEvent(new Event('input')));
}
