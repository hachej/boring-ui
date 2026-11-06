import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Read-only source-combined harness. No CSS/DOM substitutions: each check drives the real owning component.
const harness = process.env.DEFAULT_PREVIEW_DIR;
const round = process.env.DEFAULT_PREVIEW_ROUND;
const stage = process.env.DEFAULT_FIX_STAGE;
test('default integration: status contrast, sidebar widths, canvas frames and document type', { skip: !process.env.CHROMIUM || !harness || !round }, async () => {
  assert.ok(['contrast', 'sidebar', 'board', 'typography', 'chat-body'].includes(stage), 'Select one focused fix stage');
  const out = resolve(process.env.DEFAULT_FIX_EVIDENCE);
  assert.ok(!existsSync(out), 'Use a unique evidence directory');
  mkdirSync(out, { recursive: true });
  const root = join(harness, 'rounds', round);
  writeFileSync(join(out, 'source-manifest.json'), readFileSync(join(root, 'manifest.json')));
  writeFileSync(join(out, 'executed-test.mjs'), readFileSync(new URL(import.meta.url)));
  const { serveRound } = await import(pathToFileURL(join(harness, 'serve.mjs')));
  const { launch } = await import(pathToFileURL(join(root, 'browser.mjs')));
  const server = await serveRound(round);
  const browser = await launch('about:blank', { evidence: out });
  const records = [], failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const settle = async () => {
    await browser.evaluate('document.fonts.ready');
    for (let i = 0; i < 3; i++) await browser.evaluate(`new Promise(requestAnimationFrame).then(() => Promise.race([Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {}))), new Promise((_, reject) => setTimeout(() => reject(Error('Finite motion timeout')), 5000))]))`);
  };
  try {
    for (const mode of ['light', 'dark']) for (const width of [1440, 390]) {
      const scene = stage === 'board' ? 'board' : stage === 'typography' ? 'annotations' : stage === 'chat-body' ? 'chat' : 'report';
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?scene=${scene}&mode=${mode}` });
      await browser.until('Real scene', `document.querySelector('[data-proof-scene="${scene}"]') && document.readyState === 'complete'`);
      if (scene === 'board') await browser.until('Native canvas ready', `!!document.querySelector('[aria-label="Board tools"]')`, 30000);
      if (scene === 'annotations') await browser.until('Real document headings', `!!document.querySelector('.boring-markdown-content h2')`);
      if (scene === 'chat') await browser.until('Real messages and Composer', `!!document.querySelector('[data-role=user] [data-testid=user-text]') && !!document.querySelector('[data-role=assistant] [data-slot=bubble-content]') && !!document.querySelector('[data-testid=composer-input]')`);
      await settle();
      const data = await browser.evaluate(`(() => {
        const visible = n => n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0;
        const box = n => ({tag:n.tagName, slot:n.dataset.slot, testId:n.dataset.testid, className:typeof n.className==='string'?n.className:null, text:n.textContent.slice(0,100), client:n.clientWidth, scroll:n.scrollWidth, width:n.getBoundingClientRect().width, font:getComputedStyle(n).fontSize});
        const rgb = color => { const c=document.createElement('canvas'); c.width=c.height=1; const ctx=c.getContext('2d'); ctx.fillStyle=color; ctx.fillRect(0,0,1,1); return [...ctx.getImageData(0,0,1,1).data]; };
        const luminance = c => c.slice(0,3).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((v,n,i)=>v+n*[0.2126,0.7152,0.0722][i],0);
        const contrast = n => { let bg=[255,255,255,255]; const chain=[]; for(let p=n;p;p=p.parentElement)chain.unshift(p); for(const p of chain){const c=rgb(getComputedStyle(p).backgroundColor),a=c[3]/255;bg=c.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a)).concat(255);} const fg=rgb(getComputedStyle(n).color); const a=luminance(fg),b=luminance(bg);return {...box(n),foreground:fg,background:bg,ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)}; };
        const sidebar=document.querySelector('[data-slot=sidebar-content]');
        const frames=[...document.querySelectorAll('[data-testid=board-frame]')].filter(visible);
        return {chatCopy:[...document.querySelectorAll('[data-role=user] [data-testid=user-text],[data-role=assistant] [data-slot=bubble-content],[data-role=assistant] [data-slot=bubble-content] p,[data-slot=attachment-title],[data-slot=attachment-description]')].filter(visible).map(box), composer:[...document.querySelectorAll('[data-testid=composer-input]')].filter(visible).map(box), page:{client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}, statuses:[...document.querySelectorAll('[data-proof-scene] [data-slot=badge],[data-proof-scene] [data-slot=alert-description],[data-proof-scene] button.bg-destructive-soft:not(:disabled)')].filter(visible).map(contrast), disabled:[...document.querySelectorAll('button:disabled')].filter(visible).map(n=>({opacity:getComputedStyle(n).opacity})), sidebar:sidebar&&visible(sidebar)?{...box(sidebar),overflowX:getComputedStyle(sidebar).overflowX,children:[...sidebar.querySelectorAll('*')].filter(visible).map(box)}:null, tables:[...document.querySelectorAll('[data-proof-table]')].filter(visible).flatMap(n=>[n,...n.querySelectorAll('table,ul,td,th,dd')].filter(visible).map(box)), frames:frames.map(n=>({...box(n),slot:n.dataset.slot,cardAncestors:[...n.querySelectorAll('[data-slot=card]')].filter(c=>c.parentElement.closest('[data-slot=card]')).length,text:n.innerText})), formattingIcon:{phosphor:!!document.querySelector('[data-boring=markdown-editor] header button svg[viewBox="0 0 256 256"] path[d^="M208,56V88"]'),staleLucide:!!document.querySelector('[data-boring=markdown-editor] header button svg.lucide-type'),wrongPath:!!document.querySelector('[data-boring=markdown-editor] header button svg[viewBox="0 0 256 256"] path[d^="M999"]')}, headings:[...document.querySelectorAll('.boring-markdown-content h1,.boring-markdown-content h2')].filter(visible).map(box), body:[...document.querySelectorAll('.boring-markdown-content p')].filter(visible).map(box), chrome:[...document.querySelectorAll('[data-boring=markdown-editor] button')].filter(visible).map(box), blockers:[...document.querySelectorAll('[data-preview-blocker]')].map(n=>n.textContent)};
      })()`);
      records.push({ mode, width, scene, ...data });
      await browser.screenshot(`${stage}-${width}-${mode}.png`);
      check(!data.blockers.length, `${width}/${mode}: component blocker`);
      check(data.page.scroll <= data.page.client + 1, `${width}/${mode}: page width`);
      for (const t of data.tables.filter(n => !n.className?.split(' ').includes('truncate'))) check(t.scroll <= t.client + 1, `${width}/${mode}: internal table width ${JSON.stringify(t)}`);
      if (stage === 'contrast') {
        await browser.evaluate(`document.querySelector('[data-slot=alert-description]').scrollIntoView({block:'center'})`);
        await settle();
        await browser.screenshot(`status-copy-${width}-${mode}.png`);
        check(data.statuses.length >= 7 && data.statuses.some(n => n.tag === 'BUTTON' && n.text === 'Remove draft'), 'Real default badge, semantic statuses, description and enabled destructive Button mounted');
        for (const n of data.statuses) check(n.ratio >= 4.5, `${width}/${mode}: ${n.slot} ${n.text} contrast ${n.ratio}`);
        check(data.disabled.length > 0 && data.disabled.every(n => +n.opacity <= 0.5), 'Disabled state remains distinct');
      }
      if (stage === 'sidebar' && width === 1440) {
        check(data.sidebar?.scroll <= data.sidebar?.client + 1, `${mode}: sidebar internal overflow ${data.sidebar?.client}/${data.sidebar?.scroll}`);
        const nav = '[data-testid="nav-report"]';
        await browser.evaluate(`document.querySelector('${nav}').focus()`);
        await browser.press('Enter');
        check(await browser.evaluate(`document.querySelector('${nav}').hasAttribute('data-active')`), 'Keyboard nav activates report');
        await browser.evaluate(`document.querySelector('[data-testid=nav-user]').focus()`);
        await browser.press('Enter');
        await browser.until('Account keyboard menu', `!!document.querySelector('[role=menu]')`);
        await browser.press('ArrowDown');
        check(await browser.evaluate(`document.activeElement.matches('[role^=menuitem]')`), 'Account items keyboard reachable');
        await browser.press('Escape');
        await settle();
        check(await browser.evaluate(`document.activeElement.matches('[data-testid=nav-user]')`), 'Account returns focus');
        await browser.evaluate(`document.querySelector('[data-testid=nav-agent]').focus()`);
        await browser.press('Enter');
        await settle();
        check(await browser.evaluate(`document.querySelector('[data-testid=agent-layer]')?.dataset.state !== 'closed'`), 'Agent action keyboard toggles layer');
      }
      if (stage === 'board') {
        check(data.frames.length > 0 && data.frames.some(n => n.text.includes('Book')), 'Actual authored booking maquette projected');
        check(data.frames.every(n => n.slot !== 'card' && n.cardAncestors === 0), 'Projection is a viewport, not a nested Card');
        await browser.click(`document.querySelector('[aria-label="Fit board"]')`);
        await settle();
        check(await browser.evaluate(`!!document.querySelector('.tl-container [data-testid=board-frame]')`), 'Native canvas Fit preserves projection');
      }
      if (stage === 'chat-body') {
        check(data.chatCopy.length >= 2 && data.chatCopy.every(n => n.font === '12px'), `User/assistant body copy at 12px: ${JSON.stringify(data.chatCopy)}`);
        check(data.composer.length === 1 && data.composer[0].font === (width === 390 ? '16px' : '12px'), `Composer desktop 12px/mobile 16px: ${JSON.stringify(data.composer)}`);
        await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?scene=chat&mode=${mode}&state=loading` });
        await browser.until('Real loading conversation status', `!!document.querySelector('[data-testid=loading]')`);
        await settle();
        const loading = await browser.evaluate(`({body:getComputedStyle(document.querySelector('[data-testid=loading]')).fontSize,title:getComputedStyle(document.querySelector('[data-boring=pi-chat] h2')).fontSize})`);
        records.push({ mode, width, scene: 'chat-loading', ...loading });
        await browser.screenshot(`chat-loading-${width}-${mode}.png`);
        check(loading.body === '12px' && loading.title === '14px', `Loading copy/title: ${JSON.stringify(loading)}`);
        await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?scene=factory-pm&mode=${mode}&state=empty` });
        await browser.until('Actual PM placeholder overlay', `!!document.querySelector('[data-slot=composer-placeholder]')`);
        await settle();
        const emptyField = await browser.evaluate(`(() => { const hint=document.querySelector('[data-slot=composer-placeholder]'),field=document.querySelector('[data-testid=composer-input]'),h=hint.getBoundingClientRect(),f=field.getBoundingClientRect();return {hint:getComputedStyle(hint).fontSize,input:getComputedStyle(field).fontSize,x:f.x,y:f.y,width:f.width,hintInside:h.x>=f.x&&h.right<=f.right&&h.y>=f.y&&h.bottom<=f.bottom};})()`);
        await browser.screenshot(`pm-placeholder-${width}-${mode}.png`);
        check(emptyField.hint==='12px' && emptyField.input===(width===390?'16px':'12px') && emptyField.hintInside, `PM overlay/input distinction: ${JSON.stringify(emptyField)}`);
        await browser.type(`document.querySelector('[data-testid=composer-input]')`, 'Fictional note');
        await browser.until('Hint disappears on real input', `!document.querySelector('[data-slot=composer-placeholder]')`);
        await settle();
        const typedField = await browser.evaluate(`(() => {const n=document.querySelector('[data-testid=composer-input]'),r=n.getBoundingClientRect();return {text:n.value,start:n.selectionStart,end:n.selectionEnd,focused:document.activeElement===n,x:r.x,y:r.y,width:r.width,font:getComputedStyle(n).fontSize};})()`);
        records.push({mode,width,scene:'factory-pm-input-transition',emptyField,typedField});
        await browser.screenshot(`pm-typed-${width}-${mode}.png`);
        check(typedField.text==='Fictional note' && typedField.start===14 && typedField.end===14 && typedField.focused, `Native text/caret: ${JSON.stringify(typedField)}`);
        check(typedField.font===emptyField.input && Math.abs(typedField.x-emptyField.x)<1 && Math.abs(typedField.y-emptyField.y)<1 && Math.abs(typedField.width-emptyField.width)<1, 'Input font and geometry remain stable when hint disappears');
      }
      if (stage === 'typography') {
        check(data.formattingIcon.phosphor && !data.formattingIcon.staleLucide && !data.formattingIcon.wrongPath, 'Real TextT glyph passes exact Phosphor path/viewBox; stale Lucide and wrong-path controls fail');
        for (const path of ['test/fixtures/registry-markdown.mjs', 'scripts/test-viewer-chrome.mjs']) check(readFileSync(path, 'utf8').includes('svg[viewBox="0 0 256 256"] path[d^="M208,56V88"]'), `${path}: uses the rendered identity selector`);
        check(data.headings.some(n=>n.tag==='H1') && data.headings.some(n=>n.tag==='H2'), 'Semantic h1/h2 retained');
        check(data.headings.every(n=>n.font==='14px'), 'Document headings use 14px default title');
        check(data.body.length>0 && data.body.every(n=>n.font==='12px'), 'Document body uses 12px default');
        check(data.chrome.length>0 && data.chrome.every(n=>parseFloat(n.font)<=14), 'Editor chrome remains compact');
      }
    }
    check(browser.problems.length === 0, `Browser errors: ${JSON.stringify(browser.problems)}`);
  } finally {
    writeFileSync(join(out, 'measurements.json'), JSON.stringify({ round, stage, records, failures }, null, 2));
    await browser.close();
    await new Promise(done => server.close(done));
  }
  assert.deepEqual(failures, []);
});
