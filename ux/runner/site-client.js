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
    let vp = Math.max(0, D.views.findIndex(v => (innerWidth < 760 ? v.phone : !v.phone))), extra = '';
    const size = () => {
      const v = D.views[vp], width = stage.clientWidth;
      frame.style.width = (v.phone ? Math.min(v.w, width) : width) + 'px';
      frame.style.height = (v.phone ? (innerWidth < 760 ? Math.max(560, Math.min(v.h, innerHeight * 0.82)) : Math.min(v.h, 780)) : Math.min(v.h, 660)) + 'px';
    };
    const mark = () => {
      $$('[data-vp]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.vp === vp)));
      $$('[data-try]').forEach(b => { b.hidden = !D.tries[+b.dataset.try].steps[D.views[vp].name]; });
      $$('[data-variant]').forEach(b => { const v = D.variants[+b.dataset.variant]; b.setAttribute('aria-pressed', String(v.query === extra)); b.hidden = !!v.only && v.only !== D.views[vp].name; });
    };
    const load = () => new Promise(done => {
      const v = D.views[vp], url = D.base + 'demo.html?' + [v.query, extra, theme === 'dark' ? 'dark=1' : ''].filter(Boolean).join('&');
      run++; mark(); size();
      frame.addEventListener('load', () => done(), { once: true });
      frame.contentWindow.location.replace(url);
    });
    $$('[data-vp]').forEach(b => b.addEventListener('click', () => { vp = +b.dataset.vp; void load(); }));
    $$('[data-variant]').forEach(b => b.addEventListener('click', () => { const q = D.variants[+b.dataset.variant].query; extra = extra === q ? '' : q; void load(); }));
    $$('[data-try]').forEach(b => b.addEventListener('click', async () => {
      const item = D.tries[+b.dataset.try];
      await load(); const mine = run; await sleep(700);
      const steps = item.steps[D.views[vp].name]; if (!steps) return;
      $$('[data-try]').forEach(x => { x.disabled = true; });
      status.textContent = 'Playing: ' + item.label;
      const ok = await play(steps, () => mine === run);
      $$('[data-try]').forEach(x => { x.disabled = false; });
      status.textContent = mine !== run ? '' : ok ? 'Done. Keep going in the demo.' : 'Stopped: this step did not complete.';
    }));
    addEventListener('resize', size);
    void load();
  }

  async function play(steps, alive) {
    const win = frame.contentWindow, doc = frame.contentDocument;
    const shown = e => e.getClientRects().length > 0;
    const until = async (js, timeout = 1500) => { const t = Date.now(); while (Date.now() - t < timeout) { try { if (win.eval(js)) return true; } catch { /* page not ready */ } await sleep(80); } return false; };
    const find = async s => {
      for (let i = 0; i < 50; i++) {
        let el;
        if (s.sel) el = $$(s.sel, doc).find(shown);
        else if (s.choice) el = $$('[data-choice]', doc).find(e => e.textContent.includes(s.choice) && shown(e));
        else if (s.text) el = $$('button,a,[role=row],[role=button],[tabindex],li,span,p', doc).filter(e => e.textContent.includes(s.text) && shown(e)).sort((a, b) => a.textContent.length - b.textContent.length)[0];
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
      if (s.until && !await until(s.until, s.timeout ?? 1500) && !s.soft) { window.__fail = ['until', s]; return false; }
      await sleep(350);
    }
    return true;
  }
})();
