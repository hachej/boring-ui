import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startTaskBoard } from './server.mjs';

const evidence = resolve('.cache/evidence/d417/task-board'); mkdirSync(evidence, { recursive: true });
const app = await startTaskBoard(); let browser;
const stage = `document.querySelector('[aria-label="Right stage"]')`;
const board = `${stage}.querySelector('[data-boring="task-board"]')`;
const card = id => `${board}.querySelector('[data-task-open="${id}"]')`;
const detail = `${board}.querySelector('[data-task-detail]')`;
const list = `${board}.querySelector('[data-task-list]')`;
const steps = [];
const nativeEvidence = [];
const toolResults = async () => (await app.view()).entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'present').map(message => JSON.parse(message.content.find(part => part.type === 'text').text));
const nativeResult = async count => { const deadline = Date.now() + 15000; while ((await toolResults()).length < count) { assert.ok(Date.now() < deadline, 'Native present result must arrive after mounted report, not timeout'); await pause(50); } const result = (await toolResults()).at(-1); nativeEvidence.push(result); return result; };
const prompt = async text => { await browser.type('document.querySelector("textarea")', text); await browser.press('Enter'); await browser.until('host receives pending native subject', '!!document.querySelector("[data-mount-task]")'); };
const step = async (name, run) => { await run(); steps.push(name); console.log(`PASS ${name}`); };
try {
  browser = await launch(`${app.url}?deferMount=1`, { evidence });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.until('board ready', `!!${card('D-201')}`);
  await browser.until('real ambient conversation connected', '!!document.querySelector("aside textarea")');
  await step('real ambient prompt waits for task mount; native opened result and artifact card share the board URL path', async () => {
    await prompt('Show D-201');
    assert.equal((await toolResults()).length, 0, 'Descriptor/open callback is not mount evidence');
    assert.equal(await browser.evaluate(`!!${detail}`), false);
    await browser.screenshot('native-present-pending.png');
    await browser.click('document.querySelector("[data-mount-task]")');
    await browser.until('native mounted task detail', `!!${detail}`);
    assert.equal((await nativeResult(1)).opened, true);
    assert.equal(await browser.evaluate('new URL(location.href).searchParams.get("task")'), 'D-201');
    await browser.until('finished task artifact card', '!!document.querySelector("[data-testid=artifact-card][data-state=ready]")');
    await browser.click('document.querySelector("[data-task-side] > button")');
    await browser.click('document.querySelector("[data-testid=artifact-card][data-state=ready]")');
    await browser.until('card requests same host viewer', '!!document.querySelector("[data-mount-task]")');
    await browser.click('document.querySelector("[data-mount-task]")');
    await browser.until('card reopens same detail', `!!${detail}`);
    assert.equal(await browser.evaluate('new URL(location.href).searchParams.get("task")'), 'D-201');
    await browser.screenshot('native-present-mounted.png');
    await browser.click('document.querySelector("[data-task-side] > button")');
  });
  await step('native task lists use actual mine/waiting filters and missing/denied tasks report failure', async () => {
    for (const [text, count, filter, cards] of [['Show waiting on me', 2, 'waiting-on-me', 1], ['Show my requests', 3, 'mine', 4], ['Show denied task', 4, null, null], ['Show missing task', 5, null, null]]) {
      await prompt(text);
      assert.equal((await toolResults()).length, count - 1);
      await browser.click('document.querySelector("[data-mount-task]")');
      const result = await nativeResult(count);
      if (filter) { assert.equal(result.opened, true); assert.equal(result.artifact.subject.tasks.filter, filter); assert.equal(await browser.evaluate(`${board}.querySelectorAll('[data-task-card]').length`), cards); }
      else { assert.equal(result.opened, false); assert.match(result.refused, /denied|not found/); }
    }
    await browser.click('document.querySelector("[data-task-side] > button")');
    // Compact onOpen uses the identical controlled selection and URL path, without spawning another chat.
    await browser.click('document.querySelector("[data-variant=compact] [data-task-open=\\"D-201\\"]")');
    await browser.until('compact task detail', `!!${detail}`);
    await browser.click('document.querySelector("[data-task-side] > button")');
  });
  await step('wide host has three rails, folded terminal columns and two own request rows', async () => {
    assert.equal(await browser.evaluate(`getComputedStyle(${board}.querySelector('[data-task-column="waiting"]').parentElement).gridTemplateColumns.split(' ').length`), 3);
    assert.equal(await browser.evaluate(`${board}.querySelector('[data-task-column="done"]').open`), false);
    assert.equal(await browser.evaluate(`document.querySelector('[data-variant=compact] [role=list]').children.length`), 2);
    await browser.screenshot('desktop-wide-light.png');
  });
  await step('keyboard opens task; wide detail is alongside board; choices use host callback; Back restores focus and browser history', async () => {
    await browser.evaluate(`${card('D-201')}.focus()`); await browser.press('Enter');
    await browser.until('detail mounted', `!!${detail}`);
    assert.equal(await browser.evaluate(`new URL(location.href).searchParams.get('task')`), 'D-201');
    assert.notEqual(await browser.evaluate(`getComputedStyle(${list}).display`), 'none');
    assert.equal(await browser.evaluate(`document.activeElement.textContent`), 'Back to tasks');
    await browser.screenshot('desktop-detail-light.png');
    assert.match(await browser.evaluate(`${detail}.querySelector('[data-task-answer=time]').textContent`), /Noon.*Sam/);
    await browser.click(`${detail}.querySelector('[data-task-question] button')`);
    await browser.until('host choice received', `document.querySelector('output').textContent.includes('river')`);
    await browser.press('Escape'); await browser.until('board returned', `!${detail}`);
    assert.equal(await browser.evaluate('document.activeElement.dataset.taskOpen'), 'D-201');
    await browser.evaluate('history.back()'); await browser.until('back restored detail', `!!${detail}`);
    await browser.evaluate('history.forward()'); await browser.until('forward restored board', `!${detail}`);
  });
  await step('regular markdown/html/image viewers stay right of the same task; existing back close fullscreen zoom/more controls work', async () => {
    await browser.click(card('D-201')); await browser.until('files task detail', `!!${detail}`);
    for (const [file, kind] of [['brief.md', 'markdown'], ['mockup.html', 'html'], ['evidence.png', 'image']]) {
      await browser.click(`${detail}.querySelector('[data-task-file$="${file}"]')`);
      await browser.until(`${kind} viewer ready`, `!!document.querySelector('[data-testid=file-viewer][data-kind=${kind}]') && !!document.querySelector('[data-testid=file-title]')`);
      if (kind === 'markdown') await browser.until('regular markdown loaded', `!!document.querySelector('[data-testid=file-preview] .tiptap')`);
      if (kind === 'html') await browser.until('regular html loaded', `!!document.querySelector('[data-testid=file-preview] iframe')`);
      if (kind === 'image') await browser.until('regular image loaded', `document.querySelector('[data-testid=viewer-stage] img')?.naturalWidth > 0`);
      const geometry = await browser.evaluate(`(() => { const d=${detail}.getBoundingClientRect(), v=document.querySelector('[data-task-file-pane]').getBoundingClientRect(); return {left:d.x,right:v.x,task:${detail}.dataset.taskDetail,path:document.querySelector('[data-testid=file-viewer]').dataset.path}; })()`);
      assert.ok(geometry.left < geometry.right); assert.equal(geometry.task, 'D-201'); assert.equal(geometry.path, `docs/tasks/D-201/${file}`);
      if (kind === 'image') {
        await browser.click('document.querySelector("[data-testid=viewer-zoom-in]")');
        assert.notEqual(await browser.evaluate('document.querySelector("[data-testid=viewer-stage]").dataset.zoom'), 'fit');
      }
      await browser.evaluate('window.scrollTo(0, 0)');
      await browser.screenshot(`file-right-${kind}-light.png`);
      await browser.click('document.querySelector("[data-testid=viewer-more]")');
      await browser.until('existing viewer menu', '!!document.querySelector("[data-testid=viewer-fullscreen]")');
      await browser.click('document.querySelector("[data-testid=viewer-fullscreen]")');
      await browser.until('fullscreen regular viewer', 'document.querySelector("[data-host-file]").dataset.fullscreen === "true"');
      await browser.click('document.querySelector("[data-testid=viewer-more]")');
      await browser.click('document.querySelector("[data-testid=viewer-fullscreen]")');
      await browser.click('document.querySelector("[data-testid=viewer-show-file]")');
      await browser.until('exact host Montrer target', `document.querySelector('output').textContent.includes('docs/tasks/D-201/${file}')`);
      await browser.evaluate(`document.documentElement.classList.add('dark')`); await pause(200); await browser.screenshot(`file-right-${kind}-dark.png`);
      await browser.evaluate(`document.documentElement.classList.remove('dark')`);
      await browser.click(kind === 'html' ? 'document.querySelector("[data-testid=viewer-close]")' : 'document.querySelector("[data-testid=file-back]")');
      await browser.until('task survives viewer close/back', `!document.querySelector('[data-task-file-pane]') && !!${detail}`);
    }
    await browser.press('Escape');
  });
  await step('host theme reaches cards and detail, without component dark overrides', async () => {
    await browser.evaluate(`document.documentElement.classList.add('dark')`); await pause(200);
    await browser.screenshot('desktop-wide-dark.png');
    await browser.click(card('D-201')); await browser.until('dark detail', `!!${detail}`);
    await browser.screenshot('desktop-detail-dark.png');
    await browser.press('Escape');
  });
  await step('a narrow right panel on the same desktop uses a list and in-place detail', async () => {
    await browser.evaluate(`document.documentElement.classList.remove('dark')`); await pause(200);
    await browser.click(`document.querySelector('[data-panel-width]')`);
    assert.equal(await browser.evaluate(`getComputedStyle(${board}.querySelector('[data-task-column="waiting"]').parentElement).gridTemplateColumns.split(' ').length`), 1);
    await browser.screenshot('desktop-narrow-light.png');
    await browser.click(card('D-201')); await browser.until('narrow detail', `!!${detail}`);
    assert.equal(await browser.evaluate(`getComputedStyle(${list}).display`), 'none');
    await browser.screenshot('desktop-narrow-detail.png');
    await browser.press('Escape');
    await browser.evaluate(`document.documentElement.classList.add('dark')`); await pause(200); await browser.screenshot('desktop-narrow-dark.png');
  });
  await step('375px phone has no horizontal overflow, in-place detail, accessible links and back', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate(`document.documentElement.classList.remove('dark'); ${stage}.scrollIntoView()`); await pause(200);
    await browser.screenshot('phone-light.png');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await browser.click(card('D-201')); await browser.until('phone detail', `!!${detail}`);
    assert.equal(await browser.evaluate(`getComputedStyle(${list}).display`), 'none');
    await browser.evaluate(`${stage}.scrollIntoView()`); await browser.screenshot('phone-detail-light.png');
    const snapshot = await browser.send('Accessibility.getFullAXTree');
    writeFileSync(resolve(evidence, 'phone-accessibility.json'), JSON.stringify(snapshot, null, 2));
    await browser.evaluate(`document.documentElement.classList.add('dark')`); await pause(200); await browser.screenshot('phone-detail-dark.png');
    await browser.press('Escape'); await browser.screenshot('phone-dark.png');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  });
  assert.deepEqual(browser.problems, []);
} finally {
  writeFileSync(resolve(evidence, 'journey.json'), JSON.stringify({ steps, nativeEvidence, errors: browser?.problems ?? [] }, null, 2));
  await browser?.close(); await app.close();
}
