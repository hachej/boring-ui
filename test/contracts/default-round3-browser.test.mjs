import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const harness = process.env.DEFAULT_PREVIEW_DIR;
const round = process.env.DEFAULT_PREVIEW_ROUND;
test('round 3 body roles: real chat/detached activity and annotation selection hint', { skip: !process.env.CHROMIUM || !harness || !round }, async () => {
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
    for (const scene of ['chat', 'detached', 'annotations']) for (const mode of ['light', 'dark']) for (const width of [1440, 390]) {
      const label = `${scene}/${width}/${mode}`;
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?scene=${scene}&mode=${mode}` });
      await browser.until('Actual scene ready', `!!document.querySelector('[data-proof-scene="${scene}"]') && document.readyState === 'complete'`);
      const selector = scene === 'annotations' ? '[data-boring=highlights] [data-slot=item-description]' : '[data-testid=activity] [data-testid=activity-count]';
      await browser.until('Real covered role mounted', `!!document.querySelector('${selector}')`);
      await settle();
      const data = await browser.evaluate(`(() => {
        const visible=n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0;
        const rgb=color=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data];};
        const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
        const read=n=>{
          let bg=[255,255,255,255];const chain=[];for(let p=n;p;p=p.parentElement)chain.unshift(p);
          for(const p of chain){const c=rgb(getComputedStyle(p).backgroundColor),a=c[3]/255;bg=c.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a)).concat(255);}
          const foreground=rgb(getComputedStyle(n).color),a=foreground[3]/255,ink=foreground.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a)),x=lum(ink),y=lum(bg);
          return {slot:n.dataset.slot,testId:n.dataset.testid,text:n.textContent,font:getComputedStyle(n).fontSize,foreground,background:bg,ratio:(Math.max(x,y)+.05)/(Math.min(x,y)+.05),enabled:!n.closest('button:disabled,[data-disabled]'),status:n.closest('[data-testid=activity]')?.dataset.state};
        };
        return {body:[...document.querySelectorAll('[data-testid=activity] [data-testid=activity-label],[data-testid=activity] [data-testid=activity-count],[data-boring=highlights] [data-slot=item-description]')].filter(visible).map(read),titles:[...document.querySelectorAll('[data-slot=card-title],[data-slot=item-title],.boring-markdown-content h1,.boring-markdown-content h2')].filter(visible).map(read)};
      })()`);
      check(data.body.length >= (scene === 'annotations' ? 1 : 2) && data.body.every(n => n.font === '12px'), `${label}: ordinary copy must be exactly 12px: ${JSON.stringify(data.body)}`);
      check(data.titles.every(n => n.font === '14px'), `${label}: semantic titles stay 14px: ${JSON.stringify(data.titles)}`);
      if (scene !== 'annotations') {
        const normal = data.body.filter(n => n.enabled && n.status === 'done');
        check(normal.length >= 2 && normal.every(n => n.ratio >= 4.5), `${label}: normal enabled activity summary/count contrast: ${JSON.stringify(normal)}`);
        const trigger = `document.querySelector('[data-testid=activity] [data-slot=trace-collapsible-trigger]')`;
        await browser.click(trigger);
        await browser.until('Native activity expands', `document.querySelector('[data-testid=activity]').dataset.open==='true'`);
        await browser.click(trigger);
        await browser.until('Native activity collapses', `document.querySelector('[data-testid=activity]').dataset.open==='false'`);
      }
      records.push({ scene, mode, width, ...data });
      await browser.screenshot(`body-roles-${scene}-${width}-${mode}.png`);
    }
    check(browser.problems.length === 0, `Browser errors: ${JSON.stringify(browser.problems)}`);
  } finally {
    writeFileSync(join(out, 'measurements.json'), JSON.stringify({ round, records, failures }, null, 2));
    await browser.close();
    await new Promise(done => server.close(done));
  }
  assert.deepEqual(failures, []);
});
