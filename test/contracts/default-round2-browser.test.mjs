import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const harness = process.env.DEFAULT_PREVIEW_DIR;
const round = process.env.DEFAULT_PREVIEW_ROUND;
const stage = process.env.DEFAULT_FIX_STAGE;
test('round 2 defaults: exact body roles, projected theme boundary and task row layout', { skip: !process.env.CHROMIUM || !harness || !round }, async () => {
  assert.ok(['roles', 'board-theme', 'task-layout'].includes(stage));
  const out = resolve(process.env.DEFAULT_FIX_EVIDENCE);
  assert.ok(!existsSync(out), 'Use fresh evidence, never a reviewed snapshot');
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
    for (let i = 0; i < 3; i++) await browser.evaluate(`new Promise(requestAnimationFrame).then(() => Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {}))))`);
  };
  try {
    for (const mode of ['light', 'dark']) for (const width of [1440, 390]) {
      const scene = stage === 'roles' ? 'report' : stage === 'board-theme' ? 'board' : 'tasks';
      const label = `${stage}/${width}/${mode}`;
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?scene=${scene}&mode=${mode}` });
      await browser.until('Actual scene ready', `!!document.querySelector('[data-proof-scene="${scene}"]') && document.readyState === 'complete'`);
      await settle();
      if (stage === 'roles') {
        await browser.until('Real report form', `!!document.querySelector('[data-slot=field-error]')`);
        const data = await browser.evaluate(`(() => {
          const visible=n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0;
          const read=n=>({slot:n.dataset.slot,text:n.textContent,font:getComputedStyle(n).fontSize});
          return {body:[...document.querySelectorAll('[data-slot=field-label],[data-slot=field-description],[data-slot=field-error],[data-slot=sidebar-menu-button],[data-testid=nav-user] .font-medium')].filter(visible).map(read),titles:[...document.querySelectorAll('[data-slot=card-title]')].filter(visible).map(read),input:getComputedStyle(document.querySelector('#recipient')).fontSize};
        })()`);
        check(data.body.length >= 5 && data.body.every(n => n.font === '12px'), `${label}: ordinary nav/field/account roles must be 12px: ${JSON.stringify(data.body)}`);
        check(data.titles.length > 0 && data.titles.every(n => n.font === '14px'), `${label}: semantic Card titles stay 14px`);
        check(data.input === (width === 390 ? '16px' : '12px'), `${label}: editable exception`);
        await browser.evaluate(`document.querySelector('[data-proof-menu]').scrollIntoView({block:'center'})`);
        await browser.click(`document.querySelector('[data-proof-menu]')`);
        await browser.until('Real Dropdown portal', `!!document.querySelector('[data-slot=dropdown-menu-item]')`);
        await settle();
        data.menu = await browser.evaluate(`[...document.querySelectorAll('[data-slot=dropdown-menu-item]')].map(n=>({text:n.textContent,font:getComputedStyle(n).fontSize,portal:!n.closest('[data-proof-scene]')}))`);
        check(data.menu.length > 0 && data.menu.every(n => n.font === '12px' && n.portal), `${label}: actual portalled menu body at 12px: ${JSON.stringify(data.menu)}`);
        records.push({ mode, width, ...data });
      }
      if (stage === 'board-theme') {
        await browser.until('Native board mounted', `!!document.querySelector('[aria-label="Board tools"]')`, 30000);
        // Fit then native touch pinch: hidden tldraw UI has no keyboard zoom shortcuts.
        // Zoom around the actual link so it remains readable/in-view, including the phone's read-only canvas.
        // BoardCanvas has a 400ms mount-fit retry; let it finish before the user's Fit action.
        await browser.evaluate('new Promise(done => setTimeout(done, 500))');
        await browser.click(`document.querySelector('[aria-label="Fit board"]')`);
        await browser.evaluate('new Promise(done => setTimeout(done, 500))');
        await settle();
        const linkBox = `(() => {const n=[...document.querySelectorAll('[data-testid=board-frame] button')].find(n=>n.textContent==='Book another session'),r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};})()`;
        await browser.until('Booking projection visible after native Fit', `(${linkBox}).height > 0`);
        await browser.click(`[...document.querySelectorAll('[data-testid=board-frame]')].find(n=>n.textContent.includes('Book another session'))`);
        for (let i = 0; i < 8; i++) {
          const box = await browser.evaluate(linkBox);
          if (box.height >= (width === 390 ? 44 : 28)) break;
          await browser.send('Input.synthesizePinchGesture', { x: box.x, y: box.y, scaleFactor: 1.5, relativeSpeed: 800, gestureSourceType: 'touch' });
          await settle();
        }
        await settle();
        const data = await browser.evaluate(`(() => {
          const frame=[...document.querySelectorAll('[data-testid=board-frame]')].find(n=>n.textContent.includes('Book another session'));
          const link=[...frame.querySelectorAll('button')].find(n=>n.textContent==='Book another session');
          const rgb=color=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data];};
          const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
          // tldraw paints a sibling canvas, not an ancestor. Start at its actual canvas fill, then composite the DOM ancestry.
          const native=document.querySelector('.tl-background');
          let bg=rgb(getComputedStyle(native).backgroundColor); if(bg[3]===0)bg=[255,255,255,255];
          const nativeBackground=bg;
          const chain=[];for(let p=link;p&&p!==frame.parentElement;p=p.parentElement)chain.unshift(p);
          const fills=[];for(const p of chain){const c=rgb(getComputedStyle(p).backgroundColor),a=c[3]/255;if(a)fills.push({slot:p.dataset.slot,testId:p.dataset.testid,color:c});bg=c.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a)).concat(255);}
          const foreground=rgb(getComputedStyle(link).color),a=foreground[3]/255,ink=foreground.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a));
          const x=lum(ink),y=lum(bg),r=link.getBoundingClientRect();
          return {foreground,background:bg,nativeBackground,fills,ratio:(Math.max(x,y)+.05)/(Math.min(x,y)+.05),link:{x:r.x,y:r.y,width:r.width,height:r.height,font:getComputedStyle(link).fontSize},frameSlot:frame.dataset.slot,nestedCards:[...document.querySelectorAll('[data-testid=board-frame] [data-slot=card]')].filter(n=>n.parentElement.closest('[data-slot=card]')).length,htmlBoundary:[...document.querySelectorAll('[data-testid=board-frame]')].filter(n=>n.querySelector('[data-boring=mockup-viewer]')).map(n=>getComputedStyle(n).backgroundColor)};
        })()`);
        check(data.ratio >= 4.5, `${label}: booking link against actual RGBA background ${data.ratio}: ${JSON.stringify(data)}`);
        check(data.frameSlot !== 'card' && data.nestedCards === 0, `${label}: no nested Cards`);
        check(data.link.height >= (width === 390 ? 44 : 28) && data.link.x >= 0 && data.link.x+data.link.width <= width && data.link.y >= 0 && data.link.y+data.link.height <= 1000, `${label}: native camera shows readable booking link: ${JSON.stringify(data.link)}`);
        check(data.htmlBoundary.length === 1 && data.htmlBoundary.every(c=>c==='rgba(0, 0, 0, 0)'), `${label}: authored HTML frame remains transparent`);
        records.push({ mode, width, ...data });
      }
      if (stage === 'task-layout') {
        await browser.until('Actual task rows', `document.querySelectorAll('[data-task-id]').length >= 2`);
        const measure = `(() => {const root=document.querySelector('[data-boring=task-list-viewer]');const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return {title:getComputedStyle(root.querySelector('h2')).fontSize,body:getComputedStyle(root.querySelector('li label')).fontSize,rows:[...root.querySelectorAll('li')].map(n=>({row:rect(n),label:rect(n.querySelector('label')),checkbox:rect(n.querySelector('[role=checkbox]')),remove:rect(n.querySelector('button:last-child')),labelDisplay:getComputedStyle(n.querySelector('label')).display,labelGap:parseFloat(getComputedStyle(n.querySelector('label')).columnGap)})),form:{display:getComputedStyle(root.querySelector('form')).display,gap:parseFloat(getComputedStyle(root.querySelector('form')).rowGap)},actions:{display:getComputedStyle(root.querySelector('.boring-task-list-actions')).display,gap:parseFloat(getComputedStyle(root.querySelector('.boring-task-list-actions')).columnGap)}};})()`;
        const data = await browser.evaluate(measure);
        check(data.title === '14px' && data.body === '12px', `${label}: task title/body roles ${data.title}/${data.body}`);
        check(data.rows.every(n => n.labelDisplay === 'flex' && n.labelGap >= 8 && Math.abs(n.checkbox.y+n.checkbox.height/2-n.label.y-n.label.height/2)<1), `${label}: checkbox and local label must align with gap: ${JSON.stringify(data.rows)}`);
        check(data.rows.every(n => Math.abs(n.remove.right-data.rows[0].remove.right)<1), `${label}: consistent Remove action column`);
        check(['grid','flex'].includes(data.form.display) && data.form.gap >= 8 && data.actions.display === 'flex' && data.actions.gap >= 8, `${label}: explicit form/action spacing ${JSON.stringify(data)}`);
        await browser.type(`document.querySelector('[data-boring=task-list-viewer] form input')`, 'Fictional new task');
        await browser.click(`[...document.querySelectorAll('[data-boring=task-list-viewer] button')].find(n=>n.textContent==='Add task')`);
        await browser.until('Real controller adds task', `[...document.querySelectorAll('[data-task-id] label')].some(n=>n.textContent==='Fictional new task')`);
        await browser.click(`document.querySelector('[aria-label="Complete Fictional new task"]')`);
        await browser.until('Real Checkbox edits task', `document.querySelector('[aria-label="Complete Fictional new task"]').getAttribute('aria-checked')==='true'`);
        await browser.click(`[...document.querySelectorAll('[data-boring=task-list-viewer] button')].find(n=>n.textContent==='Save')`);
        await browser.until('Real controller flushes', `document.querySelector('[data-boring=task-list-viewer] [role=status]').textContent.startsWith('Saved')`);
        data.afterAdd = await browser.evaluate(measure);
        records.push({ mode, width, ...data });
      }
      await browser.screenshot(`${stage}-${width}-${mode}.png`);
    }
    check(browser.problems.length === 0, `Browser errors: ${JSON.stringify(browser.problems)}`);
  } finally {
    writeFileSync(join(out, 'measurements.json'), JSON.stringify({ stage, round, records, failures }, null, 2));
    await browser.close();
    await new Promise(done => server.close(done));
  }
  assert.deepEqual(failures, []);
});
