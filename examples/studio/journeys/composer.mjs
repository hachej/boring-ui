// The chat composer and transcript mechanics that are not about any one capability: the empty state, Shift+Enter and Enter, a
// streaming answer that the view follows (and releases when scrolled up), the single live activity block of a tool-heavy turn, the
// expert mode, and dark mode. Real browser input, real model. Screenshots: chatui-empty, chatui-streaming, chatui-tools-*, chatui-dark.
// Kept as a UI journey rather than a scenario because it is about the chat component itself, not about something the agent does.
import assert from 'node:assert/strict';

async function composer(t) {
  const { step, browser, say, button, idle, logText, MESSAGE, SUBMIT } = t;
  const q = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const qa = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})]`;
  const userMessages = `${qa('[data-testid=transcript] article[data-role=user]')}.map(a => a.innerText.trim())`;
  const working = `${SUBMIT}?.dataset.state === 'stop'`;
  const clear = async () => { await browser.evaluate(`${MESSAGE}.focus(); ${MESSAGE}.select()`); await browser.press('Backspace'); await browser.until('composer cleared', `${MESSAGE}.value === ''`); };
  const dark = value => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });

  await step('empty chat: the scenario list, live connection, Send disabled until there is text', async () => {
    await t.fresh();
    await browser.until('empty state', `!!${q('[data-testid=scenario-list]')}`);
    assert.equal(await browser.evaluate(`${SUBMIT}.dataset.state`), 'send');
    assert.equal(await browser.evaluate(`${SUBMIT}.disabled`), true, 'nothing to send yet');
    assert.equal(await browser.evaluate(`${q('[data-testid=connection]')}.textContent.trim()`), 'Live');
    // There is no permanent Queue / Steer toggle in the composer.
    assert.equal(await browser.evaluate(`!${q('[data-testid=when-busy]')}`), true, 'no queue / steer toggle while idle');
  });
  await t.shots('chatui-empty');

  await step('Shift+Enter inserts a newline and sends nothing; Enter sends and the composer keeps focus', async () => {
    await browser.type(MESSAGE, 'alpha'); await browser.press('Enter', { shift: true }); await browser.type(MESSAGE, 'beta');
    assert.equal(await browser.evaluate(`${MESSAGE}.value`), 'alpha\nbeta');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await browser.evaluate(`${userMessages}.length`), 0, 'Shift+Enter did not send');
    assert.ok((await browser.evaluate(`${MESSAGE}.getBoundingClientRect().height`)) > 40, 'the textarea grew to two lines');
    await clear();
    await browser.type(MESSAGE, 'Reply with exactly: ENTER-OK');
    await browser.press('Enter');
    await browser.until('message sent and answered', `/ENTER-OK/.test(${logText}.replace('Reply with exactly: ENTER-OK', '')) && ${idle}`, 120000);
    assert.deepEqual(await browser.evaluate(userMessages), ['Reply with exactly: ENTER-OK']);
    assert.equal(await browser.evaluate(`${MESSAGE}.value === '' && document.activeElement === ${MESSAGE}`), true, 'cleared and still focused');
  });

  await step('floating chat: dragging the divider below the threshold floats the chat (same session), Dock returns it at the last width; keyboard, menu, reload, phone', async () => {
    const WS = q('[data-testid=workspace-panel]'), ROOT = q('[data-boring=artifact-workspace]'), DIVIDER = q('[data-testid=workspace-divider]');
    const geometry = () => browser.evaluate(`(() => { const r = ${ROOT}.getBoundingClientRect(); return { left: r.left, width: r.width, panel: Math.round(${WS}.getBoundingClientRect().width) }; })()`);
    const floating = `${q('[data-testid=workspace-chat]')}?.dataset.floating === 'true'`;
    const ambient = `${q('[data-boring=ambient-chat]')}`, hint = `${q('[data-testid=workspace-float-hint]')}`;
    const watches = () => t.app.watches.open;
    const watchesBefore = watches();
    const draft = 'draft that must survive floating';
    await t.openPanel();
    await browser.until('the panel has entered', `${WS}?.dataset.state === 'open'`, 5000);
    await browser.type(MESSAGE, draft);
    const sent = await browser.evaluate(userMessages);
    assert.ok(sent.length >= 1, 'the transcript has a message to carry over');
    assert.equal(await browser.evaluate(floating), false, 'docked at first');
    // Above the threshold the divider just resizes: the chat is 600px wide, and that is the width Dock must restore.
    const g = await geometry();
    const dragging = await browser.drag(DIVIDER, g.left + 600, { release: false });
    await browser.until('the panel follows the pointer', `Math.abs(${WS}.getBoundingClientRect().width - ${g.width - 600}) < 3`, 5000);
    assert.equal(await browser.evaluate(`!${hint}`), true, 'no hint above the threshold');
    const remembered = (await geometry()).panel;
    // Below the threshold (chat 200px): a dimmed hint over the chat, and the panel keeps its last width.
    await dragging.moveTo(g.left + 200);
    await browser.until('the hint appears', `!!${hint} && ${hint}.innerText.includes('Release to float the chat')`, 5000);
    assert.equal((await geometry()).panel, remembered, 'the panel keeps the last width above the threshold');
    await t.shots('float-hint');
    // Moving back cancels.
    await dragging.moveTo(g.left + 600);
    await browser.until('the hint goes', `!${hint}`, 5000);
    await dragging.moveTo(g.left + 200);
    await browser.until('the hint is back', `!!${hint}`, 5000);
    await dragging.release();
    await browser.until('the chat floats', floating, 5000);
    await browser.until('the ambient window is expanded', `${ambient}?.dataset.state === 'expanded'`, 5000);
    await t.pause(500);
    const after = await geometry();
    assert.ok(Math.abs(after.panel - after.width) < 2, `the panel spans the full width (${after.panel} of ${after.width})`);
    assert.equal(await browser.evaluate(`!${q('[data-boring=pi-chat]')} && !${hint} && !${DIVIDER}`), true, 'no docked chat, hint or divider while floating');
    assert.deepEqual(await browser.evaluate(userMessages), sent, 'the transcript carried over');
    assert.equal(await browser.evaluate(`${MESSAGE}.value`), draft, 'the typed draft carried over');
    assert.equal(watches(), watchesBefore, 'no second watch stream was opened');
    await t.shots('float-floating');
    // Minimise to the bar and the pill, and restore.
    await browser.click(q('[data-testid=ambient-minimize]'));
    await browser.until('bar', `${ambient}?.dataset.state === 'bar'`, 5000);
    await t.pause(400);
    await browser.click(q('[data-testid=ambient-minimize]'));
    await browser.until('pill', `${ambient}?.dataset.state === 'minimized'`, 5000);
    await t.pause(400);
    await browser.click(q('[data-testid=ambient-pill]'));
    await browser.until('bar again', `${ambient}?.dataset.state === 'bar'`, 5000);
    await t.pause(400);
    await browser.click(q('[data-testid=ambient-title]'));
    await browser.until('expanded again', `${ambient}?.dataset.state === 'expanded'`, 5000);
    assert.equal(await browser.evaluate(`${MESSAGE}.value`), draft, 'the draft survives minimising');
    // Dock: the chat is beside the panel again at the width it had above the threshold, with everything it had.
    await browser.click(q('[data-testid=ambient-dock]'));
    await browser.until('docked', `!(${floating}) && !!${q('[data-boring=pi-chat]')} && !${ambient}`, 5000);
    await t.pause(400);
    assert.equal((await geometry()).panel, remembered, 'Dock restores the last width above the threshold');
    assert.deepEqual(await browser.evaluate(userMessages), sent);
    assert.equal(await browser.evaluate(`${MESSAGE}.value`), draft, 'the draft survives docking');
    assert.equal(watches(), watchesBefore, 'docking did not open another stream');
    // Keyboard: Alt+Left on the divider floats it; the panel menu does too.
    await browser.evaluate(`${DIVIDER}.focus()`);
    await browser.press('ArrowLeft', { alt: true });
    await browser.until('Alt+Left floats the chat', floating, 5000);
    await browser.click(q('[data-testid=ambient-dock]'));
    await browser.until('docked again', `!(${floating})`, 5000);
    await t.menu('[data-testid=workspace-panel]', 'demo-panel', 'float-chat');
    await browser.until('"Float chat" in the panel menu floats it', floating, 5000);
    assert.equal(await browser.evaluate(`${q('[data-testid=demo-panel-float-chat]')} === null`), true, 'the menu closed');
    // A reload keeps the floating state.
    await browser.reload(); await t.pause(600);
    await browser.until('still floating after a reload', `${floating} && ${ambient}?.dataset.state === 'expanded' && !!${MESSAGE}`, 30000);
    assert.equal(await browser.evaluate(`${ambient}.querySelector('[data-testid=composer-input]') !== null`), true);
    // A phone keeps its sheet and ignores the floating state.
    await browser.emulate('phone');
    try {
      await browser.reload(); await t.pause(800);
      await browser.until('phone sheet', `${ROOT}?.dataset.sheet === 'true'`, 10000);
      assert.equal(await browser.evaluate(`!${ambient} && ${q('[data-testid=workspace-chat]')}.dataset.floating !== 'true'`), true, 'no floating chat on a phone');
    } finally { await browser.emulate('desktop'); await browser.until('desktop panel', `${ROOT}?.dataset.sheet === 'false'`, 10000); }
    await browser.until('floating again on the desktop', `${floating}`, 10000);
    // Closing the panel docks the chat back: nothing to float over.
    await t.closePanel();
    await browser.until('docked after closing', `!(${floating}) && !!${q('[data-boring=pi-chat]')} && !${ambient}`, 5000);
    await t.openPanel();
    await t.pause(500);
    assert.equal(await browser.evaluate(`!(${floating})`), true, 'reopening starts docked');
    await t.closePanel();
  });

  await step('streaming: the view follows the answer, releases when scrolled up, and the jump button returns to it', async () => {
    await say('Without using tools or artifacts, write the numbers from 1 to 250 in English words, one per line, directly in the chat. Then end with the exact line: LIGHTS-END.');
    await browser.until('answer is streaming and longer than the view', `${working} && (() => { const e = ${q('[data-testid=transcript-scroll]')}; return e.scrollHeight > e.clientHeight + 300; })()`, 90000);
    await browser.screenshot('chatui-streaming.png');
    assert.equal(await browser.evaluate(`${SUBMIT}.getAttribute('aria-label')`), 'Stop');
    assert.equal(await browser.evaluate(`!${q('[data-testid=jump-latest]')}`), true, 'following the stream: no jump button');
    // Scroll up with the wheel the way a person would.
    const box = await browser.evaluate(`(() => { const r = ${q('[data-testid=transcript-scroll]')}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (let i = 0; i < 6; i++) await browser.wheel(box.x, box.y, -400);
    await browser.until('jump button appears', `!!${q('[data-testid=jump-latest]')}`, 5000);
    const top = await browser.evaluate(`${q('[data-testid=transcript-scroll]')}.scrollTop`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const drift = Math.abs(await browser.evaluate(`${q('[data-testid=transcript-scroll]')}.scrollTop`) - top);
    assert.ok(drift < 40, `scrolling up released the stream (drifted ${drift}px)`);
    await browser.click(q('[data-testid=jump-latest]'));
    await browser.until('back at the bottom', `(() => { const e = ${q('[data-testid=transcript-scroll]')}; return e.scrollHeight - e.scrollTop - e.clientHeight < 8; })() && !${q('[data-testid=jump-latest]')}`, 5000);
  });
  await step('tool-heavy turn: one activity block that updates in place while running, one quiet line afterwards, the full list on expand', async () => {
    // Files to read one at a time: the git scenario's seed (a small club repository), put in place through the same endpoint the app uses.
    await t.api('/api/scenarios/git-commit/seed', { method: 'POST' });
    await t.fresh();
    await say('Read README.md, packing-list.md and trips/itinerary.md one file at a time with the read tool, then run working_git for the status, then say DONE-READING. Write no text between the tool calls.');
    // Sample the last turn while it runs: never more than one block, its header changes, and no step row is visible while collapsed.
    const turn = `(() => { const article = ${qa('[data-testid=transcript] article')}.at(-1); if (article?.dataset.role !== 'assistant') return null;
      const blocks = [...article.querySelectorAll('[data-testid=activity]')];
      const visible = [...article.querySelectorAll('[data-testid=tool-card], [data-testid=reasoning], [data-testid=activity-step]')].filter(e => e.offsetParent !== null).length;
      return { blocks: blocks.length, label: blocks[0]?.querySelector('[data-testid=activity-label]')?.textContent ?? null, count: blocks[0]?.querySelector('[data-testid=activity-count]')?.textContent ?? null,
        state: blocks[0]?.dataset.state ?? null, open: blocks[0]?.dataset.open ?? null, visible, text: ${logText} }; })()`;
    const labels = [], counts = [];
    let shot = false, maxBlocks = 0;
    const deadline = Date.now() + 240000;
    for (;;) {
      const sample = await browser.evaluate(turn);
      const finished = await browser.evaluate(`${idle}`) && sample && /DONE-READING/.test(sample.text.replace(/then say DONE-READING/, ''));
      if (sample) {
        maxBlocks = Math.max(maxBlocks, sample.blocks);
        assert.ok(sample.blocks <= 1, `one activity block per turn, saw ${sample.blocks}`);
        if (sample.state === 'running') {
          if (sample.label && labels.at(-1) !== sample.label) labels.push(sample.label);
          if (sample.count && counts.at(-1) !== sample.count) counts.push(sample.count);
          assert.equal(sample.open, 'false', 'collapsed while running');
          assert.equal(sample.visible, 0, 'no step row is visible while collapsed');
          if (!shot && /^Reading /.test(sample.label)) { shot = true; await browser.screenshot('chatui-activity-running.png'); await dark('dark'); try { await browser.until('dark', `matchMedia('(prefers-color-scheme: dark)').matches`); await browser.screenshot('chatui-activity-running-dark.png'); } finally { await dark('light'); } }
        }
      }
      if (finished) break;
      assert.ok(Date.now() < deadline, `the turn did not finish; header texts: ${labels.join(' | ')}`);
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    assert.equal(maxBlocks, 1, 'the turn has exactly one activity block');
    assert.ok(labels.length >= 2, `the header text changed as steps progressed: ${labels.join(' | ')}`);
    assert.ok(labels.some(label => /^Reading /.test(label)), `a live label names the file: ${labels.join(' | ')}`);
    assert.ok(counts.length >= 2, `the step counter grew: ${counts.join(' | ')}`);
    // Finished: one collapsed summary line with a check, tool names still in the DOM, nothing visible.
    const done = await browser.evaluate(turn);
    assert.equal(done.blocks, 1); assert.equal(done.state, 'done'); assert.equal(done.open, 'false'); assert.equal(done.visible, 0, 'no step row is visible until expanded');
    assert.match(done.label, /^Used .*read ×3/, done.label);
    const names = await browser.evaluate(`${qa('[data-testid=tool-name]')}.map(e => e.textContent)`);
    assert.ok(names.filter(name => name === 'read').length >= 3 && names.length >= 4, `tool calls in the DOM: ${names.join(', ')}`);
    assert.ok(Number(done.count.split(' ')[0]) >= names.length, `the counter covers every step: ${done.count}`);
    assert.equal(await browser.evaluate(`${qa('[data-testid=tool-group]')}.length`), 0, 'no separate groups');
    await browser.screenshot('chatui-tools-collapsed.png');
    await dark('dark'); try { await browser.until('dark', `matchMedia('(prefers-color-scheme: dark)').matches`); await browser.screenshot('chatui-tools-collapsed-dark.png'); } finally { await dark('light'); }
    // Expand: every step as one compact row with its status; a row expands to arguments and result.
    await browser.click(`${q('[data-testid=activity]')}.querySelector('button')`);
    await browser.until('rows visible', `${qa('[data-testid=activity-step]')}.filter(e => e.offsetParent !== null).length >= ${names.length}`);
    // Every step is one row with its status (a reasoning step may sit among the tool calls).
    const statuses = await browser.evaluate(`${qa('[data-testid=activity-step]')}.map(e => e.dataset.status)`);
    assert.ok(statuses.length >= names.length && statuses.every(status => status === 'completed'), `every step completed: ${statuses.join(', ')}`);
    await browser.screenshot('chatui-tools-expanded.png');
    await browser.click(`${q('[data-testid=tool-card]')}.querySelector('button')`);
    await browser.until('row open with arguments and result', `(() => { const c = ${q('[data-testid=tool-card]')}; return !c.querySelector('[data-testid=tool-details]').hidden && /Arguments/i.test(c.innerText) && /Result|Error/i.test(c.innerText); })()`);
    await browser.screenshot('chatui-tools.png');
    await dark('dark'); try { await browser.until('dark', `matchMedia('(prefers-color-scheme: dark)').matches`); await browser.screenshot('chatui-tools-expanded-dark.png'); } finally { await dark('light'); }
    // Expert mode: still one line, but successful rows have nothing to expand.
    await browser.click(`document.querySelector('.studio-mode input')`);
    await browser.until('expert rows have no details', `${qa('[data-testid=activity]')}.length === 1 && ${qa('[data-testid=tool-card][data-status=completed] [data-testid=tool-details]')}.length === 0`);
    await browser.click(`document.querySelector('.studio-mode input')`);
    await browser.until('developer mode shows them again', `${qa('[data-testid=tool-card][data-status=completed] [data-testid=tool-details]')}.length >= 3`);
  });
  await step('many tabs on a share link: hidden tabs release their chat stream, so every tab connects when shown (the browser allows ~6 connections per host)', async () => {
    const link = `${t.pageUrl}?variant=${t.variantId()}&conversation=${await t.history.current()}`;
    const watches = () => t.app.watches.open;
    const connectedNow = `document.querySelector('[data-testid=connection]')?.dataset.state === 'connected'`;
    const settle = async (label, expected) => { const deadline = Date.now() + 10000; while (watches() !== expected && Date.now() < deadline) await t.pause(150); assert.equal(watches(), expected, label); };
    await settle('only this tab holds a watch', 1);
    const opened = [];
    try {
      // Visible tabs each keep their stream: this is what exhausted the pool.
      for (let i = 0; i < 3; i++) { const tab = await browser.openTab(link); opened.push(tab); await tab.until('visible tab connected', connectedNow, 20000); }
      await settle('a visible tab holds one stream each', 4);
      for (const tab of opened.splice(0)) await tab.close();
      await settle('closing tabs releases their streams', 1);
      // Hidden tabs (a background tab reports visibilityState hidden) hold none, however many there are.
      for (let i = 0; i < 8; i++) {
        const tab = await browser.openTab(link, { hidden: true });
        opened.push(tab);
        // Only a mounted page can decide to hold a stream: count after each tab has rendered, not while it is still loading.
        await tab.until('hidden tab mounted', `!!document.querySelector('[data-testid=connection]')`, 30000);
      }
      // Opening a tab connects for a moment before it notices it is hidden: wait for the streams to be released, then they must stay released.
      await settle('eight hidden tabs hold no stream besides this one', 1);
      await t.pause(1500);
      assert.ok(watches() <= 1, `eight hidden tabs hold ${watches()} streams besides this one`);
      for (const tab of opened) {
        await tab.setVisible(true);
        await tab.until('hidden tab connects when shown', connectedNow, 20000);
        await settle('a shown tab holds one stream', 2);
        await tab.setVisible(false);
        await settle('a hidden tab lets its stream go', 1);
      }
      await settle('all hidden again: no tab holds a stream', 1);
      assert.ok(t.app.watches.peak <= 5, `peak concurrent watch streams ${t.app.watches.peak}`);
    } finally { for (const tab of opened) await tab.close().catch(() => {}); }
    assert.equal(await browser.evaluate(connectedNow), true, 'the first tab is still connected');
  });
  await step('dark mode: the same chat under prefers-color-scheme: dark', async () => {
    await dark('dark');
    try {
      await browser.until('dark tokens apply', `getComputedStyle(document.body).backgroundColor !== 'rgb(255, 255, 255)' && matchMedia('(prefers-color-scheme: dark)').matches`);
      const background = await browser.evaluate(`getComputedStyle(${q('[data-boring=pi-chat]')}).backgroundColor`);
      assert.notEqual(background, 'rgb(255, 255, 255)', 'the chat surface follows the dark tokens');
      await browser.screenshot('chatui-dark.png');
      await browser.screenshot('chatui-tools-dark.png');
    } finally { await dark('light'); }
  });
}
composer.order = 12;
// The scripted model's side (see ../scripted-model.mjs). The essays and "Reply with exactly" prompts are answered by its generic rules.
// The tool-heavy turn pauses between calls so the live header can be sampled changing.
const step = (name, args) => ({ delay: 300, hold: 600, tools: [{ name, args }] });
composer.script = {
  'Read README.md, packing-list.md and trips/itinerary.md one file at a time': [step('read', { path: 'README.md' }), step('read', { path: 'packing-list.md' }), step('read', { path: 'trips/itinerary.md' }), step('working_git', { operation: 'status' }), 'DONE-READING'],
};
export default composer;
