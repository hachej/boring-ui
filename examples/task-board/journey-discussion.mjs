import assert from 'node:assert/strict';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startTaskBoard } from './server.mjs';

// Logic probe only: no screenshots or visual-parity assertions.
const app = await startTaskBoard();
let browser;
try {
  browser = await launch(app.url);
  await browser.until('PM connected', '!!document.querySelector("textarea")');
  await browser.type('document.querySelector("textarea")', 'Keep my draft.');
  await browser.click(`document.querySelector('[aria-label="Right stage"] [data-task-open="D-201"]')`);
  await browser.until('task question mounted', '!!document.querySelector("[data-task-discuss=supplies]")');
  await pause(600);
  await browser.click('document.querySelector("[data-task-discuss=supplies]")');
  await pause(100);
  const draft = await browser.evaluate('document.querySelector("textarea").value');
  assert.match(draft, /Keep my draft\./, 'Discuss preserves existing draft text');
  assert.match(draft, /What should we bring\?/, 'Discuss fills the composer with the question');
  assert.equal(await browser.evaluate('document.activeElement === document.querySelector("textarea")'), true);
  assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=mention-chip][data-path="task:D-201"]').length`), 1);
  const before = (await app.view()).entries.flatMap(entry => entry.model ?? []);
  assert.equal(before.filter(message => message.role === 'user').length, 0, 'Discuss does not send');
  assert.equal(before.filter(message => message.toolName === 'answer_task_question').length, 0);
  await browser.click('document.querySelector("[data-testid=composer-submit]")');
  await browser.until('sent task mention', `!!document.querySelector('[data-testid=message-mention][data-path="task:D-201"]')`);
  await browser.click(`document.querySelector('[data-testid=message-mention][data-path="task:D-201"]')`);
  await browser.until('Send settles the original task through the same PM', 'document.querySelector("[data-task-answer=supplies]")?.textContent.includes("PM: water")');
  const after = (await app.view()).entries.flatMap(entry => entry.model ?? []);
  assert.equal(after.filter(message => message.role === 'toolResult' && message.toolName === 'answer_task_question').length, 1);
  console.log('PASS Discuss preserves draft, focuses one task mention, sends nothing until Send, then settles in the same native PM conversation');
  assert.deepEqual(browser.problems, []);
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser?.close();
  await app.close();
}
