// Real-browser journey of the diagram viewer and the maquette comment pins in the workspace app (`?feedback`, scripted model, no key).
// The agent writes and presents the fictional booking diagram (test/fixtures/diagram/booking.diagram.json): the artifact panel draws it
// with the built-in diagram kind, its path highlighted, top to bottom on a phone with no horizontal scroll at 390 or 360. Then the booking
// mock-up: How it works draws its workflow with the same view. Then comment pins: the maquette's comment icon enters the feedback item's
// point mode, two taps on blocks pin two notes, the icon again is Done and the pinned blocks show small numbers; the notes go with the next
// message and name the maquette path, screen id and block id. Screenshots at desktop 1440 and phone 390, light and dark, go to
// .cache/evidence/diagram-comments/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceApp } = await import('./server.mjs');
const { misses } = await import('../../lab/studio/scripted-model.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/diagram-comments';
mkdirSync(evidence, { recursive: true });
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const INPUT = q('[data-testid=composer-input]');
const DIAGRAM = q('[data-boring=diagram-viewer] [data-testid=diagram]');
const WALK = q('[data-testid=maquette-walk]');
const noOverflow = `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`;
const block = id => `[data-testid=maquette-screen] [data-testid=maquette-block][data-block="${id}"]`;
const scheme = value => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
const shoot = async name => { for (const value of ['light', 'dark']) { await scheme(value); await pause(250); await browser.screenshot(`${name}-${value}.png`); } await scheme('light'); };
const desktop = async () => { await browser.emulate('desktop'); await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(300); };
const notes = () => browser.evaluate(`${qa('[data-testid=feedback-point-count]')}.map(e => e.textContent).join('')`);

const app = await startWorkspaceApp({ directory: mkdtempSync(join(tmpdir(), 'boring-diagram-')) });
let browser;
try {
  browser = await launch(`${insecureUrl(app.url)}?feedback`, { evidence });
  await browser.until('the chat is live', `!!${INPUT} && !${INPUT}.disabled`, 20000);
  await desktop();
  const send = async text => { await browser.type(INPUT, text); await browser.press('Enter'); };
  const openMenu = async tap => { await (tap ? browser.tap : browser.click)(q('[data-testid=maquette-menu]')); await browser.until('the menu', `!!${q('[data-testid=maquette-menu-list]')}`, 5000); await pause(200); };
  /** Pins a note on a block: a tap (phone) or click (desktop) on `selector`, the note typed in the pin, Enter. */
  const pin = async (tap, selector, words) => {
    await (tap ? browser.tap : browser.click)(q(selector));
    await browser.until('the note pin', `!!${q('[data-testid=feedback-bubble-input]')}`, 5000);
    await browser.type(q('[data-testid=feedback-bubble-input]'), words);
    await browser.press('Enter');
    await browser.until('the note kept', `!${q('[data-testid=feedback-bubble]')}`, 5000);
  };

  await step('desktop 1440: the presented diagram opens in the panel with its path highlighted', async () => {
    await send('Make the booking diagram and present it.');
    await browser.until('the card names the built-in kind', `${q('[data-testid=artifact-card][data-state=ready]')}?.dataset.artifactKind === 'Diagram'`, 30000);
    await browser.until('the diagram in the panel', `!!${DIAGRAM}`, 10000);
    assert.equal(await browser.evaluate(`${q('[data-testid=artifact-panel-type]')}.textContent`), 'Diagram');
    assert.equal(await browser.evaluate(`${qa('[data-testid=diagram] g[data-node]')}.length`), 8);
    assert.deepEqual(await browser.evaluate(`${qa('[data-testid=diagram] g[data-node][data-lit]')}.map(e => e.dataset.node)`), ['browse', 'pick', 'details', 'held', 'confirmed', 'attended']);
    assert.ok(await browser.evaluate(noOverflow));
    await shoot('desktop-diagram');
  });

  await step('phone 390 and 360: the diagram runs top to bottom in the sheet and scrolls inside its own box', async () => {
    await browser.emulate('phone');
    await pause(400);
    if (!(await browser.evaluate(`!!${DIAGRAM}`))) await browser.tap(q('[data-testid=artifact-card][data-state=ready]'));
    await browser.until('the sheet with the diagram', `${q('[data-testid=workspace-panel]')}?.dataset.sheet === 'true' && !!${DIAGRAM}`, 10000);
    await browser.until('vertical layout', `${DIAGRAM}.dataset.layout === 'vertical'`, 5000);
    const fits = `(() => { const box = ${DIAGRAM}; return box.getBoundingClientRect().right <= innerWidth + 0.5; })()`;
    assert.ok(await browser.evaluate(fits), 'the diagram box stays inside the phone');
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll at 390');
    await shoot('phone-diagram');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    await pause(400);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll at 360');
    assert.ok(await browser.evaluate(fits), 'the diagram box stays inside a 360 phone');
  });

  await step('desktop 1440: the booking mock-up, How it works drawn by the same diagram view', async () => {
    await desktop();
    await send('Make the booking mock-up and present it.');
    await browser.until('the mock-up in the panel', `!!${WALK}`, 30000);
    await openMenu(false);
    await browser.click(q('[data-testid=maquette-how-open]'));
    await browser.until('How it works', `!!${q('[data-testid=maquette-how] [data-testid=diagram]')}`, 5000);
    await shoot('desktop-how-it-works');
    await browser.press('Escape');
    await browser.until('dialog closed', `!${q('[data-testid=maquette-how]')}`, 5000);
  });

  await step('desktop 1440: the comment icon enters point mode; two clicks pin two notes on blocks; the icon again is Done', async () => {
    assert.equal(await browser.evaluate(`${q('[data-testid=maquette-comment]')}?.getAttribute('aria-label')`), 'Comment on this screen');
    await browser.click(q('[data-testid=maquette-comment]'));
    await browser.until('point mode', `!!${q('[data-testid=feedback-point-bar]')}`, 5000);
    await pin(false, `${block('4')} button`, 'Say "Book a place" here');
    await pin(false, `${block('0')} h4`, 'A friendlier heading');
    assert.match(await notes(), /2/, 'two notes taken');
    await shoot('desktop-point-mode-2-pins');
    await browser.click(q('[data-testid=maquette-comment]'));
    await browser.until('markers on the two blocks', `${qa('[data-testid=maquette-pin]')}.length === 2`, 5000);
    await shoot('desktop-pins');
  });

  await step('phone 390: point mode in the sheet keeps the two pins; Done shows them as small numbers', async () => {
    await browser.emulate('phone');
    await pause(400);
    if (!(await browser.evaluate(`!!${WALK}`))) await browser.tap(qa('[data-testid=artifact-card][data-state=ready]') + '.at(-1)');
    await browser.until('the mock-up in the sheet', `${q('[data-testid=workspace-panel]')}?.dataset.sheet === 'true' && !!${WALK}`, 10000);
    await openMenu(true);
    await browser.tap(q('[data-testid=maquette-how-open]'));
    await browser.until('How it works', `!!${q('[data-testid=maquette-how] [data-testid=diagram]')}`, 5000);
    await browser.until('vertical on a phone', `${q('[data-testid=maquette-how] [data-testid=diagram]')}.dataset.layout === 'vertical'`, 5000);
    assert.ok(await browser.evaluate(noOverflow), 'How it works never scrolls the page');
    await shoot('phone-how-it-works');
    await browser.press('Escape');
    await browser.until('dialog closed', `!${q('[data-testid=maquette-how]')}`, 5000);
    await browser.tap(q('[data-testid=maquette-comment]'));
    await browser.until('point mode on the phone', `!!${q('[data-testid=feedback-point-bar]')}`, 5000);
    assert.match(await notes(), /2/, 'the two notes are kept');
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll while pointing');
    await shoot('phone-point-mode-2-pins');
    await browser.tap(q('[data-testid=maquette-comment]'));
    await browser.until('markers', `${qa('[data-testid=maquette-pin]')}.length === 2`, 5000);
    await shoot('phone-pins');
  });

  await step('phone 390: the notes go with the next message, naming the maquette path, screen id and block id', async () => {
    await browser.tap(q('[data-testid=artifact-close]'));
    await browser.until('the chat again', `!!${INPUT} && !!${q('[data-testid=feedback-count]')}`, 10000);
    // On a phone Enter is a new line: the send button sends.
    await browser.type(INPUT, 'Two changes on the class list');
    await browser.tap(q('[data-testid=composer-submit]'));
    await browser.until('the reply', `/Noted: the class list button/.test(document.body.textContent)`, 30000);
    const sent = await browser.evaluate(`${qa('[data-testid=message-user], [data-role=user]')}.map(e => e.textContent).join('\\n') || document.body.textContent`);
    assert.match(sent, /maquette:booking\.maquette\.json#screen=classes&block=4/);
    assert.match(sent, /maquette:booking\.maquette\.json#screen=classes&block=0/);
    assert.match(sent, /A friendlier heading/);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll with the sent note');
    await shoot('phone-sent-note');
    await desktop();
    await shoot('desktop-sent-note');
  });

  assert.deepEqual(misses, [], 'every prompt had a scripted answer');
  assert.deepEqual(browser.problems, [], 'no page errors');
  console.log(`PASS diagram and comments journey; screenshots in ${evidence}`);
} finally {
  await browser?.screenshot('last-state.png');
  await browser?.close();
  await app.close();
}
