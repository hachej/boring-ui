// The shared document: the workspace file notes.md, which the agent and the person both edit. The agent writes it, the person edits it in the
// panel (rich or source) and saves, and the agent's next edit, made from memory, is refused as stale by the file guard
// (@hachej/boring-agent/file-guard); it reads the file again, its edit lands, and the person's edit is kept.
import assert from 'node:assert/strict';
import { call, NOTES_PATH, NOTES_PROMPT, SAVE_NOTES_TURNS } from './_script.mjs';

const STAR = { path: NOTES_PATH, edits: [{ oldText: '- Lantern', newText: '- Lantern\n- star map' }] };

export default {
  id: 'notes-document', group: 'Documents and files', requires: ['notes'], title: 'A shared document you both edit', panel: 'files',
  description: 'The agent keeps one shared document; you edit it in the panel, the agent\'s stale edit is refused, it reads again and its edit lands without losing yours.',
  steps: [{ prompt: NOTES_PROMPT }],
  script: { 0: SAVE_NOTES_TURNS, 'Add one more bullet item "star map"': [
    // From memory, without reading the person's edit: refused. Then read and edit.
    call('edit', STAR),
    call('read', { path: NOTES_PATH }),
    call('edit', STAR),
    'Added the star map.',
  ] },
  expect: [{ toolCalled: 'present' }, { artifact: { type: 'markdown', count: 1 } }],
  async verify(t) {
    const { browser, q, button, idle, SOURCE, SUBMIT } = t;
    // The document follows the save: open it from its card if the panel still shows the Workspace tabs.
    if (!await browser.evaluate(`!!${q('[data-testid=artifact-panel]')}`)) await browser.click(`${t.qa('[data-testid=artifact-card][data-state=ready]')}.at(-1)`);
    await browser.until('the document is in the panel', `!!${q('[data-testid=workspace-panel] [data-testid=document]')}`, 30000);
    await t.panelControls('shared document');
    await browser.click(q('[data-testid=workspace-panel] [data-testid=artifact-mode-source]'));
    await browser.until('document in editor', `${SOURCE}?.value.includes('Moon picnic')`, 60000);
    await browser.type(SOURCE, '\n- HUMAN-ADDED thermos\n');
    await browser.click(button('Save'));
    await browser.until('saved', `!${button('Save')}`);
    await t.say('Add one more bullet item "star map". Keep everything else exactly.');
    await browser.until('revised document', `/star map/i.test(${SOURCE}?.value ?? '') && /HUMAN-ADDED thermos/.test(${SOURCE}.value)`, 180000);
    await browser.until('idle', idle, 120000);
    // The agent's first edit was refused (the person saved after it wrote the file), it read the file again, and its second edit landed.
    // The scripted turns make that order certain; a remote deployment (no native messages here) runs a real model, which may read first.
    if (t.app) {
      const results = (await t.messages()).filter(message => message.role === 'toolResult' && message.toolName === 'edit');
      const text = message => message.content.map(part => part.text ?? '').join('');
      assert.equal(results.length, 2, 'the agent edited twice');
      assert.ok(results[0].isError && /changed since you last read it/.test(text(results[0])) && /read it again/i.test(text(results[0])), `the stale edit was refused: ${text(results[0])}`);
      assert.ok(!results[1].isError, `the edit after reading again landed: ${text(results[1])}`);
      assert.deepEqual((await t.toolNames()).filter(name => name === 'read' || name === 'edit').slice(-3), ['edit', 'read', 'edit'], 'refused edit, read again, edit');
    }
    void SUBMIT;

    // With the panel open the chat column is narrow and the composer keeps Send on the row of the attach and model buttons.
    await browser.evaluate(`document.querySelector('[data-testid=workspace-divider]').focus()`);
    await browser.press('Home');
    await browser.until('narrow chat', `${q('[data-testid=workspace-chat]')}.getBoundingClientRect().width < 400`, 5000);
    const rows = await browser.evaluate(`(() => { const chat = ${q('[data-testid=workspace-chat]')}.getBoundingClientRect();
      return { width: Math.round(chat.width), attach: ${q('[data-testid=composer-plus]')}.getBoundingClientRect().top,
        model: ${q('[data-testid=composer-model]')}.getBoundingClientRect().top, send: ${q('[data-testid=composer-submit]')}.getBoundingClientRect().top }; })()`);
    assert.ok(rows.width < 400, `the chat column is narrow here (${rows.width}px)`);
    assert.ok(Math.abs(rows.send - rows.attach) < 6 && Math.abs(rows.send - rows.model) < 6, `Send stays on the attach and model row ${JSON.stringify(rows)}`);
    await browser.screenshot('viewers-narrow-composer.png');
    await browser.evaluate(`document.querySelector('[data-testid=workspace-divider]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await t.shotMatrix('viewers-markdown');
  },
};
