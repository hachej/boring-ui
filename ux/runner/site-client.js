// The showcase's only script (copied next to the pages as site.js): the theme switch, the phone menu, the demo frame (width, start state,
// "things to try") and the copy button. The demo is the real page of the fixture in an iframe of the same origin; a "thing to try" reloads it
// and plays compiled scenario steps (tap, type, press, focus, scroll, wait, fixture) on its document.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  const root = document.documentElement;
  let theme = root.dataset.theme || 'light', frame, run = 0;

  const setTheme = next => {
    theme = next; root.dataset.theme = next;
    try { localStorage.setItem('ux-theme', next); } catch { /* private mode */ }
    const button = $('#theme'); if (button) { button.setAttribute('aria-pressed', String(next === 'dark')); button.textContent = next === 'dark' ? 'Light' : 'Dark'; }
    try { frame?.contentDocument.documentElement.classList.toggle('dark', next === 'dark'); } catch { /* not loaded */ }
  };
  $('#theme')?.addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark'));
  // The bar's popovers: the page switcher (search, groups) and the Options menu. One open at a time; Esc closes and gives the focus back to its button.
  const pop = { pages: ['#pages', '#sw-panel'], options: ['#options', '#options-panel'], more: ['#more', '#tools'] };
  const isOpen = key => { const [b] = pop[key]; return $(b)?.getAttribute('aria-expanded') === 'true'; };
  const close = (key, back) => {
    const [b, p] = pop[key].map(s => $(s)); if (!b) return;
    b.setAttribute('aria-expanded', 'false'); if (key === 'more') p.classList.remove('open'); else p.hidden = true;
    if (key === 'pages') { const bd = $('#sw-backdrop'); if (bd) bd.hidden = true; document.body.classList.remove('sheet-open'); }
    if (back) b.focus();
  };
  const closeAll = except => { for (const key of Object.keys(pop)) if (key !== except && isOpen(key)) close(key); };
  const open = key => {
    closeAll(key === 'options' && isOpen('more') ? 'more' : key);
    const [b, p] = pop[key].map(s => $(s)); if (!b) return;
    b.setAttribute('aria-expanded', 'true'); if (key === 'more') p.classList.add('open'); else p.hidden = false;
    if (key === 'pages') { $('#sw-backdrop').hidden = false; document.body.classList.add('sheet-open'); const input = $('#sw-search'); input.value = ''; filter(); input.focus(); }
    if (key === 'options') $('.menu-item:not([hidden])', p)?.focus();
  };
  const toggle = key => (isOpen(key) ? close(key, true) : open(key));
  const filter = () => {
    const words = $('#sw-search').value.toLowerCase().split(/\s+/).filter(Boolean);
    let any = false;
    $$('#sw-list .sw-item').forEach(a => { const show = words.every(w => a.dataset.find.includes(w)); a.hidden = !show; any ||= show; });
    $$('#sw-list [data-sw-group]').forEach(g => { g.hidden = !$$('.sw-item', g).some(a => !a.hidden); });
    $('#sw-empty').hidden = any;
  };
  const visibleItems = () => $$('#sw-list .sw-item').filter(a => !a.hidden);
  $('#pages')?.addEventListener('click', () => toggle('pages'));
  $('#options')?.addEventListener('click', () => toggle('options'));
  $('#more')?.addEventListener('click', () => toggle('more'));
  $('#sw-backdrop')?.addEventListener('click', () => close('pages', true));
  $('#sw-search')?.addEventListener('input', filter);
  $('#sw-panel')?.addEventListener('keydown', e => {
    const items = visibleItems(), at = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (items[at + 1] ?? items[0])?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (at <= 0) $('#sw-search').focus(); else items[at - 1].focus(); }
    else if (e.key === 'Enter' && document.activeElement === $('#sw-search')) { e.preventDefault(); items[0]?.click(); }
  });
  $('#options-panel')?.addEventListener('keydown', e => {
    const items = $$('.menu-item', $('#options-panel')).filter(b => !b.hidden), at = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
  });
  $('#options-panel')?.addEventListener('click', e => { if (e.target.closest('.menu-item')) close('options', true); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const key = Object.keys(pop).find(isOpen); if (key) { e.preventDefault(); close(key, true); } return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) { if (!$('#pages')) return; e.preventDefault(); if (!isOpen('pages')) open('pages'); else $('#sw-search').focus(); }
  });
  // A click inside the demo frame does not reach this document; the focus moving into the frame closes the popovers.
  addEventListener('blur', () => { if (document.activeElement === $('#demo')) closeAll(); });
  document.addEventListener('click', e => { for (const key of Object.keys(pop)) if (isOpen(key) && !e.target.closest(`${pop[key][1]}, ${pop[key][0]}`)) close(key); });
  $('#menu')?.addEventListener('click', () => { const open = document.body.classList.toggle('nav-open'); $('#menu').setAttribute('aria-expanded', String(open)); });
  $$('.side a').forEach(a => a.addEventListener('click', () => document.body.classList.remove('nav-open')));
  $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($(b.dataset.copy).textContent); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); } catch { b.textContent = 'Press Ctrl+C'; }
  }));

  const data = $('#page-data');
  if (data) demo(JSON.parse(data.textContent));
  setTheme(theme);

  function demo(D) {
    frame = $('#demo'); const stage = $('#stage'), status = $('#try-status');
    const saved = (() => { try { return localStorage.getItem('ux-view'); } catch { return null; } })();
    let vp = Math.max(0, D.views.findIndex(v => (saved ? (saved === 'phone') === v.phone : innerWidth < 760 ? v.phone : !v.phone))), extra = '';
    const size = () => {
      const v = D.views[vp], width = stage.clientWidth;
      frame.style.width = (v.phone ? Math.min(v.w, width) : width) + 'px';
      const top = stage.getBoundingClientRect().top + scrollY;
      if (stage.hasAttribute('data-full')) { frame.style.height = stage.clientHeight + 'px'; return; }
      frame.style.height = Math.max(v.phone ? 480 : 520, Math.min(v.h, innerHeight - top - 12)) + 'px';
    };
    const mark = () => {
      $$('[data-vp]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.vp === vp)));
      $$('[data-try]').forEach(b => { b.hidden = !D.tries[+b.dataset.try].steps[D.views[vp].name]; });
      $$('[data-variant]').forEach(b => { const v = D.variants[+b.dataset.variant]; b.setAttribute('aria-pressed', String(v.query === extra)); b.setAttribute('aria-checked', String(v.query === extra)); b.hidden = !!v.only && v.only !== D.views[vp].name; });
      $$('.menu-section').forEach(s => { s.hidden = !$$('.menu-item', s).some(b => !b.hidden); });
      // Only a non-default choice shows in the bar.
      const chip = $('#options-chip'), on = D.variants.find(v => v.query === extra && extra);
      if (chip) { chip.hidden = !on; chip.textContent = on ? on.label + ' ×' : ''; chip.title = 'Back to the default'; }
    };
    const load = () => new Promise(done => {
      const v = D.views[vp], url = D.base + 'demo.html?' + [v.query, extra, theme === 'dark' ? 'dark=1' : ''].filter(Boolean).join('&');
      run++; mark(); size();
      frame.addEventListener('load', () => done(), { once: true });
      frame.contentWindow.location.replace(url);
    });
    $$('[data-vp]').forEach(b => b.addEventListener('click', () => { vp = +b.dataset.vp; try { localStorage.setItem('ux-view', D.views[vp].phone ? 'phone' : 'desktop'); } catch { /* private mode */ } void load(); }));
    // A start state is also in the page's address (?state=tray), so a link reproduces it; the demo's own address is unchanged.
    const slug = label => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const choose = q => {
      extra = q;
      const v = D.variants.find(x => x.query === q);
      try { const url = new URL(location.href); if (v) url.searchParams.set('state', slug(v.label)); else url.searchParams.delete('state'); history.replaceState(null, '', url); } catch { /* not a page address */ }
    };
    $$('[data-variant]').forEach(b => b.addEventListener('click', () => { const q = D.variants[+b.dataset.variant].query; choose(extra === q ? '' : q); void load(); }));
    $('#options-chip')?.addEventListener('click', () => { choose(''); void load(); });
    const fromAddress = new URLSearchParams(location.search).get('state'), first = D.variants.find(v => slug(v.label) === fromAddress);
    if (first) extra = first.query;
    // The top bar's Play menu (and the page's own buttons): the scenario's "things to try", each reloads the demo and plays its steps in it.
    const playTry = async index => {
      const item = D.tries[index];
      $$('[data-try]:not(.menu-item)').forEach(x => { x.disabled = true; });
      status && (status.textContent = 'Loading the demo…');
      extra = item.query || '';
      await load(); const mine = run; await ready(D.ready); await sleep(400);
      const steps = item.steps[D.views[vp].name];
      if (!steps) { $$('[data-try]:not(.menu-item)').forEach(x => { x.disabled = false; }); status && (status.textContent = ''); return; }
      status && (status.textContent = 'Playing: ' + item.label);
      const ok = await play(steps, () => mine === run);
      $$('[data-try]:not(.menu-item)').forEach(x => { x.disabled = false; });
      status && (status.textContent = mine !== run ? '' : ok ? 'Done. Keep going in the demo.' : 'Stopped: this step did not complete.');
    };
    $$('[data-try]').forEach(b => b.addEventListener('click', () => { void playTry(+b.dataset.try); }));
    $('[data-reset]')?.addEventListener('click', () => { void load(); });
    addEventListener('resize', size);
    void load();
  }

  async function ready(selector) {
    for (let i = 0; i < 120; i++) { try { if (frame.contentDocument.querySelector(selector || '[data-testid]')) return; } catch { /* loading */ } await sleep(100); }
  }

  async function play(steps, alive) {
    const win = frame.contentWindow, doc = frame.contentDocument;
    const shown = e => e.getClientRects().length > 0;
    const until = async (js, timeout = 3000) => { const t = Date.now(); while (Date.now() - t < timeout) { try { if (win.eval(js)) return true; } catch { /* page not ready */ } await sleep(80); } return false; };
    const find = async s => {
      for (let i = 0; i < 50; i++) {
        let el;
        if (s.sel) el = $$(s.sel, doc).find(shown);
        else if (s.choice) el = $$('[data-choice]', doc).find(e => e.textContent.includes(s.choice) && shown(e));
        else if (s.text) el = $$('body *', doc).find(e => e.textContent.includes(s.text) && shown(e) && ![...e.children].some(c => c.textContent.includes(s.text)));
        if (el) return el;
        await sleep(80);
      }
    };
    const tap = el => { el.focus?.(); for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (type.startsWith('pointer') ? win.PointerEvent : win.MouseEvent)(type, { bubbles: true, cancelable: true, composed: true, button: 0, view: win, pointerType: 'mouse', isPrimary: true })); };
    const type = (el, text) => {
      if (/^(TEXTAREA|INPUT)$/.test(el.tagName)) { const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, el.value + text); el.dispatchEvent(new win.Event('input', { bubbles: true })); }
      else doc.execCommand('insertText', false, text);
    };
    for (const s of steps) {
      if (!alive()) return false;
      if (s.when && !win.eval(s.when)) continue;
      if (s.do === 'wait') await sleep(Math.min(s.ms ?? 300, 600));
      else if (s.do === 'fixture') win.__ux?.[s.name]?.(s.arg);
      else if (s.do === 'press') { const el = doc.activeElement ?? doc.body; for (const key of s.key.split(' ')) { if (key === 'Tab') continue; for (const t of ['keydown', 'keyup']) el.dispatchEvent(new win.KeyboardEvent(t, { key, bubbles: true, cancelable: true })); await sleep(120); } }
      else {
        const el = s.sel || s.text || s.choice ? await find(s) : doc.activeElement;
        if (!el) { window.__fail = ['find', s]; return false; }
        if (s.do === 'tap' || s.do === 'click') tap(el);
        else if (s.do === 'focus') el.focus();
        else if (s.do === 'scroll') el.scrollTop = s.to ?? 0;
        else if (s.do === 'type') { if (s.sel) el.focus(); type(el, s.input); }
      }
      if (s.until && !await until(s.until, Math.max(s.timeout ?? 0, 3000)) && !s.soft) { window.__fail = ['until', s]; return false; }
      await sleep(350);
    }
    return true;
  }
})();
