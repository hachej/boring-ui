// Artifacts: the agent writes a file and presents it; the file becomes a card in the chat and opens by itself in a panel beside it (resizable, full screen,
// closable), with the file's versions. Markdown, an interactive HTML page that draws an SVG with D3, an SVG image, and revisions.
import assert from 'node:assert/strict';
import { artifactKit, REPORT_PROMPT, REVISE_PROMPT } from './_artifacts.mjs';
import { call, latestArtifact, writeAndPresent, REPORT_PATH, REPORT_TURNS, REVISE_TURNS } from './_script.mjs';

const TIME = /\d{1,2}:\d{2}:\d{2}/;

export default [
  {
    id: 'artifact-markdown', smoke: true, group: 'Artifacts', requires: ['workspace'], title: 'Write a report as a document',
    description: 'A short report becomes a card, not a wall of text; the card opens the rendered document beside the chat.',
    steps: [{ prompt: REPORT_PROMPT }],
    script: { 0: REPORT_TURNS },
    expect: [{ toolCalled: 'present' }, { artifact: { type: 'markdown', count: 1 } }, { panelOpen: true }],
    async verify(t) {
      const { browser, q, qa, shots } = t;
      const kit = artifactKit(t);
      const [report] = await kit.cards();
      assert.equal(report.label, 'Document');
      const reply = await t.assistantText();
      assert.ok(reply.length < 700, `the reply stays short, got ${reply.length} characters`);
      // Claude's behaviour: the agent made an artifact, so the panel opened by itself, full height beside the chat, and the card says it is the open one.
      await browser.until('the panel opened by itself with the rendered document', `!!${q(kit.PANEL)} && ${kit.editorText}.length > 200`, 20000);
      assert.equal(await browser.evaluate(`${q(kit.PANEL)}.dataset.follow`), 'true', 'the newest card opens the latest');
      assert.equal(await browser.evaluate(`${q('[data-testid=studio-main]')}.getBoundingClientRect().height - ${q(kit.SIDE)}.getBoundingClientRect().height < 4`), true, 'the panel takes the full height');
      assert.equal(await browser.evaluate(`${q(`${kit.CARDS}[data-open=true] [data-testid=artifact-hint]`)}?.textContent`), 'Viewing', 'the card shows that it is the open artifact');
      assert.ok((await kit.rect('[data-testid=workspace-chat]')).w >= 330, 'the chat narrowed but stays usable');
      // Rendered headings, not source: unless the model wrote Markdown the rich editor could not keep exactly, which stays in source with a notice.
      assert.equal(await browser.evaluate(`!!${q(`${kit.PANEL} [role=textbox] h1, ${kit.PANEL} [role=textbox] h2`)} || !!${q(`${kit.PANEL} [data-testid=markdown-source-only]`)}`), true, 'rendered headings, or source with the notice');
      assert.equal(await browser.evaluate(`${q('[data-testid=artifact-panel-title]')}.textContent`), report.title);
      await shots('artifacts-panel');
      void qa;
    },
  },
  {
    id: 'artifact-interactive-html', group: 'Artifacts', requires: ['workspace'], title: 'Draw a chart with D3 in an interactive page',
    description: 'An HTML artifact runs in a sandboxed frame: it loads D3 from an allowed CDN and draws an SVG chart.',
    steps: [{ prompt: 'Make an interactive HTML page that loads d3 from cdn.jsdelivr.net with an exact pinned version and draws a small bar chart of five invented trail lengths as an SVG (rectangles, with labels). Write it to a file and present it. One short sentence for the reply.' }],
    // Plain DOM instead of a CDN library: the scripted layer needs no network. (Loading D3 from the real CDN is left to a manual real-model run.)
    script: { 0: [...writeAndPresent('pages/trail-lengths.html', `<!doctype html><html><body><h1>Trail lengths</h1><div id="chart"></div><script>
const lengths = [['Pier loop', 4], ['Cove path', 7], ['Ridge walk', 9], ['Tram line', 6], ['Inn round', 5]];
const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '360'); svg.setAttribute('height', '220');
lengths.forEach(([name, km], at) => {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); rect.setAttribute('x', String(10 + at * 70)); rect.setAttribute('y', String(200 - km * 18)); rect.setAttribute('width', '56'); rect.setAttribute('height', String(km * 18)); rect.setAttribute('fill', 'steelblue'); svg.append(rect);
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text'); label.setAttribute('x', String(10 + at * 70)); label.setAttribute('y', '215'); label.setAttribute('font-size', '10'); label.textContent = name; svg.append(label);
});
document.getElementById('chart').append(svg);
</script></body></html>`), 'The chart is ready.'] },
    expect: [{ toolCalled: 'present' }, { artifact: { type: 'html', count: 1, frameHas: 'svg rect' } }],
    async verify(t) {
      const { browser, q } = t;
      const kit = artifactKit(t);
      // The preview is the running page in a frame without allow-same-origin, so the page cannot reach the studio and the studio's alert-free sandbox holds.
      assert.equal(await browser.evaluate(`${q(`${kit.PANEL} iframe`)}.getAttribute('sandbox')`), 'allow-scripts');
      assert.equal(await browser.evaluate(`${q(`${kit.PANEL} iframe`)}.hasAttribute('src')`), false);
      await t.shots('artifacts-d3');
    },
  },
  {
    id: 'artifact-html-and-svg', group: 'Artifacts', requires: ['workspace'], title: 'An HTML page and an SVG logo', description: 'Two more cards with the right labels and viewers; the page runs sandboxed, the SVG is only ever an image.',
    steps: [{ prompt: 'Make two things: a small HTML page for the fictional Placeholder Trails club (a heading, a short list, and include a <script>alert(1)</script> element), and a simple SVG logo for the club with a viewBox. Write each to its own file and present both before you reply. One short sentence for the reply.' }],
    script: { 0: [
      ...writeAndPresent('pages/club.html', '<!doctype html><html><body><h1>Placeholder Trails</h1><ul><li>Sunday walks</li><li>Tea at the pier</li></ul><script>alert(1)</script></body></html>'),
      ...writeAndPresent('pages/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="seagreen"/><path d="M20 70 L50 25 L80 70 Z" fill="white"/></svg>'),
      'Both are ready.',
    ] },
    expect: [{ artifact: { type: 'html', count: 1 } }, { artifact: { type: 'svg', count: 1 } }, { toolCalls: { name: 'present', min: 2 } }],
    async verify(t) {
      const { browser, q, qa, shots } = t;
      const kit = artifactKit(t);
      const all = await kit.cards();
      const page = all.find(c => c.type === 'html'), logo = all.find(c => c.type === 'svg');
      // The panel opened by itself on the newest thing the agent made.
      await browser.until('auto-opened on the newest artifact', `${q(kit.PANEL)}?.dataset.artifactId === ${JSON.stringify(all.at(-1).id)}`, 10000);
      assert.equal(page.label, 'HTML page'); assert.equal(logo.label, 'SVG image');
      await browser.click(kit.cardWhere(page.id, 1));
      await browser.until('html frame', `!!${q(`${kit.PANEL}[data-artifact-type=html] iframe`)}`);
      // The studio's preview runs the page in a sandboxed frame without allow-same-origin; its alert(1) cannot open a dialog. Source is the only other mode.
      assert.equal(await browser.evaluate(`${q(`${kit.PANEL} iframe`)}.getAttribute('sandbox')`), 'allow-scripts');
      assert.equal(await browser.evaluate(`${q(`${kit.PANEL} iframe`)}.hasAttribute('src')`), false);
      assert.equal(await browser.evaluate(`${qa(`${kit.PANEL} [data-testid=artifact-controls] [role=group] button`)}.map(b => b.getAttribute('aria-label')).join()`), 'HTML preview,HTML source');
      assert.equal(await browser.evaluate(`!/omits active content/.test(${q(kit.PANEL)}.innerText)`), true, 'no passive-preview notice in the interactive preview');
      await shots('artifacts-html');
      await browser.click(kit.cardWhere(logo.id, 1));
      await browser.until('svg image', `!!${q(`${kit.PANEL}[data-artifact-type=svg] img[data-testid=artifact-svg]`)}`);
      assert.equal(await browser.evaluate(`${q(`${kit.PANEL} img[data-testid=artifact-svg]`)}.tagName`), 'IMG');
      assert.equal(await browser.evaluate(`!${q(`${kit.PANEL} img[data-testid=artifact-svg]`)}.parentElement.querySelector('svg')`), true, 'the SVG is never injected as markup');
      assert.match(await browser.evaluate(`${q(`${kit.PANEL} img[data-testid=artifact-svg]`)}.src`), /^blob:/);
      await browser.until('the image decodes', `${q(`${kit.PANEL} img[data-testid=artifact-svg]`)}.naturalWidth > 0`, 5000);
      await browser.click(`${q(`${kit.PANEL} [data-testid=artifact-mode][data-mode=source]`)}`);
      await browser.until('svg source', `/<svg/.test(${q(`${kit.PANEL} pre`)}?.textContent ?? '')`);
      await browser.click(`${q(`${kit.PANEL} [data-testid=artifact-mode][data-mode=preview]`)}`);
      await shots('artifacts-svg');
    },
  },
  {
    id: 'artifact-versions', group: 'Artifacts', requires: ['workspace'], title: 'Revise an artifact: versions, layout and your own edits',
    description: 'A revision is a second saved version of the same file; the switcher lists both by save time; the panel resizes, goes full screen and keeps your edit.',
    steps: [{ prompt: REPORT_PROMPT }, { prompt: REVISE_PROMPT }],
    script: { 0: REPORT_TURNS, 1: REVISE_TURNS, 'final section titled "Packing"': [
      // The person closes the panel while the agent works: the model takes a moment, like a real one.
      ctx => call('read', { path: latestArtifact(ctx).target.resource.path }, { delay: 3000 }),
      call('edit', { path: REPORT_PATH, edits: [{ oldText: 'HUMAN-EDIT-MARKER: bring a thermos.', newText: 'HUMAN-EDIT-MARKER: bring a thermos.\n\n## Packing\n\n- Boots\n- Water' }] }),
      call('present', { path: REPORT_PATH }),
      'Added the packing section.',
    ] },
    expect: [{ toolCalled: 'edit' }, { artifact: { type: 'markdown', count: 2 } }],
    async verify(t) {
      const { browser, q, qa, button, idle, pause, shots } = t;
      const kit = artifactKit(t);
      const { PANEL, SIDE, CARDS, cardWhere, openCard, editorText, rect } = kit;
      const [report] = await kit.cards();

      // ---- Panel layout: drag and keyboard resize with limits, remembered width, full screen and back (button and Escape), close.
      await openCard(report.id, 2, `!!${q(PANEL)} && ${editorText}.length > 100`, 'the report is open');
      // A pixel of rounding is fine: the page may be a fraction of a pixel wider on another host.
      const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 1, `${message}: ${actual} vs ${expected}`);
      const divider = '[data-testid=workspace-divider]';
      const width = async () => (await rect(SIDE)).w;
      const start = await width();
      // Drag the divider to the left with a real mouse: the panel gets wider and the chat narrower.
      const d = await rect(divider);
      const y = d.y + 200, x = d.x + d.w / 2;
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      for (const step of [20, 60, 100]) await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - step, y, button: 'left', buttons: 1 });
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x - 100, y, button: 'left', buttons: 0, clickCount: 1 });
      await pause(200);
      const dragged = await width();
      assert.ok(dragged >= start + 80 || dragged >= (await rect('[data-testid=studio-main]')).w - 345, `dragging left widened the panel: ${start} -> ${dragged}`);
      // Keyboard: arrows move by 24px, Shift by 96px, Home and End jump to the limits (the chat keeps at least 340px, the panel at least 360px).
      await browser.evaluate(`${q(divider)}.focus()`);
      const before = await width();
      await browser.press('ArrowRight');
      await pause(100);
      near(await width(), before - 24, 'ArrowRight narrows the panel by 24px');
      assert.ok(Math.abs(Number(await browser.evaluate(`${q(divider)}.getAttribute('aria-valuenow')`)) - (before - 24)) <= 1, 'the divider reports the width');
      await browser.press('End'); await pause(100);
      near(await width(), 360, 'End: minimum width');
      await browser.press('Home'); await pause(100);
      assert.ok((await rect('[data-testid=workspace-chat]')).w >= 339, 'Home: maximum width leaves the chat 340px');
      assert.equal(await browser.evaluate(`${q(divider)}.getAttribute('role')`), 'separator');
      // Choose a width, reload: the panel comes back at the same width (kept for the session).
      for (let i = 0; i < 4; i++) await browser.press('ArrowRight');
      const chosen = await width();
      await t.reload();
      await browser.until('panel restored', `!!${q(PANEL)} && ${editorText}.length > 100`);
      await pause(500);
      near(await width(), chosen, 'the width is remembered for the session');
      await browser.evaluate(`${q(divider)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await pause(200);
      near(await width(), 640, 'double click restores the default width (the limits permitting)');
      // Full screen: the panel takes the whole window, the chat is hidden and inert; the person's document is the same one.
      const revision = await browser.evaluate(`${q('[data-testid=document]')}.dataset.revision`);
      await browser.click(q('[data-testid=artifact-fullscreen]'));
      await browser.until('full screen', `${q(SIDE)}.dataset.fullscreen === 'true'`, 3000);
      await pause(300);
      const full = await rect(SIDE);
      assert.deepEqual([full.w, full.h], await browser.evaluate(`[innerWidth, innerHeight]`), 'the panel covers the whole window');
      assert.equal(await browser.evaluate(`${q('[data-testid=workspace-chat]')}.hasAttribute('inert')`), true, 'the chat is hidden from input');
      assert.equal(await browser.evaluate(`${q('[data-testid=artifact-fullscreen]')}.getAttribute('aria-label')`), 'Exit full screen');
      assert.equal(await browser.evaluate(`${q('[data-testid=document]')}.dataset.revision`), revision, 'the same document is shown');
      await shots('artifacts-fullscreen');
      await browser.press('Escape');
      await browser.until('Escape leaves full screen', `${q(SIDE)}.dataset.fullscreen === 'false'`, 3000);
      await browser.click(q('[data-testid=artifact-fullscreen]'));
      await browser.until('full screen again', `${q(SIDE)}.dataset.fullscreen === 'true'`, 3000);
      await browser.click(q('[data-testid=artifact-fullscreen]'));
      await browser.until('the exit button leaves full screen', `${q(SIDE)}.dataset.fullscreen === 'false' && !${q('[data-testid=workspace-chat]')}.hasAttribute('inert')`, 3000);
      // Close, then open again from the card: the panel slides back in.
      await browser.click(q('[data-testid=artifact-close]'));
      await browser.until('closed', `!${q(PANEL)} && !${q(SIDE)}`, 3000);
      assert.ok((await rect('[data-testid=workspace-chat]')).w > 900, 'the chat has the whole width again');
      assert.equal(await browser.evaluate(`!${q(`${CARDS}[data-open=true]`)}`), true, 'no card claims to be open');
      await openCard(report.id, 2, `!!${q(PANEL)} && ${editorText}.length > 100`, 'reopened from the card');
      await pause(400);
      assert.equal(await browser.evaluate(`${q(`${CARDS}[data-open=true] [data-testid=artifact-hint]`)}?.textContent`), 'Viewing');

      // ---- Versions: the switcher lists both and old cards pin their version.
      assert.equal((await kit.cards()).filter(c => c.id === report.id).length, 2, 'one card per message for the same artifact');
      await browser.click(cardWhere(report.id, 2));
      await browser.until('latest shows the revision', `/Safety notes/i.test(${editorText}) && ${q(PANEL)}.dataset.follow === 'true'`);
      // The history menu: an icon button with a tooltip, newest first, the latest marked and the one on display checked.
      const bar = `${PANEL} [data-testid=artifact-bar]`;
      const items = () => browser.evaluate(`${qa(`${PANEL} [data-testid=artifact-versions-item]`)}.map(i => [i.children[1].textContent, i.children[2]?.textContent ?? '', i.getAttribute('aria-checked')])`);
      const trigger = `${PANEL} [data-testid=artifact-versions]`;
      assert.deepEqual(await browser.evaluate(`({ label: ${q(trigger)}.getAttribute('aria-label'), title: ${q(trigger)}.title, text: ${q(trigger)}.textContent.trim(), popup: ${q(trigger)}.getAttribute('aria-haspopup') })`), { label: 'Version history', title: 'Version history', text: '', popup: 'menu' });
      await browser.click(q(trigger));
      await browser.until('history menu', `!!${q(`${PANEL} [role=menu]`)}`, 3000);
      // Versions are named by when they were saved (a clock time), never by a number; the newest carries the "Latest" marker.
      const shape = list => list.map(([label, marker, checked]) => [TIME.test(label) && !/^Version/.test(label), marker, checked]);
      assert.deepEqual(shape(await items()), [[true, 'Latest', 'true'], [true, '', 'false']]);
      await browser.press('Escape');
      await browser.until('Escape closes the history menu', `!${q(`${PANEL} [role=menu]`)} && document.activeElement === ${q(trigger)}`, 3000);
      // The whole bar is one row at the panel's width.
      const row = await browser.evaluate(`(() => { const b = ${q(bar)}.getBoundingClientRect(); const mids = ${qa(`${bar} button`)}.filter(x => x.checkVisibility()).map(x => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; });
        return { bar: Math.round(b.height), spread: Math.round(Math.max(...mids) - Math.min(...mids)), buttons: mids.length }; })()`);
      assert.ok(row.bar <= 60 && row.spread <= 6 && row.buttons >= 4, `the artifact bar is a single row ${JSON.stringify(row)}`);
      await shots('artifacts-versions');
      await browser.click(cardWhere(report.id, 1));
      await browser.until('pinned version 1', `${q(PANEL)}.dataset.follow === 'false' && ${q(PANEL)}.dataset.artifactPosition === '1' && ${editorText}.length > 100`);
      assert.equal(await browser.evaluate(`${q('[data-testid=artifact-readonly]')}?.textContent`), 'Read-only', 'an older version is labelled read-only in the subtitle');
      assert.equal(await browser.evaluate(`!/Safety notes/i.test(${editorText})`), true, 'version 1 has the original text');
      assert.equal(await browser.evaluate(`${q(`${PANEL} [role=textbox]`)}.getAttribute('contenteditable')`), 'false');
      await shots('artifacts-pinned');
      await browser.click(q(trigger));
      await browser.until('history menu on a pinned version', `!!${q(`${PANEL} [role=menu]`)}`, 3000);
      assert.deepEqual(shape(await items()), [[true, 'Latest', 'false'], [true, '', 'true']]);
      await browser.press('ArrowDown'); await browser.press('Enter');
      await browser.until('keyboard: the first item (latest) was chosen', `${q(PANEL)}.dataset.follow === 'true' && /Safety notes/i.test(${editorText})`, 10000);
      await browser.click(q(trigger));
      await browser.until('history menu again', `!!${q(`${PANEL} [role=menu]`)}`, 3000);
      await browser.click(`${qa(`${PANEL} [data-testid=artifact-versions-item]`)}.at(-1)`);
      await browser.until('choosing the oldest version pins it', `${q(PANEL)}.dataset.follow === 'false' && ${q(PANEL)}.dataset.artifactPosition === '1' && !/Safety notes/i.test(${editorText})`, 10000);
      await browser.click(cardWhere(report.id, 2));
      await browser.until('latest again', `${q(PANEL)}.dataset.follow === 'true' && /Safety notes/i.test(${editorText})`);

      // ---- The person edits the document in the panel; the agent keeps the edit in its next update.
      await browser.click(button('Markdown source'));
      const SOURCE = `document.querySelector('${PANEL} textarea')`;
      await browser.until('source editor', `!!${SOURCE}`);
      await browser.type(SOURCE, '\n\nHUMAN-EDIT-MARKER: bring a thermos.\n');
      await browser.click(button('Save'));
      await browser.until('saved', `!${button('Save')}`);
      assert.match(await kit.stored(report.id), /HUMAN-EDIT-MARKER/);
      await t.say('Add a short final section titled "Packing" to the trail report. Keep everything else. One short sentence for the reply.');
      // The person closes the panel while the agent works: the new version does not open it again during this turn.
      await browser.until('the agent is working', `${t.SUBMIT}?.dataset.state === 'stop'`, 30000);
      await browser.click(q('[data-testid=artifact-close]'));
      await browser.until('version 3 card', `!!${cardWhere(report.id, 3)} && ${idle}`, 240000);
      await pause(500);
      assert.equal(await browser.evaluate(`!${q(PANEL)}`), true, 'closed during the turn: the panel stays closed');
      const text = await kit.stored(report.id);
      assert.match(text, /HUMAN-EDIT-MARKER/, 'the agent read before updating and kept the person\'s edit');
      assert.match(text, /Packing/);
      assert.match(text, /Safety notes/i);

      // ---- A reload keeps the open artifact and version; closing returns to the normal layout.
      await openCard(report.id, 1, `${q(PANEL)}?.dataset.follow === 'false' && ${q(PANEL)}.dataset.artifactPosition === '1'`, 'pinned version 1');
      await t.reload();
      await browser.until('panel restored', `${q(PANEL)}?.dataset.artifactPosition === '1' && ${q(PANEL)}.dataset.follow === 'false' && ${editorText}.length > 100`);
      await browser.until('the open card is marked', `${q(`${CARDS}[data-open=true]`)}?.dataset.artifactRevision === ${JSON.stringify(report.revision)}`, 10000);
      await openCard(report.id, 3, `${q(PANEL)}?.dataset.follow === 'true'`, 'latest');
      await t.reload();
      await browser.until('latest restored', `${q(PANEL)}?.dataset.follow === 'true' && /Packing/.test(${editorText})`);
      await browser.click(q('[data-testid=artifact-close]'));
      await browser.until('closed', `!${q(PANEL)} && !${q(SIDE)}`);
      await t.reload();
      await browser.until('stays closed', `!${q(PANEL)}`);
    },
  },
];
