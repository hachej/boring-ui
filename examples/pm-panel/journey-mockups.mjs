// Local, fictional native proof only: not a deployed Coach Max/Studio or Factory Task Worker test.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { startMockups } from './mockups-server.mjs';

const evidence = process.env.PM_EVIDENCE ?? '.cache/evidence/pm-mockup-rendering/browser';
mkdirSync(evidence, { recursive: true });
const proof = [];
let browser;
try {
  browser = await launch('about:blank', { evidence });
  for (const surface of ['studio', 'member']) for (const device of ['phone', 'desktop']) {
    const app = await startMockups();
    try {
      await browser.emulate(device);
      await browser.send('Emulation.setDeviceMetricsOverride', { width: device === 'phone' ? 375 : 1280, height: device === 'phone' ? 812 : 900, deviceScaleFactor: 1, mobile: device === 'phone' });
      const press = selector => device === 'phone' ? browser.tap(selector) : browser.click(selector);
      await browser.send('Page.navigate', { url: app.url + (surface === 'member' ? '?member=1' : '') });
      await browser.until('composer', `!!${q('[data-testid=composer-input]')}`);
      await browser.type(q('[data-testid=composer-input]'), 'Trois maquettes fictives');
      await press(q('[data-testid=composer-submit]'));
      await browser.until('three presented cards and native choice', `document.querySelectorAll('[data-testid=pm-mockup]').length === 3 && document.querySelectorAll('[data-testid=question-option]').length === 3`);
      await browser.until('three thumbnails', `document.querySelectorAll('[data-testid=pm-mockup-thumb-run-frame]').length === 3`);
      assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-testid=pm-mockup-title]')].map(e => e.textContent)`), app.attachments.map(item => item.title));
      await browser.evaluate(`${q('[data-testid=pm-mockup]')}.scrollIntoView({block:'start'})`);
      await pause(150);
      await browser.screenshot(`${surface}-${device}-cards.png`);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal overflow');
      // Each exact revision really renders in an opaque-origin frame; no fallback/latest read is allowed by the fixture door.
      for (let index = 0; index < 3; index++) {
        await press(`document.querySelectorAll('[data-testid=pm-mockup-open]')[${index}]`);
        const frame = q('[data-testid=pm-mockup-full-run-frame]');
        await browser.until('full frame', `!!${frame} && ${frame}.getBoundingClientRect().height > 200`);
        const attributes = await browser.evaluate(`({sandbox:${frame}.getAttribute('sandbox'), allow:${frame}.getAttribute('allow'), policy:${frame}.srcdoc})`);
        assert.equal(attributes.sandbox, 'allow-scripts'); assert.equal(attributes.allow, '');
        assert.match(attributes.policy, /connect-src 'none'/); assert.match(attributes.policy, /frame-src 'none'/);
        assert.equal(await browser.frameEvaluate(frame, 'document.querySelector("h1")?.textContent'), app.attachments[index].title);
        assert.equal(await browser.frameEvaluate(frame, 'document.documentElement.scrollWidth <= innerWidth'), true);
        await browser.screenshot(`${surface}-${device}-option-${index + 1}.png`);
        await press(q('[data-testid=pm-mockup-back]'));
        await browser.until('back to thread', `!${q('[data-testid=pm-mockup-view]')}`);
      }
      const option = `document.querySelectorAll('[data-testid=question-option]')[1]`;
      assert.ok(await browser.evaluate(`${option}.getBoundingClientRect().height >= 44`), 'one-tap choice has a phone-sized target');
      await press(option);
      for (let attempt = 0; !app.comments.length && attempt < 100; attempt++) await pause(100);
      assert.equal(app.comments.length, 1, 'one native answer leads to one recorded comment');
      assert.match(app.comments[0].text, new RegExp(app.attachments[1].path.replaceAll('.', '\\.')));
      assert.ok(app.comments[0].text.includes(app.attachments[1].title));
      assert.equal(app.comments[0].requester, 'fictional-requester');
      assert.equal(app.task.marked_for_build, false); assert.equal(app.task.launch_answer, null);
      const exactReads = app.reads.filter(item => item.body?.kind === 'read').map(item => item.body.value);
      assert.equal(exactReads.length, 3, 'thumbnail and full view share a revision read');
      for (const item of app.attachments) assert.ok(exactReads.some(read => read.target.resource.path === item.path && read.revision.kind === 'exact' && read.revision.value === item.revision));
      await browser.until('choice settled', `document.body.innerText.includes('Choix noté')`);
      await browser.screenshot(`${surface}-${device}-chosen.png`);
      const ax = await browser.send('Accessibility.getFullAXTree');
      writeFileSync(`${evidence}/${surface}-${device}-accessibility.json`, JSON.stringify(ax, null, 2));
      proof.push({ surface, device, viewport: device === 'phone' ? '375x812' : '1280x900', task: app.task, attachments: app.attachments, exactReads, comments: app.comments });
    } finally { await app.close(); }
  }
  assert.deepEqual(browser.problems, []);
  writeFileSync(`${evidence}/proof.json`, JSON.stringify({ kind: 'local-native-scripted', runs: proof, browserProblems: browser.problems }, null, 2));
  console.log('PASS: both public PM surfaces, three exact attachments, phone + desktop, one-tap native choice/comment; launch untouched (local fixture).');
} catch (error) { await browser?.screenshot('failed.png'); throw error; } finally { await browser?.close(); }
