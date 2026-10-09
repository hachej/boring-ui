// Composer menus: the `/` menu (commands and skills), `@` file mentions and the model and effort pickers. Real browser input and real
// models. Screenshots (light and dark) are the evidence for how the menus look: menus-slash, menus-mention, menus-chip, menus-model, menus-effort.
// Kept as a UI journey rather than scenarios because it is about the composer component; what attachments and mentions do for the model is
// covered by the "Attachments and mentions" scenarios.
import assert from 'node:assert/strict';

async function menus(t) {
  const { step, browser, say, button, idle, logText, MESSAGE } = t;
  const q = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const qa = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})]`;
  const chat = selector => selector;
  const dark = value => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
  const clear = async () => { await browser.evaluate(`${MESSAGE}.focus(); ${MESSAGE}.select()`); await browser.press('Backspace'); await browser.until('composer cleared', `${MESSAGE}.value === ''`); };
  const pause = ms => new Promise(done => setTimeout(done, ms));
  const fresh = () => t.fresh();
  const conversation = () => t.history.current().then(id => t.app.conversations.get(String(id)));
  const messages = () => t.messages();
  const agentDoc = async () => { const watch = await (await conversation()).watch(t.app.host.context); const view = watch.value; await watch.stop(); return view.docs['pi.agent']; };
  const bothThemes = async name => { await browser.screenshot(`${name}.png`); await dark('dark'); try { await pause(250); await browser.screenshot(`${name}-dark.png`); } finally { await dark('light'); } };
  const items = selector => browser.evaluate(`${qa(selector)}.map(e => e.dataset.name ?? e.dataset.path ?? e.textContent.trim())`);
  const seedNotes = () => t.api('/api/scenarios/mention-file/seed', { method: 'POST' });

  await step('the composer has every part: slash menu, @ mentions, attach, model and effort pickers, and the Workspace panel opens with full screen and Close', async () => {
    await seedNotes();
    await fresh();
    const variant = t.app.agents().find(entry => entry.id === t.variantId());
    const skills = variant.skills.map(skill => skill.name);
    // The composer is a combobox; none of the parts is hidden.
    for (const testid of ['composer-file', 'composer-plus', 'composer-model']) assert.equal(await browser.evaluate(`!!${q(`[data-testid=${testid}]`)}`), true, `${testid}`);
    assert.equal(await browser.evaluate(`${MESSAGE}.getAttribute('role')`), 'combobox', 'the composer has menus');
    await browser.type(MESSAGE, '/');
    await browser.until('slash menu', `!!${q('[data-testid=slash-menu]')}`, 5000);
    assert.deepEqual(await items('[data-testid=slash-item]'), ['new', 'clear', ...(variant.selfEvolving ? ['reload'] : []), ...skills], 'slash entries: commands, then the agent\'s skills');
    await clear();
    await browser.type(MESSAGE, '@');
    await browser.until('mention menu', `!!${q('[data-testid=mention-menu]')}`, 8000);
    await browser.until('files listed', `${qa('[data-testid=mention-item]')}.length >= 1`, 8000);
    await clear();
    await browser.until('menus closed', `!${q('[data-testid=slash-menu]')} && !${q('[data-testid=mention-menu]')}`, 5000);
    await t.openPanel(); await t.panelControls('Workspace'); await t.closePanel();
    assert.equal(await browser.evaluate(`!${q('[data-testid=when-busy]')} && !${q('[data-testid=queue]')}`), true, 'the queue shows only when something is queued');
    await browser.screenshot('menus-composer.png');
  });

  await step('slash menu: commands and skills, chips, search by name or description, keyboard and mouse selection', async () => {
    await seedNotes();
    await fresh();
    await browser.type(MESSAGE, '/');
    await browser.until('the slash menu opens', `!!${q('[data-testid=slash-menu]')}`, 5000);
    assert.deepEqual(await items('[data-testid=slash-item]'), ['new', 'clear', 'reload', 'letter-style', 'plain-language', 'letter-review']);
    assert.deepEqual(await browser.evaluate(`${qa('[data-testid=slash-chip]')}.map(e => e.textContent)`), ['All', 'built-in', 'skills']);
    assert.equal(await browser.evaluate(`${qa('[data-testid=slash-chip]')}.find(e => e.textContent === 'All').getAttribute('aria-selected')`), 'true');
    assert.equal(await browser.evaluate(`document.querySelector('[role=tablist]').getAttribute('role')`), 'tablist');
    assert.deepEqual(await browser.evaluate(`${qa('[data-testid=slash-item]')}.map(e => [e.dataset.name, !!e.querySelector('[data-testid=slash-badge-skill]')])`),
      [['new', false], ['clear', false], ['reload', false], ['letter-style', true], ['plain-language', true], ['letter-review', true]], 'the skill badge is on skill rows only');
    assert.equal(await browser.evaluate(`${q('[data-testid=slash-item][data-name=letter-style]')}.title.startsWith('House style')`), true, 'full description in the title attribute');
    await browser.screenshot('menus-slash.png');
    await dark('dark'); try { await pause(250); await browser.screenshot('menus-slash-dark.png'); } finally { await dark('light'); }

    // Chips restrict the list; chips and search combine.
    await browser.click(`${qa('[data-testid=slash-chip]')}.find(e => e.textContent === 'skills')`);
    await browser.until('only skills', `${qa('[data-testid=slash-item]')}.length === 3`, 3000);
    assert.deepEqual(await items('[data-testid=slash-item]'), ['letter-style', 'plain-language', 'letter-review']);
    await browser.click(`${qa('[data-testid=slash-chip]')}.find(e => e.textContent === 'built-in')`);
    assert.deepEqual(await items('[data-testid=slash-item]'), ['new', 'clear', 'reload']);
    await browser.click(`${qa('[data-testid=slash-chip]')}.find(e => e.textContent === 'All')`);
    // Search matches the description as well as the name ("rewrite" is only in plain-language's description).
    await browser.type(q('[data-testid=slash-search]'), 'rewrite');
    await browser.until('filtered by description', `${qa('[data-testid=slash-item]')}.length === 1`, 3000);
    assert.deepEqual(await items('[data-testid=slash-item]'), ['plain-language']);
    await browser.click(`${qa('[data-testid=slash-chip]')}.find(e => e.textContent === 'built-in')`);
    await browser.until('no match', `!!${q('[data-testid=slash-empty]')}`, 3000);
    assert.equal(await browser.evaluate(`${q('[data-testid=slash-empty]')}.textContent`), 'No matching commands.');
    await browser.press('Escape');
    await browser.until('Escape closes the menu', `!${q('[data-testid=slash-menu]')}`, 3000);
    assert.equal(await browser.evaluate(`${MESSAGE}.value`), '/', 'the text stays');
    await clear();

    // Typing after the slash filters (seeded search); hovering moves the single highlight.
    await browser.type(MESSAGE, '/clea');
    await browser.until('filtered by typing', `${qa('[data-testid=slash-item]')}.length === 1 && ${q('[data-testid=slash-search]')}.value === 'clea'`, 3000);
    await clear();
    await browser.type(MESSAGE, '/');
    await browser.until('menu again', `${qa('[data-testid=slash-item]')}.length === 6`, 3000);
    await browser.hover(q('[data-testid=slash-item][data-name=plain-language]'));
    await browser.until('hover moves the active row', `${q('[data-testid=slash-item][data-name=plain-language]')}.dataset.active === 'true' && ${qa('[data-testid=slash-item][data-active=true]')}.length === 1`, 3000);
    // Keyboard: three arrows down from the first row picks the first skill, which becomes a token at the start.
    await clear();
    await browser.type(MESSAGE, '/');
    await browser.until('menu', `${qa('[data-testid=slash-item]')}.length === 6`, 3000);
    await browser.press('ArrowDown'); await browser.press('ArrowDown'); await browser.press('ArrowDown');
    await browser.until('fourth row active', `${q('[data-testid=slash-item][data-active=true]')}?.dataset.name === 'letter-style'`, 3000);
    await browser.press('Enter');
    await browser.until('skill token inserted', `${MESSAGE}.value === '/letter-style ' && !${q('[data-testid=slash-menu]')}`, 3000);
    assert.deepEqual(await browser.evaluate(`${qa('[data-testid=transcript] article[data-role=user]')}.length`), 0, 'Enter picked, it did not send');

    await browser.type(MESSAGE, 'Write a short referral letter for the patient in notes/consultation.md.');
    await browser.press('Enter');
    await browser.until('the agent loaded the skill and finished', `${idle} && /Write a short referral letter/.test(${logText}) && /load_skill/.test(${logText})`, 240000);
    const loaded = (await messages()).flatMap(message => message.role === 'assistant' ? message.content.filter(part => part.type === 'toolCall' && part.name === 'load_skill') : []);
    assert.ok(loaded.some(call => call.arguments.name === 'letter-style'), `load_skill(letter-style) was called: ${JSON.stringify(loaded.map(call => call.arguments))}`);
    assert.equal(await browser.evaluate(`${q('[data-testid=message-skill]')}?.dataset.skill`), 'letter-style', 'the sent token is styled');
    assert.ok((await messages()).some(message => message.role === 'user' && String(JSON.stringify(message.content)).startsWith('"/letter-style Write') || JSON.stringify(message.content).includes('/letter-style Write')), 'the model received the token');

    // A host command runs: /clear empties the composer, and the typed text after the slash goes with it.
    await browser.type(MESSAGE, '/clea');
    await browser.until('only /clear', `${qa('[data-testid=slash-item]')}.length === 1`, 3000);
    await browser.click(q('[data-testid=slash-item][data-name=clear]'));
    await browser.until('/clear cleared the composer', `${MESSAGE}.value === '' && !${q('[data-testid=slash-menu]')}`, 3000);
  });
  await step('@ mentions: the picker lists workspace files, the pick is a chip, the agent reads the file, the sent message styles it', async () => {
    await seedNotes();
    await fresh();
    await browser.type(MESSAGE, '@');
    await browser.until('the mention picker lists files', `${qa('[data-testid=mention-item]')}.length >= 2`, 8000);
    assert.ok((await items('[data-testid=mention-item]')).includes('notes/consultation.md'));
    await browser.type(MESSAGE, 'consult');
    await browser.until('filtered', `${qa('[data-testid=mention-item]')}.length === 1`, 8000);
    await browser.screenshot('menus-mention.png');
    await dark('dark'); try { await pause(250); await browser.screenshot('menus-mention-dark.png'); } finally { await dark('light'); }
    await browser.press('Enter');
    await browser.until('picked as a chip', `${MESSAGE}.value === '@notes/consultation.md ' && ${q('[data-testid=mention-chip]')}?.dataset.path === 'notes/consultation.md'`, 3000);
    // A chip can be removed before sending; its text goes with it.
    await browser.click(`${q('[data-testid=mention-chip]')}.querySelector('button')`);
    await browser.until('chip removed', `!${q('[data-testid=mention-chip]')} && ${MESSAGE}.value === ''`, 3000);
    await browser.type(MESSAGE, '@consult'); await browser.until('menu', `${qa('[data-testid=mention-item]')}.length === 1`, 8000);
    await browser.click(q('[data-testid=mention-item]'));
    await browser.until('chip again', `!!${q('[data-testid=mention-chip]')}`, 3000);
    await browser.type(MESSAGE, "What is the patient's fictional identifier? Do not write any file or letter; reply in chat with the identifier only, exactly as written in the file.");
    await browser.screenshot('menus-chip.png');
    await browser.press('Enter');
    await browser.until('answered from the mentioned file', `${idle} && /EX-0001/.test(${logText}.replace(/fictional identifier\\?/, ''))`, 180000);
    assert.equal(await browser.evaluate(`${q('[data-testid=message-mention]')}?.dataset.path`), 'notes/consultation.md', 'the sent message shows a styled mention');
    await browser.screenshot('menus-mention-sent.png');
  });
  await step('model and effort pickers: the current choice shows, changing it survives a reload and drives the next answer', async () => {
    await fresh();
    const pill = () => browser.evaluate(`${q(chat('[data-testid=composer-model-label]'))}?.textContent`);
    const settled = text => `${q(chat('[data-testid=composer-model-label]'))}.textContent === ${JSON.stringify(text)} && !${q(chat('[data-testid=composer-model]'))}.disabled`;
    assert.equal(await pill(), 'GPT-5 mini · Medium', 'one pill with the model and the effort');
    await browser.click(q(chat('[data-testid=composer-model]')));
    await browser.until('model and effort menu', `${qa('[data-testid=composer-model-option]')}.length === ${t.app.host.models.length} && ${qa('[data-testid=composer-effort-option]')}.length === 4`, 3000);
    await bothThemes('menus-model');
    await browser.click(`${qa('[data-testid=composer-model-option]')}.find(e => e.dataset.value.endsWith('gpt-5-nano'))`);
    await browser.until('the pill follows the change', settled('GPT-5 nano · Medium'), 10000);
    await browser.click(q(chat('[data-testid=composer-model]')));
    await browser.until('effort section', `${qa('[data-testid=composer-effort-option]')}.length === 4`, 3000);
    await bothThemes('menus-effort');
    await browser.click(`${qa('[data-testid=composer-effort-option]')}.find(e => e.dataset.value === 'low')`);
    await browser.until('effort label', settled('GPT-5 nano · Low'), 10000);
    assert.deepEqual([(await agentDoc()).model.modelId, (await agentDoc()).thinkingLevel], ['gpt-5-nano', 'low'], 'the native conversation changed');

    await browser.reload();
    await browser.until('after reload, still the nano model at low effort', `${q(chat('[data-testid=composer-model-label]'))}?.textContent === 'GPT-5 nano · Low'`, 20000);
    await say('Reply with exactly: NANO-OK');
    await browser.until('answered', `${idle} && /NANO-OK/.test(${logText}.replace('Reply with exactly: NANO-OK', ''))`, 120000);
    const assistant = (await messages()).filter(message => message.role === 'assistant').at(-1);
    assert.equal(assistant.model, 'gpt-5-nano', 'the next answer was produced by the chosen model');

    // The host owns the allow-list: a model it does not offer is refused and nothing changes.
    const refused = await browser.evaluate(`(async () => { const id = document.querySelector('[data-testid=studio-main]').dataset.conversation;
      const response = await fetch('/api/chat?conversation=' + id + '&op=configure', { method: 'POST', headers: { authorization: 'Bearer ' + window.__STUDIO__.token, 'content-type': 'application/json' }, body: JSON.stringify({ model: { provider: 'openai', modelId: 'gpt-5' } }) });
      return response.json(); })()`);
    assert.equal(refused.kind, 'refused');
    assert.equal((await agentDoc()).model.modelId, 'gpt-5-nano');

    // Back to the demo's own defaults so later journeys run on the model they expect.
    await browser.click(q(chat('[data-testid=composer-model]')));
    await browser.click(`${qa('[data-testid=composer-model-option]')}.find(e => e.dataset.value.endsWith('gpt-5-mini'))`);
    await browser.until('mini again', settled('GPT-5 mini · Low'), 10000);
    await browser.click(q(chat('[data-testid=composer-model]')));
    await browser.click(`${qa('[data-testid=composer-effort-option]')}.find(e => e.dataset.value === 'medium')`);
    await browser.until('medium again', settled('GPT-5 mini · Medium'), 10000);
  });
}
menus.order = 13;
// The scripted model's side (see ../scripted-model.mjs); "Reply with exactly" prompts need none.
menus.script = {
  'Write a short referral letter for the patient in notes/consultation.md.': [{ tools: [{ name: 'load_skill', args: { name: 'letter-style' } }] }, 'I loaded the letter-style skill and will draft the letter.'],
  'Do not write any file or letter; reply in chat with the identifier only': [ctx => JSON.stringify(ctx.input).match(/EX-\d{4}/)?.[0] ?? 'The file did not reach the model.'],
};
export default menus;
