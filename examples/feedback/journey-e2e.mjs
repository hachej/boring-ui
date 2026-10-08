// Release 1 qualification journey (WP9, docs/implementation/FEEDBACK-WORK-PACKAGES.md): one driven Chromium journey on the fictional
// Fernhill page with AmbientChat and the builder agent on its keyless scripted model (builder.mjs). Real pointer and keyboard input
// over the DevTools protocol, an insecure origin, and the WP3 canary kit planted in the application root for the whole visit, with a
// canary-laden route. Steps:
//   point at Save, refine to the parent and back; annotate, Copy, Save; reload; attach the report with an @ mention; the agent lists
//   it (with its development `source`) and offers to show it; Show in the card is `applied` and highlighted; the agent changes the
//   page and resolves the item (its publication reply is lost and reconciled); then the failure cases: an ambiguous pin and the
//   person's choice, a removed element (`missing`), Show from a chat outside the page (`unavailable`), Ada and Bob in two browsers
//   creating at once and resolving one item at once (one `conflict`), revocation hiding Ada's items from Bob, and the canary kit over
//   everything the journey produced. Screenshots and journey.json go to .cache/evidence/feedback-app/. Manual evidence, not an npm test.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { defaultCanaries, runPrivacyCanaries } from '@hachej/boring-feedback/page';
import { parseFeedback, serializeFeedback } from '@hachej/boring-feedback/format';
import { startFeedbackApp } from './server.mjs';
import { SAVE_LABEL_AFTER } from './builder.mjs';
import { insecureUrl, launch, pause } from '@hachej/boring-testing/browser';

