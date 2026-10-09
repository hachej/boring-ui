// Attachments and @mentions. The host resolves them at submit time and adds the files to the native input, so the model sees the
// content whether or not it has a file tool: the proof is that the user message itself carries the file part.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NOTES } from '../fixtures/workspace-files.mjs';
import { solidPng } from '../fixtures/media.mjs';

const TOKEN = 'LANTERN-7F3A9C21';

export default [
  {
    id: 'attach-no-file-tool', group: 'Attachments and mentions', title: 'Attach a file and ask about it', requires: ['workspace'],
    description: 'An attached text file is saved under uploads/ and reaches the model in the message itself, so no file tool is needed to read it.',
    steps: [{
      upload: { name: 'fictional-notes.md', content: `# Fictional harbour notes\n\nThe night ferry log uses the code word ${TOKEN}.\nNothing else here is secret.\n` },
      prompt: 'Which code word does the night ferry log use? Quote it exactly as written in the attached file, and nothing else.',
    }],
    // The model sees the file only because the host put it in the native message: the script reads it from there.
    script: { 0: [ctx => JSON.stringify(ctx.input).match(/LANTERN-[0-9A-F]+/)?.[0] ?? 'The file did not reach the model.'] },
    expect: [{ reply: new RegExp(TOKEN) }, { nativeInputHasFile: { path: 'uploads/fictional-notes', includes: TOKEN } }],
    async verify(t) {
      const { browser, q, qa } = t;
      const sent = (await t.messages()).filter(message => message.role === 'user').at(-1);
      assert.ok(sent.content[0].text.includes('@uploads/fictional-notes'), 'the @path text stays in the message');
      assert.equal(await browser.evaluate(`${qa('[data-testid=user-text]')}.every(e => !e.innerText.includes(${JSON.stringify(TOKEN)}))`), true, 'the bubble shows the mention, not the file content');
      // The mention in the sent message is a button that opens the file in the right panel.
      await browser.click(q('[data-testid=message-mention]'));
      await browser.until('the file opens in the workspace panel', `${q('[data-testid=workspace-panel] [data-testid=file-viewer]')}?.dataset.path?.startsWith('/workspace/uploads/fictional-notes')`, 15000);
      await t.closePanel();
    },
  },
  {
    id: 'attach-text-failed-upload', group: 'Attachments and mentions', title: 'Attach a text file, with a failed upload first', requires: ['workspace'],
    description: 'A failed upload is shown and dismissed; the text file is listed in the workspace and the agent answers from it.',
    steps: [{ upload: { name: 'visit-note.txt', content: 'Fictional harbour clinic visit note.\nThe clinic opens at 07:45 on weekdays.\n' }, prompt: 'At what time does the clinic open? Answer with the time only.' }],
    script: { 0: [ctx => JSON.stringify(ctx.input).match(/opens at (\d\d:\d\d)/)?.[1] ?? 'The file did not reach the model.'] },
    expect: [{ reply: /07:45/ }, { fileExists: 'uploads/visit-note.txt' }],
    async verify(t) {
      const { browser, q } = t;
      const directory = resolve('.cache/evidence/scenario-fixtures'); mkdirSync(directory, { recursive: true });
      const empty = `${directory}/empty.txt`; writeFileSync(empty, '');
      await browser.attachFiles(q('[data-testid=composer-file]'), [empty]);
      await browser.until('a failed upload is shown', `${q('[data-testid=upload-chip][data-state=failed]')}?.textContent.includes('empty')`, 10000);
      await browser.screenshot('menus-upload-failed.png');
      await browser.click(`${q('[data-testid=upload-chip]')}.querySelector('button')`);
      await browser.until('dismissed', `!${q('[data-testid=upload-chip]')}`, 3000);
      await t.tab('files');
      await browser.until('listed in the workspace panel', `[...document.querySelectorAll('.studio-panel li button')].some(b => b.textContent === 'uploads/visit-note.txt')`, 10000);
      await t.shots('menus-upload');
    },
  },
  {
    id: 'attach-image', group: 'Attachments and mentions', title: 'Attach an image', requires: ['workspace'],
    description: 'A PNG is sent to the model as a native image part and shown in the message.',
    steps: [{ upload: { name: 'swatch.png', mimeType: 'image/png', content: solidPng(64, [255, 0, 0]) }, prompt: 'What single colour is the attached image? Answer with one word.' }],
    script: { 0: [ctx => ctx.input.some(part => part.type === 'image' && part.mimeType === 'image/png') ? 'Red.' : 'No image reached the model.'] },
    expect: [{ reply: /red/i }, { nativeInputHasImage: 'image/png' }],
    async verify(t) { assert.equal(await t.browser.evaluate(`${t.qa('[data-testid=message-image]')}.length`), 1, 'the sent message shows the image'); },
  },
  {
    id: 'mention-file', group: 'Attachments and mentions', title: 'Mention a workspace file', requires: ['workspace'], seed: NOTES,
    description: 'An @mention of a file adds its content to the message, so no file tool is needed to read it.',
    steps: [{ mention: 'notes/consultation.md', prompt: "What is the patient's fictional identifier? Reply in chat with the identifier only, exactly as written in the file." }],
    script: { 0: [ctx => JSON.stringify(ctx.input).match(/EX-\d{4}/)?.[0] ?? 'The file did not reach the model.'] },
    expect: [{ reply: /EX-0001/ }, { nativeInputHasFile: { path: 'notes/consultation.md' } }],
    async verify(t) { assert.equal(await t.browser.evaluate(`${t.q('[data-testid=message-mention]')}?.dataset.path`), 'notes/consultation.md', 'the sent message shows a styled mention'); },
  },
];
