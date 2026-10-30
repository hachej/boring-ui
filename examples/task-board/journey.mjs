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
const detail = `document.querySelector('[data-task-detail]')`;
const list = `${board}.querySelector('[data-task-list]')`;
const steps = [];
const nativeEvidence = [];
const toolResults = async () => (await app.view()).entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'present').map(message => JSON.parse(message.content.find(part => part.type === 'text').text));
const nativeResult = async count => { const deadline = Date.now() + 15000; while ((await toolResults()).length < count) { assert.ok(Date.now() < deadline, 'Native present result must arrive after mounted report, not timeout'); await pause(50); } const result = (await toolResults()).at(-1); nativeEvidence.push(result); return result; };
const prompt = async text => { await browser.type('document.querySelector("textarea")', text); await browser.press('Enter'); await browser.until('host receives pending native subject', '!!document.querySelector("[data-mount-task]")'); };
const step = async (name, run) => { await run(); steps.push(name); console.log(`PASS ${name}`); };
try {
  browser = await launch(`${app.url}?deferMount=1`, { evidence });
  // The consumer's shadcn Drawer owns transitions. Capture settled views, never an in-flight slide.
  const capture = browser.screenshot;
  browser.screenshot = async name => { await pause(600); if (process.env.TASK_BOARD_SCREENSHOTS !== '0') await capture(name); };
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
    await browser.click('document.querySelector("[data-task-back]")');
    await browser.click('document.querySelector("[data-testid=artifact-card][data-state=ready]")');
    await browser.until('card requests same host viewer', '!!document.querySelector("[data-mount-task]")');
    await browser.click('document.querySelector("[data-mount-task]")');
    await browser.until('card reopens same detail', `!!${detail}`);
    assert.equal(await browser.evaluate('new URL(location.href).searchParams.get("task")'), 'D-201');
    await browser.screenshot('native-present-mounted.png');
    await browser.click('document.querySelector("[data-task-back]")');
  });
  await step('native task lists use actual mine/waiting filters and missing/denied tasks report failure', async () => {
    for (const [text, count, filter, cards] of [['Show waiting on me', 2, 'waiting-on-me', 1], ['Show my requests', 3, 'mine', 5], ['Show denied task', 4, null, null], ['Show missing task', 5, null, null]]) {
      await prompt(text);
      assert.equal((await toolResults()).length, count - 1);
      await browser.click('document.querySelector("[data-mount-task]")');
      const result = await nativeResult(count);
      if (filter) { assert.equal(result.opened, true); assert.equal(result.artifact.subject.tasks.filter, filter); assert.equal(await browser.evaluate(`${board}.querySelectorAll('[data-task-card]').length`), cards); }
      else { assert.equal(result.opened, false); assert.match(result.refused, /denied|not found/); }
    }
    await browser.click('document.querySelector("[data-task-back]")');
  });
  await step('wide host has its columns by who acts next, finished work folded', async () => {
    assert.equal(await browser.evaluate(`getComputedStyle(${board}.querySelector('[data-task-column="needs-you"]').parentElement).gridTemplateColumns.split(' ').length`), 4);
    assert.deepEqual(await browser.evaluate(`[...${board}.querySelectorAll('[data-task-column]')].map(node => node.dataset.taskColumn)`), ['needs-you', 'blocked', 'progress', 'live']);
    assert.match(await browser.evaluate(`${board}.querySelector('[data-task-group=finished]').textContent`), /Finished/);
    await browser.screenshot('desktop-wide-light.png');
  });
  await step('keyboard opens right task overlay without squeezing kanban; choices use host callback; Back restores focus and history', async () => {
    const widthBefore = await browser.evaluate(`${board}.getBoundingClientRect().width`);
    await browser.evaluate(`${card('D-201')}.focus()`); await browser.press('Enter');
    await browser.until('detail mounted', `!!${detail}`);
    assert.equal(await browser.evaluate(`new URL(location.href).searchParams.get('task')`), 'D-201');
    assert.notEqual(await browser.evaluate(`getComputedStyle(${list}).display`), 'none');
    assert.equal(await browser.evaluate(`${board}.getBoundingClientRect().width`), widthBefore);
    assert.equal(await browser.evaluate(`getComputedStyle(${board}.querySelector('[data-task-column="needs-you"]').parentElement).gridTemplateColumns.split(' ').length`), 4);
    await browser.until('back receives overlay focus', 'document.activeElement.getAttribute("aria-label") === "Back to the tasks"');
    await browser.screenshot('desktop-detail-light.png');
    assert.match(await browser.evaluate(`${detail}.querySelector('[data-task-answer=every-card]').textContent`), /Alice: every card/);
    assert.equal(await browser.evaluate(`Math.round(document.querySelector('[data-task-side]').getBoundingClientRect().width)`), 400);
    await browser.click(`${detail}.querySelector('[data-task-question] button')`);
    await browser.until('host choice received', `document.querySelector('output').textContent.includes('grams')`);
    await browser.press('Escape'); await browser.until('board returned', `!${detail}`);
    assert.equal(await browser.evaluate('document.activeElement.dataset.taskOpen'), 'D-201');
    await browser.evaluate('history.back()'); await browser.until('back restored detail', `!!${detail}`);
    await browser.evaluate('history.forward()'); await browser.until('forward restored board', `!${detail}`);
  });
  await step('task @ picker uses the existing composer; Discuss posts a task mention and settles through the same host answer service', async () => {
    await browser.type('document.querySelector("textarea")', '@D-201');
    await browser.until('task search result', '!!document.querySelector("[data-testid=mention-item][data-path=\\"task:D-201\\"]")');
    assert.match(await browser.evaluate('document.querySelector("[data-testid=mention-item]").textContent'), /Waiting on you/);
    await browser.click('document.querySelector("[data-testid=mention-item][data-path=\\"task:D-201\\"]")');
    await browser.until('task kind chip in ambient composer', '!!document.querySelector("[data-testid=mention-chip][data-path=\\"task:D-201\\"]")');
    assert.match(await browser.evaluate('document.querySelector("[data-testid=mention-chip]").textContent'), /@ D-201.*Protein/);
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-testid=composer]").length'), 1);
    assert.doesNotMatch(await browser.evaluate('document.querySelector("textarea").value'), /task:D-201/);
    await browser.screenshot('ambient-task-picker-chip.png');
    await browser.click(card('D-201')); await browser.until('question overlay', `!!${detail}`);
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-task-answered]").length'), 3);
    assert.ok(await browser.evaluate(`${detail}.textContent.length < 6000`));
    await browser.screenshot('questions-latest-three.png');
    await browser.click('document.querySelector("[data-task-show-answers]")');
    assert.ok(await browser.evaluate('document.querySelectorAll("[data-task-answered]").length > 3'));
    await browser.click('document.querySelector("[data-task-show-answers]")');
    await browser.click('document.querySelector("[data-task-discuss=gauge]")');
    await browser.until('Discuss stages the question in the existing composer', 'document.querySelector("textarea").value.includes("Keep the protein gauge under the card?")');
    assert.equal(await browser.evaluate('document.activeElement === document.querySelector("textarea")'), true);
    assert.equal((await app.view()).entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'answer_task_question').length, 0, 'Discuss never submits or settles the question before Send');
    await browser.click('document.querySelector("[data-testid=composer-submit]")');
    await browser.until('sent discussion task mention', `!!document.querySelector('[data-testid=message-mention][data-path="task:D-201"]')`);
    await browser.click(`document.querySelector('[data-testid=message-mention][data-path="task:D-201"]')`);
    await browser.until('native PM answer written to host projection', 'document.querySelector("[data-task-answer=gauge]")?.textContent.includes("PM: remove")');
    const settled = (await app.view()).entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'answer_task_question');
    assert.equal(settled.length, 1);
    await browser.click('document.querySelector("[data-task-back]")');
    await browser.click('document.querySelector("[data-testid=message-mention][data-path=\\"task:D-201\\"]")');
    await browser.until('sent task chip opens same overlay', `!!${detail}`);
    assert.equal(await browser.evaluate('new URL(location.href).searchParams.get("task")'), 'D-201');
    await browser.screenshot('discuss-question-native-settled.png');
    await browser.press('Escape');
  });
  await step('regular markdown/html/image file overlay stacks wider over the task; back close fullscreen zoom/more controls work', async () => {
    await browser.click(card('D-201')); await browser.until('files task detail', `!!${detail}`);
    for (const [file, kind] of [['brief.md', 'markdown'], ['mockups/meal-card.html', 'html'], ['evidence/day-plan.png', 'image']]) {
      await browser.click(`${detail}.querySelector('[data-task-file$="${file}"]')`);
      await browser.until(`${kind} viewer ready`, `!!document.querySelector('[data-testid=file-viewer][data-kind=${kind}]') && !!document.querySelector('[data-testid=file-title]')`);
      if (kind === 'markdown') await browser.until('regular markdown loaded', `!!document.querySelector('[data-testid=file-preview] .tiptap')`);
      if (kind === 'html') await browser.until('regular html loaded', `!!document.querySelector('[data-testid=file-viewer] iframe')`);
      if (kind === 'image') await browser.until('regular image loaded', `document.querySelector('[data-testid=viewer-stage] img')?.naturalWidth > 0`);
      const geometry = await browser.evaluate(`(() => { const d=document.querySelector('[data-task-side]').getBoundingClientRect(), v=document.querySelector('[data-task-file-pane]').getBoundingClientRect(); return {taskLeft:d.x,fileLeft:v.x,taskWidth:d.width,fileWidth:v.width,task:${detail}.dataset.taskDetail,path:document.querySelector('[data-testid=file-viewer]').dataset.path}; })()`);
      assert.ok(geometry.fileLeft < geometry.taskLeft); assert.ok(geometry.fileWidth > geometry.taskWidth); assert.equal(geometry.task, 'D-201'); assert.equal(geometry.path, `docs/tasks/D-201/${file}`);
      if (kind === 'image') {
        await browser.click('document.querySelector("[data-testid=viewer-zoom-in]")');
        assert.notEqual(await browser.evaluate('document.querySelector("[data-testid=viewer-stage]").dataset.zoom'), 'fit');
      }
      await browser.evaluate('window.scrollTo(0, 0)');
      await browser.screenshot(`file-overlay-${kind}-light.png`);
      await browser.click('document.querySelector("[data-testid=viewer-more]")');
      await browser.until('existing viewer menu', '!!document.querySelector("[data-testid=viewer-fullscreen]")');
      await browser.click('document.querySelector("[data-testid=viewer-fullscreen]")');
      await browser.until('fullscreen regular viewer', 'document.querySelector("[data-host-file]").dataset.fullscreen === "true"');
      await pause(600);
      const full = await browser.evaluate('(() => { const r=document.querySelector("[data-host-file]").getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,vw:document.documentElement.clientWidth,vh:innerHeight}; })()');
      assert.ok(Math.abs(full.x) <= 1 && Math.abs(full.y) <= 1 && Math.abs(full.w-full.vw) <= 1 && Math.abs(full.h-full.vh) <= 1, `Fullscreen must fill the viewport, not its transformed Drawer: ${JSON.stringify(full)}`);
      await browser.screenshot(`file-fullscreen-${kind}.png`);
      await browser.click('document.querySelector("[data-testid=viewer-more]")');
      await browser.click('document.querySelector("[data-testid=viewer-fullscreen]")');
      await browser.click('document.querySelector("[data-testid=viewer-show-file]")');
      await browser.until('exact host Montrer target', `document.querySelector('output').textContent.includes('docs/tasks/D-201/${file}')`);
      await browser.evaluate(`document.documentElement.classList.add('dark')`); await pause(200); await browser.screenshot(`file-overlay-${kind}-dark.png`);
      await browser.evaluate(`document.documentElement.classList.remove('dark')`);
      if (kind === 'image') await browser.press('Escape');
      else await browser.click(kind === 'html' ? 'document.querySelector("[data-testid=viewer-close]")' : 'document.querySelector("[data-testid=file-back]")');
      await browser.until('task survives viewer close/back', `!document.querySelector('[data-task-file-pane]') && !!${detail}`);
      await pause(600); // The host Drawer finishes its exit before another file is selected.
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
    assert.notEqual(await browser.evaluate(`getComputedStyle(${list}).display`), 'none');
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
    assert.notEqual(await browser.evaluate(`getComputedStyle(${list}).display`), 'none');
    await browser.evaluate(`${stage}.scrollIntoView()`); await browser.screenshot('phone-detail-light.png');
    const snapshot = await browser.send('Accessibility.getFullAXTree');
    writeFileSync(resolve(evidence, 'phone-accessibility.json'), JSON.stringify(snapshot, null, 2));
    await browser.evaluate(`document.documentElement.classList.add('dark')`); await pause(200); await browser.screenshot('phone-detail-dark.png');
    await browser.press('Escape'); await browser.screenshot('phone-dark.png');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const before = (await toolResults()).length;
    await browser.evaluate('window.scrollTo(0, 0)');
    await browser.type('document.querySelector("textarea")', 'Show D-201');
    await browser.click('document.querySelector("[data-testid=composer-submit]")');
    await browser.until('phone receives pending native subject', '!!document.querySelector("[data-mount-task]")');
    await browser.click('document.querySelector("[data-mount-task]")');
    assert.equal((await nativeResult(before + 1)).opened, true, 'a mounted phone task is not refused by the file-panel narrow guard');
    await browser.screenshot('phone-native-present.png');
    await browser.press('Escape');
  });
  assert.deepEqual(browser.problems, []);
} finally {
  writeFileSync(resolve(evidence, 'journey.json'), JSON.stringify({ steps, nativeEvidence, errors: browser?.problems ?? [] }, null, 2));
  await browser?.close(); await app.close();
}