const evidence = process.env.FEEDBACK_EVIDENCE ?? '.cache/evidence/feedback-app';
const chromium = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-e2e-'));
const steps = [];
const summary = { journey: 'feedback-release-1-e2e', startedAt: new Date().toISOString(), model: 'scripted (keyless)', steps, screenshots: [], records: {} };
const step = async (name, run) => { const started = Date.now(); await run(); steps.push({ name, ms: Date.now() - started }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };

// Selectors. The chat card and the page's report panel share some test ids, so card selectors are scoped to the bar.
const q = testid => `document.querySelector('[data-testid=${JSON.stringify(testid)}]')`;
const CHAT = `document.querySelector('[data-boring=ambient-chat]')`;
const inChat = testid => `${CHAT}?.querySelector('[data-testid=${JSON.stringify(testid)}]')`;
const offerCard = id => `[...(${CHAT}?.querySelectorAll('[data-testid=feedback-card][data-kind=offer][data-feedback-id=${JSON.stringify(id)}]') ?? [])].at(-1)`;
const listCards = `[...(${CHAT}?.querySelectorAll('[data-testid=feedback-card][data-kind=list]') ?? [])]`;
const TRANSCRIPT = `(${inChat('transcript')}?.innerText ?? '')`;
const OVERLAY = `document.querySelector('[data-feedback-overlay]')?.shadowRoot`;
const DRAWN = `[...(${OVERLAY}?.querySelectorAll('.label') ?? [])].map(label => ({ label: label.textContent, tone: label.dataset.tone }))`;
const SAVE_PROFILE = q('save-profile');
const STATUS = q('feedback-status');
const boxOver = target => `(() => { const box = ${OVERLAY}?.querySelector('.box')?.getBoundingClientRect(); const element = (${target}).getBoundingClientRect(); return !!box && Math.abs(box.top - element.top) < 2 && Math.abs(box.left - element.left) < 2; })()`;

// The canary-laden route: the route template is the policy's one widening, so none of these may leave the page.
const tokens = defaultCanaries();
const ROUTE = `settings/${tokens['route-segment']}/%${tokens['route-percent'].charCodeAt(0).toString(16)}${tokens['route-percent'].slice(1)}?q=${tokens['route-query']}&canaries=1&ui=classic#${tokens['route-fragment']}`;

const BOB_ROUTE = ROUTE.replace('#', '&as=bob#');

const app = await startFeedbackApp({ directory, port: 0 });
const browsers = [];
const produced = { copied: [], reports: [], lists: [], toolResults: [], dom: [] };
try {
  const base = insecureUrl(app.url);
  const ada = await launch(`${base}${ROUTE}`, { chromium, evidence });
  browsers.push(ada);
  const shot = async (browser, name) => { await pause(300); await browser.screenshot(`e2e-${name}.png`); summary.screenshots.push(join(evidence, `e2e-${name}.png`)); };
  const goto = async (browser, path = ROUTE) => {
    await browser.send('Page.navigate', { url: `${base}${path}` });
    await browser.until('the page, the feedback dock and the agent bar', `!!(${q('app-root')} && ${q('feedback-point')} && !${q('feedback-point')}.disabled && ${CHAT} && ${inChat('composer-input')} && !${inChat('composer-input')}.disabled)`, 30000);
    await pause(300);
  };
  const pin = async (browser, target) => {
    await browser.evaluate(`(${target}).scrollIntoView({ block: 'center' })`);
    await browser.click(q('feedback-point'));
    await browser.until('pick mode', `${q('feedback-point')}.getAttribute('aria-pressed') === 'true'`, 5000);
    await browser.hover(target);
    await browser.until('a hover box', `!!(${DRAWN}).find(item => item.tone === 'hover')`, 5000);
    await browser.click(target);
    await browser.until('the annotate sheet', `!!${q('feedback-sheet')}`, 5000);
  };
  const annotateAndSave = async (browser, said) => {
    await browser.type(q('feedback-note'), said);
    await browser.click(q('feedback-save'));
    await browser.until('saved', `${STATUS}.dataset.save === 'saved'`, 10000);
    await browser.click(q('feedback-close'));
  };
  const idOf = async (person, said) => {
    const listed = await app.store.list({}, app.people[person].access);
    const item = listed.kind === 'available' ? listed.items.find(entry => entry.title === said) : undefined;
    assert.ok(item, `"${said}" is stored and listed for ${person}`);
    return item.id;
  };
  const openChat = async browser => {
    if (await browser.evaluate(`${CHAT}.dataset.state`) !== 'expanded') await browser.click(inChat('ambient-title'));
    await browser.until('the chat is open', `${CHAT}.dataset.state === 'expanded' && !!${inChat('transcript')}`, 5000);
  };
  const say = async (browser, text, { mention } = {}) => {
    await openChat(browser);
    if (mention) {
      await browser.type(inChat('composer-input'), '@');
      const item = `${CHAT}.querySelector('[data-testid=mention-item][data-path=${JSON.stringify(mention)}]')`;
      await browser.until(`the @ menu offers ${mention}`, `!!${item}`, 10000);
      await browser.click(item);
      await browser.until('a mention chip', `!!${CHAT}.querySelector('[data-testid=mention-chip][data-path=${JSON.stringify(mention)}]')`, 5000);
    }
    await browser.type(inChat('composer-input'), text);
    await browser.press('Enter');
  };
  // Click the element line of the latest offer for `id` (the card's former Show button). The transcript may still be scrolling into
  // place, so a click that did not land is retried.
  const pressShow = async (browser, id) => {
    const pressed = `(${offerCard(id)}?.dataset.outcome || !!${q('show-choose')})`;
    for (let attempt = 0; attempt < 5; attempt++) {
      await pause(250);
      await browser.click(`${offerCard(id)}.querySelector('[data-testid=feedback-element]')`);
      if (await browser.until('Show pressed', pressed, 1500).catch(() => false)) return;
    }
    throw new Error(`Show for ${id} could not be pressed`);
  };
  const replied = (browser, pattern, timeout = 20000) => browser.until(`a reply matching ${pattern}`, `${new RegExp(pattern).toString()}.test(${TRANSCRIPT}) && ${CHAT}.querySelector('[data-testid=ambient-status]')?.dataset.status !== 'working'`, timeout);

  // ---------------------------------------------------------------------------------------------------------------------------
  await ada.until('the page, the feedback dock and the agent bar', `!!(${q('app-root')} && ${q('feedback-point')} && ${CHAT})`, 30000);
  await step('environment: insecure origin, canaries planted in the application root, route full of canaries, agent bar ignored', async () => {
    const env = await ada.evaluate(`({ secure: window.isSecureContext, planted: !!${q('app-root')}.querySelector('[data-feedback-canaries]'), title: document.title,
      path: location.pathname, bar: !!document.querySelector('[data-feedback-ignore] [data-boring=ambient-chat]') })`);
    assert.equal(env.secure, false);
    assert.equal(env.planted, true, 'the canary section is inside the application root');
    assert.equal(env.title, tokens['document-title'], 'the document title is a canary');
    assert.ok(env.path.includes(tokens['route-segment']));
    assert.equal(env.bar, true);
    await shot(ada, '01-page');
  });

  const SAID = 'The Save button should say what it saves.';
  let saveId;
  await step('point at Save, refine to the parent and back, pin without pressing it', async () => {
    await ada.click(q('feedback-point'));
    await ada.until('pick mode', `${q('feedback-point')}.getAttribute('aria-pressed') === 'true'`, 5000);
    await ada.hover(SAVE_PROFILE);
    assert.equal(await ada.until('a hover label', `(${DRAWN}).find(item => item.tone === 'hover')?.label`, 5000), 'SettingsPage · button «Save profile»');
    await ada.press('ArrowUp');
    const parent = await ada.until('the parent label', `(() => { const hover = (${DRAWN}).find(item => item.tone === 'hover'); return hover && hover.label !== 'SettingsPage · button «Save profile»' ? hover.label : null; })()`, 5000);
    assert.match(parent, /^SettingsPage · /);
    await shot(ada, '02-parent');
    await ada.press('ArrowDown');
    await ada.until('back to the button', `(${DRAWN}).find(item => item.tone === 'hover')?.label === 'SettingsPage · button «Save profile»'`, 5000);
    await ada.click(SAVE_PROFILE);
    await ada.until('the annotate sheet', `!!${q('feedback-sheet')}`, 5000);
    assert.equal(await ada.evaluate(`${q('profile-saved')}.dataset.presses`), '0', 'the form was never submitted');
  });

  await step('annotate, Copy, Save: the copied text is feedback@1 with the route template only', async () => {
    await ada.type(q('feedback-note'), SAID);
    await ada.click(q('feedback-copy'));
    const kind = await ada.until('copy outcome', `['copied', 'manual'].includes(${STATUS}.dataset.copy) && ${STATUS}.dataset.copy`, 5000);
    const text = await ada.evaluate(kind === 'copied' ? `${q('feedback-copy-text')}.textContent` : `${q('feedback-manual-copy')}.value`);
    produced.copied.push(text);
    assert.ok(text.includes(SAID));
    assert.ok(text.includes('"route": "/settings/:section"'));
    await ada.click(q('feedback-save'));
    await ada.until('saved', `${STATUS}.dataset.save === 'saved'`, 10000);
    await shot(ada, '03-saved');
    await ada.click(q('feedback-close'));
    saveId = await idOf('ada', SAID);
    summary.records.saveId = saveId;
  });

  await step('reload: the page comes back with the canaries replanted and the report stored', async () => {
    await goto(ada);
    assert.equal(await ada.evaluate(`!!${q('app-root')}.querySelector('[data-feedback-canaries]')`), true);
    const read = await app.store.read(saveId, app.people.ada.access);
    assert.equal(read.kind, 'available');
    assert.equal(read.report.status, 'open');
  });

  await step('mention: the report is attached with @, the agent lists it with its source and offers to show it', async () => {
    await say(ada, 'what is this about?', { mention: `feedback/${saveId}.md` });
    await replied(ada, `I offered to show ${saveId}`);
    await ada.until('a list card and an offer card', `${listCards}.length > 0 && !!${offerCard(saveId)}`, 10000);
    const listed = await ada.evaluate(`${listCards}.at(-1).innerText`);
    assert.ok(listed.includes(SAID));
    assert.match(listed, /SettingsPage\.jsx:\d+/, 'the element line names its file:line');
    assert.doesNotMatch(listed, /checked in the page/, '"checked in the page" is not repeated on every line');
    const turn = await app.messages('ada');
    const user = turn.filter(message => message.role === 'user').at(-1);
    assert.ok(JSON.stringify(user.content).includes(`<file path=\\"feedback/${saveId}.md\\">`), 'the mention was inlined by the store mention reader');
    const list = turn.filter(message => message.role === 'toolResult' && message.toolName === 'feedback').map(message => JSON.parse(message.content[0].text)).filter(result => result.action === 'list').at(-1);
    const source = list.items.find(item => item.id === saveId).anchors[0].signals.source;
    assert.match(source, /^examples\/feedback\/settings\/SettingsPage\.jsx:\d+$/, 'the WP8 development source location travels with the pin');
    summary.records.source = source;
    assert.match(await ada.evaluate(TRANSCRIPT), new RegExp(`source ${source.replace(/[.]/g, '\\.')}`));
    assert.equal(await ada.evaluate(`${offerCard(saveId)}.dataset.outcome`), undefined, 'nothing is shown before the person presses Show');
    assert.deepEqual(await ada.evaluate(DRAWN), [], 'no overlay mark before Show');
    await shot(ada, '04-offer');
  });

  await step('Show in the card: applied, and the Save button is highlighted in the page', async () => {
    await pressShow(ada, saveId);
    assert.equal(await ada.until('an outcome', `${offerCard(saveId)}.dataset.outcome`, 10000), 'applied');
    const drawn = await ada.evaluate(DRAWN);
    assert.deepEqual(drawn.map(item => item.tone), ['reveal']);
    assert.equal(drawn[0].label, SAID, 'the note drawn is what was said');
    assert.equal(await ada.evaluate(boxOver(SAVE_PROFILE)), true, 'the box is over the Save button');
    await shot(ada, '05-shown');
  });

  await step('the agent changes the page and resolves the item; the lost publication reply is reconciled', async () => {
    app.loseNextReply();
    await say(ada, `please resolve ${saveId}`);
    await replied(ada, `Resolved ${saveId}: addressed`);
    await ada.until('the page changed', `${SAVE_PROFILE}.textContent === ${JSON.stringify(SAVE_LABEL_AFTER)}`, 10000);
    assert.equal(app.lostReplies, 1, 'the reply of the committed resolution was lost');
    const read = await app.store.read(saveId, app.people.ada.access);
    assert.equal(read.report.status, 'addressed');
    assert.equal(read.report.resolutions.length, 1, 'one resolution: the lost reply was reconciled, not written twice');
    assert.equal(read.report.resolutions[0].by, 'p_fictional_builder', 'the resolver is the host-resolved builder principal');
    await shot(ada, '06-resolved');
  });

  const EXPORT_SAID = 'Which file does this export?';
  let exportId;
  await step('ambiguous: one of two identical Export buttons; Show numbers the candidates and waits for the person', async () => {
    const EXPORT_SECOND = `document.querySelectorAll('[data-testid=exports] .fh-btn')[1]`;
    await pin(ada, EXPORT_SECOND);
    await annotateAndSave(ada, EXPORT_SAID);
    exportId = await idOf('ada', EXPORT_SAID);
    await say(ada, 'and this one?', { mention: `feedback/${exportId}.md` });
    await replied(ada, `I offered to show ${exportId}`);
    await pressShow(ada, exportId);
    // Both Export buttons are candidates (the planted canary section adds a masked button of the same structure as a third).
    const count = await ada.until('the chooser', `document.querySelectorAll('[data-testid=show-candidate]').length`, 10000);
    assert.ok(count >= 2);
    const labels = await ada.evaluate(`[...document.querySelectorAll('[data-testid=show-candidate]')].map(button => button.textContent)`);
    assert.equal(labels.filter(label => label.includes('ExportButton · button «Export CSV»')).length, 2, labels.join(' | '));
    assert.deepEqual(await ada.evaluate(DRAWN), Array.from({ length: count }, (_, index) => ({ label: String(index + 1), tone: 'candidate' })), 'numbers only, no reveal');
    const chosenBox = await ada.evaluate(`(() => { const r = [...${OVERLAY}.querySelectorAll('.box')][0].getBoundingClientRect(); return { top: r.top, left: r.left }; })()`);
    assert.equal(await ada.evaluate(`${offerCard(exportId)}.dataset.outcome`), undefined, 'no outcome until the person chooses');
    produced.dom.push(await ada.evaluate(`${q('show-choose')}.innerText`));
    await shot(ada, '07-choose');
    await ada.click(`document.querySelector('[data-testid=show-candidate][data-number="1"]')`);
    assert.equal(await ada.until('an outcome', `${offerCard(exportId)}.dataset.outcome`, 10000), 'applied');
    assert.match(await ada.evaluate(`${offerCard(exportId)}.innerText`), /chosen/);
    assert.match(await ada.evaluate(`${offerCard(exportId)}.querySelector('[data-testid=feedback-outcome]').title`), /You chose this candidate/);
    const revealed = await ada.evaluate(`(() => { const boxes = [...${OVERLAY}.querySelectorAll('.box')]; const r = boxes[0].getBoundingClientRect(); return { boxes: boxes.length, top: r.top, left: r.left }; })()`);
    assert.equal(revealed.boxes, 1, 'only the chosen candidate stays boxed');
    assert.ok(Math.abs(revealed.top - chosenBox.top) < 2 && Math.abs(revealed.left - chosenBox.left) < 2, 'the revealed element is candidate 1, the one the person chose');
    assert.equal(await ada.evaluate(`${q('exported')}.textContent`), '', 'no export ran');
    await shot(ada, '08-chosen');
  });

  const BANNER_SAID = 'Is email export ready yet?';
  let bannerId;
  await step('missing: the pinned element is removed from the page, so Show reports it missing and reveals nothing', async () => {
    await pin(ada, q('email-exports-banner'));
    await annotateAndSave(ada, BANNER_SAID);
    bannerId = await idOf('ada', BANNER_SAID);
    await say(ada, `show ${bannerId}`);
    await replied(ada, `I offered to show ${bannerId}`);
    await ada.click(q('dismiss-banner'));
    await ada.until('the banner is gone', `!${q('beta-banner')}`, 5000);
    await pressShow(ada, bannerId);
    assert.equal(await ada.until('an outcome', `${offerCard(bannerId)}.dataset.outcome`, 10000), 'stale');
    assert.match(await ada.evaluate(`${offerCard(bannerId)}.innerText`), /not on this page/);
    assert.match(await ada.evaluate(`${offerCard(bannerId)}.querySelector('[data-testid=feedback-outcome]').title`), /Missing: Nothing on this page matches/);
    assert.deepEqual(await ada.evaluate(DRAWN), [], 'nothing revealed');
    await shot(ada, '09-missing');
  });

  await step('outside the page: the same conversation at /assistant offers Show as unavailable', async () => {
    produced.dom.push(await ada.evaluate(TRANSCRIPT));
    await ada.send('Page.navigate', { url: `${base}assistant` });
    await ada.until('the assistant page', `!!${q('assistant-page')} && !!${CHAT}`, 30000);
    await openChat(ada);
    await ada.until('the offer card', `!!${offerCard(saveId)}`, 15000);
    const card = await ada.evaluate(`({ outcome: ${offerCard(saveId)}.dataset.outcome, line: ${offerCard(saveId)}.querySelector('[data-testid=feedback-element]').tagName, text: ${offerCard(saveId)}.innerText })`);
    assert.equal(card.outcome, 'unavailable');
    assert.equal(card.line, 'SPAN', 'the element line is plain text outside the page');
    assert.match(card.text, /open the app page to see it/);
    await shot(ada, '10-outside');
    await goto(ada);
  });

  const bob = await launch(`${base}${BOB_ROUTE}`, { chromium, evidence });
  browsers.push(bob);
  await bob.until('Bob\'s page', `!!(${q('app-root')} && ${q('feedback-point')} && ${CHAT} && ${inChat('composer-input')})`, 30000);
  const ADA_NOTIFY = 'Notifications need a short explanation.';
  const BOB_EXPORTS = 'Exports should say which year they cover.';
  let notifyId;
  await step('two browsers: Ada and Bob save at the same moment, both are stored with their own authors', async () => {
    assert.equal(await bob.evaluate(`!!${q('app-root')}.querySelector('[data-feedback-canaries]')`), true);
    await pin(ada, `${q('notifications')}.querySelector('h2')`);
    await ada.type(q('feedback-note'), ADA_NOTIFY);
    await pin(bob, `${q('exports')}.querySelector('h2')`);
    await bob.type(q('feedback-note'), BOB_EXPORTS);
    await Promise.all([ada.click(q('feedback-save')), bob.click(q('feedback-save'))]);
    await Promise.all([ada.until('Ada saved', `${STATUS}.dataset.save === 'saved'`, 10000), bob.until('Bob saved', `${STATUS}.dataset.save === 'saved'`, 10000)]);
    await shot(bob, '11-bob-saved');
    await Promise.all([ada.click(q('feedback-close')), bob.click(q('feedback-close'))]);
    notifyId = await idOf('ada', ADA_NOTIFY);
    const bobsId = await idOf('bob', BOB_EXPORTS);
    assert.equal((await app.store.read(notifyId, app.people.ada.access)).report.author.display, 'Ada Fictional');
    assert.equal((await app.store.read(bobsId, app.people.bob.access)).report.author.display, 'Bob Fictional');
    summary.records.concurrent = { notifyId, bobsId };
  });

  await step('two browsers resolve the same item at once: one is applied, the other is shown a conflict', async () => {
    app.gateResolves(2);
    await Promise.all([say(ada, `resolve ${notifyId}`), say(bob, `resolve ${notifyId}`)]);
    const pattern = `(Resolved|Conflict on) ${notifyId}`;
    await Promise.all([replied(ada, pattern), replied(bob, pattern)]);
    const texts = [await ada.evaluate(TRANSCRIPT), await bob.evaluate(TRANSCRIPT)];
    const outcomes = texts.map(text => text.includes(`Conflict on ${notifyId}`) ? 'conflict' : text.includes(`Resolved ${notifyId}`) ? 'applied' : 'none');
    assert.deepEqual([...outcomes].sort(), ['applied', 'conflict'], `one applied and one conflict, got ${outcomes}`);
    const read = await app.store.read(notifyId, app.people.ada.access);
    assert.equal(read.report.status, 'addressed');
    assert.equal(read.report.resolutions.length, 1, 'the conflicting resolution wrote nothing');
    summary.records.conflict = outcomes;
    await shot(outcomes[0] === 'conflict' ? ada : bob, '12-conflict');
  });

  await step('revocation: once Bob\'s grant is revoked, Ada\'s items disappear from his list and his agent\'s', async () => {
    produced.dom.push(await bob.evaluate(TRANSCRIPT));
    app.revoke('bob');
    await goto(bob, BOB_ROUTE);
    await bob.click(q('feedback-open-list'));
    await bob.until('the list answered', `!!${q('feedback-panel')} && !${q('feedback-panel')}.innerText.includes(${JSON.stringify(ADA_NOTIFY)}) && document.querySelectorAll('[data-testid=feedback-panel] [data-testid=feedback-item]').length === 0`, 10000);
    await say(bob, 'check feedback');
    await replied(bob, 'No open feedback that you can see');
    const read = await fetch(new URL(`/api/feedback/${saveId}`, app.url), { headers: { authorization: `Bearer ${app.people.bob.token}` } }).then(response => response.json());
    assert.equal(read.kind, 'denied');
    await ada.click(q('feedback-open-list'));
    await ada.until('Ada still sees her item', `${q('feedback-panel')}?.innerText.includes(${JSON.stringify(EXPORT_SAID)})`, 10000);
    produced.dom.push(await bob.evaluate(TRANSCRIPT), await bob.evaluate(`${q('feedback-panel')}.innerText`), await ada.evaluate(`${q('feedback-panel')}.innerText`));
    await shot(bob, '13-revoked');
  });

  await step('canary kit over everything the journey produced: copies, stored reports, list outputs, tool results and chat DOM', async () => {
    for (const person of ['ada', 'bob']) {
      produced.toolResults.push(...await app.messages(person));
      const listed = await fetch(new URL('/api/feedback', app.url), { headers: { authorization: `Bearer ${app.people[person].token}` } }).then(response => response.json());
      produced.lists.push(listed);
    }
    app.grant('bob');
    for (const id of [saveId, exportId, bannerId, notifyId, summary.records.concurrent.bobsId]) {
      const read = await app.store.read(id, app.people.ada.access);
      assert.equal(read.kind, 'available');
      const bytes = serializeFeedback(read.report);
      assert.equal(parseFeedback(bytes).ok, true);
      produced.reports.push(new TextDecoder().decode(bytes));
    }
    produced.dom.push(await ada.evaluate(`[...document.querySelectorAll('[data-feedback-overlay]')].map(host => host.shadowRoot?.textContent ?? '').join('\\n')`));
    // In the page: finish the kit planted at load with what the page shows.
    await ada.evaluate(`window.__feedbackCanaries.finish(${JSON.stringify(produced.dom)})`);
    const inPage = await ada.until('the in-page canary result', `window.__feedbackCanaryResult`, 5000);
    assert.deepEqual(inPage.hits, [], 'no canary in the page outputs');
    // In Node: the same kit and tokens over every output, including what never reached a page.
    const window = new Window({ url: 'https://fictional.invalid/' });
    try {
      const result = await runPrivacyCanaries({ page: { document: window.document }, run: (_context, emit) => { for (const [label, output] of Object.entries(produced)) emit(label, output); } });
      assert.deepEqual(result.hits, [], 'no canary in any journey output');
      assert.ok(result.scanned > 200, `the scan covered the outputs (${result.scanned} strings)`);
      // A control: the same scan finds a planted token when one does leak.
      const control = await runPrivacyCanaries({ page: { document: window.document }, run: () => ({ leaked: `x ${tokens['input-value']} y` }) });
      assert.equal(control.ok, false);
      summary.records.canaries = { scanned: result.scanned, inPageScanned: inPage.scanned, channels: result.channels.length };
    } finally { await window.happyDOM.close(); }
  });

  for (const browser of browsers) assert.deepEqual(browser.problems.filter(problem => !/favicon|ERR_|Failed to load resource/.test(problem)), [], 'no page errors');
  summary.result = 'pass';
  console.log(`PASS: ${steps.length} steps; screenshots in ${evidence}`);
} catch (error) {
  summary.result = 'fail';
  summary.error = String(error?.stack ?? error);
  for (const [index, browser] of browsers.entries()) await browser.screenshot(`e2e-failure-${index}.png`).catch(() => {});
  process.exitCode = 1;
  console.error(error);
} finally {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(join(evidence, 'journey.json'), JSON.stringify(summary, null, 2));
  for (const browser of browsers) await browser.close();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
