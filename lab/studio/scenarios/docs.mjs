// Documents and files: the standard viewer bar and the document viewers in the Files tab: Markdown (rich editing that cannot destroy what
// it cannot represent), HTML, image, PDF, each with Refresh and Share. No model is used: files are written through the server side to prove
// a viewer follows a change made behind its back. Screenshots in light and dark are the evidence (fileviewers-*).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { briefPdf, moonBadgePng, solidPng } from '../fixtures/media.mjs';
import { INTERACTIVE_PAGE } from '../fixtures/interactive-page.mjs';
import { VIEWER_FILES } from '../fixtures/workspace-files.mjs';
import { viewerKit } from './_viewers.mjs';

const common = { group: 'Documents and files', requires: ['workspace'], seed: VIEWER_FILES, panel: 'files', steps: [{ action: 'openPanel' }] };

export default [
  {
    ...common, id: 'docs-markdown-editing', title: 'Edit a Markdown file',
    description: 'Rich editing keeps tables, links and task lists byte for byte; unsafe Markdown stays source; Refresh never drops your edits.',
    async verify(t) {
      const { browser, q, shots } = t;
      const k = viewerKit(t);
      const { VIEWER, FILE, openFile, editorText, caretAtStart, standardBar, readText, write, remove } = k;
      await browser.until('file list', `${k.qa('.studio-panel li button')}.length >= 6`);
      for (const rel of Object.keys(VIEWER_FILES)) assert.equal(await browser.evaluate(`${k.qa('.studio-panel li button')}.some(b => b.textContent === ${JSON.stringify(rel)})`), true, `${rel} is seeded`);

      // A Markdown file opens in the editor, in the standard bar, with an icon toolbar and active states.
      await openFile('docs/picnic-plan.md', 'markdown');
      await browser.until('the rendered document', `${editorText('docs/picnic-plan.md')}.includes('Moon picnic plan') && !!${q(`${VIEWER('docs/picnic-plan.md')} table`)}`);
      let scope = VIEWER('docs/picnic-plan.md');
      await standardBar(scope, 'Markdown');
      assert.equal(await browser.evaluate(`${q(`${scope} [data-testid=file-title]`)}.textContent`), 'picnic-plan.md');
      const tools = await browser.evaluate(`${k.qa(`${scope} [role=toolbar] button`)}.map(b => ({ label: b.getAttribute('aria-label'), icon: !!b.querySelector('svg'), text: b.textContent.trim() }))`);
      assert.ok(tools.length >= 14, `a formatting toolbar: ${tools.length} buttons`);
      assert.deepEqual(tools.filter(tool => !tool.label || !tool.icon || tool.text), [], 'every toolbar button is an icon with an accessible name');
      // The caret in the heading: Bold becomes active (a stored mark) and a second press clears it. Nothing is typed.
      await caretAtStart(scope);
      await browser.until('Heading 1 is active', `${q(`${scope} [aria-label="Heading 1"]`)}?.getAttribute('aria-pressed') === 'true'`);
      await browser.click(q(`${scope} [aria-label=Bold]`));
      await browser.until('Bold is active', `${q(`${scope} [aria-label=Bold]`)}?.getAttribute('aria-pressed') === 'true'`);
      await shots('fileviewers-markdown');
      await browser.click(q(`${scope} [aria-label=Bold]`));
      await browser.until('Bold is off again', `${q(`${scope} [aria-label=Bold]`)}?.getAttribute('aria-pressed') === 'false'`);
      assert.equal(await browser.evaluate(`!${q(`${scope} [data-testid=viewer-status]`)}`), true, 'toggling formatting twice leaves the document clean (no status shown)');

      // A rich-mode edit and Save keep the tables (a padded one and an unpadded aligned one with code, emphasis, an escaped pipe and an
      // empty cell), link, image line and task list in the saved file.
      const original = await readText('docs/picnic-plan.md');
      await caretAtStart(scope);
      await browser.send('Input.insertText', { text: 'EDITED ' });
      await browser.until('unsaved', `${q(`${scope} [data-testid=viewer-status]`)}?.textContent === 'Unsaved'`);
      await browser.click(q(`${scope} [data-testid=viewer-save]`));
      await browser.until('saved', `${q(`${scope} [data-testid=viewer-status]`)}?.textContent === undefined`);
      const after = await readText('docs/picnic-plan.md');
      assert.ok(after.includes('# EDITED Moon picnic plan'), `the edit reached the workspace file: ${JSON.stringify(after.slice(0, 200))}`);
      assert.equal(after.replace('EDITED ', ''), original, 'everything but the edited text is byte for byte unchanged');
      for (const kept of ['| Item     | Quantity |', '| Blankets | 2        |', '|Tide|Time|Height|\n|:--|:-:|--:|\n|Low|`19:40`|*0.4 m*|', '![Moon badge](../media/moon-badge.png)', '[tide table](tide-times.html)', '- [x] Pick the pier', '- [ ] Pack the star map']) assert.ok(after.includes(kept), `kept: ${kept}`);

      // A document with raw HTML, a footnote and front matter opens in source mode with rich editing disabled, and a source edit leaves them untouched.
      await openFile('docs/legacy-notes.md', 'markdown');
      scope = VIEWER('docs/legacy-notes.md');
      await browser.until('the notice', `!!${q(`${scope} [data-testid=markdown-source-only]`)}`);
      assert.equal(await browser.evaluate(`${q(`${scope} [data-testid=viewer-mode-rich]`)}.disabled`), true, 'rich editing is disabled');
      assert.equal(await browser.evaluate(`${q(`${scope} [data-testid=viewer-mode-source]`)}.getAttribute('aria-pressed')`), 'true');
      assert.equal(await browser.evaluate(`!${q(`${scope} [role=toolbar]`)}`), true, 'no formatting toolbar without rich mode');
      await shots('fileviewers-markdown-source-only');
      const legacy = await readText('docs/legacy-notes.md');
      await browser.type(`${q(`${scope} textarea`)}`, '\nAn unrelated source edit.\n');
      await browser.click(q(`${scope} [data-testid=viewer-save]`));
      await browser.until('saved', `${q(`${scope} [data-testid=viewer-status]`)}?.textContent === undefined`);
      assert.equal(await readText('docs/legacy-notes.md'), `${legacy}\nAn unrelated source edit.\n`);

      // Refresh never drops unsaved edits and shows that the file changed elsewhere.
      await openFile('docs/picnic-plan.md', 'markdown');
      scope = VIEWER('docs/picnic-plan.md');
      await browser.until('document', `${editorText('docs/picnic-plan.md')}.includes('EDITED Moon picnic plan')`);
      await caretAtStart(scope);
      await browser.send('Input.insertText', { text: 'LOCAL-UNSAVED ' });
      await browser.until('dirty', `${q(`${scope} [data-testid=viewer-status]`)}?.textContent === 'Unsaved'`);
      await write('docs/picnic-plan.md', `${await readText('docs/picnic-plan.md')}\nAdded behind the editor.\n`);
      await t.menu(scope, 'viewer', 'refresh');
      await browser.until('conflict shown', `${q(`${scope} [data-testid=viewer-status]`)}?.textContent === 'Changed elsewhere'`);
      assert.ok((await browser.evaluate(editorText('docs/picnic-plan.md'))).includes('LOCAL-UNSAVED'), 'the unsaved edit is still there');
      await shots('fileviewers-markdown-conflict');
      await browser.click(`[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(b => /discard/i.test(b.textContent + b.getAttribute('aria-label')))`);
      await browser.until('the file as written elsewhere', `${editorText('docs/picnic-plan.md')}.includes('Added behind the editor') && !${editorText('docs/picnic-plan.md')}.includes('LOCAL-UNSAVED')`);

      // An agent write behind an open editor: Save is refused as stale and writes nothing, the draft stays, then the person reloads and saves.
      await openFile('docs/picnic-plan.md', 'markdown');
      scope = VIEWER('docs/picnic-plan.md');
      await browser.until('document', `${editorText('docs/picnic-plan.md')}.includes('Added behind the editor')`);
      await caretAtStart(scope);
      await browser.send('Input.insertText', { text: 'STALE-DRAFT ' });
      await browser.until('dirty', `${q(`${scope} [data-testid=viewer-status]`)}?.textContent === 'Unsaved'`);
      const agentWrote = `${await readText('docs/picnic-plan.md')}\nWritten by the agent while the editor was open.\n`;
      await write('docs/picnic-plan.md', agentWrote);
      await browser.click(q(`${scope} [data-testid=viewer-save]`));
      await browser.until('the save is refused as stale', `${q(scope)}.innerText.includes('Publication precondition failed') && ${q(scope)}.innerText.includes('Your local text has been kept.')`);
      assert.equal(await readText('docs/picnic-plan.md'), agentWrote, 'the refused save wrote nothing over the agent');
      assert.ok((await browser.evaluate(editorText('docs/picnic-plan.md'))).includes('STALE-DRAFT'), 'the draft is still in the editor');
      await browser.click(`[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(b => /discard/i.test(b.textContent + b.getAttribute('aria-label')))`);
      await browser.until('the editor reloaded the agent\'s file', `${editorText('docs/picnic-plan.md')}.includes('Written by the agent while') && !${editorText('docs/picnic-plan.md')}.includes('STALE-DRAFT')`);
      await caretAtStart(scope);
      await browser.send('Input.insertText', { text: 'RETRIED ' });
      await browser.until('dirty again', `${q(`${scope} [data-testid=viewer-status]`)}?.textContent === 'Unsaved'`);
      await browser.click(q(`${scope} [data-testid=viewer-save]`));
      await browser.until('saved after the reload', `${q(`${scope} [data-testid=viewer-status]`)}?.textContent === undefined`);
      const retried = await readText('docs/picnic-plan.md');
      assert.ok(retried.includes('RETRIED') && retried.includes('Written by the agent while the editor was open.'), 'the retry saved the person\'s text on top of the agent\'s');

      // Refresh after the file is deleted behind the editor keeps the text and shows that it changed, instead of emptying the editor.
      await openFile('docs/picnic-plan.md', 'markdown');
      scope = VIEWER('docs/picnic-plan.md');
      const kept = await readText('docs/picnic-plan.md');
      await browser.until('document', `${editorText('docs/picnic-plan.md')}.includes('Added behind the editor')`);
      await remove('docs/picnic-plan.md');
      await t.menu(scope, 'viewer', 'refresh');
      await browser.until('missing remote shown', `${q(`${scope} [data-testid=viewer-status]`)}?.textContent === 'Changed elsewhere'`);
      assert.ok((await browser.evaluate(editorText('docs/picnic-plan.md'))).includes('Added behind the editor'), 'the text is still in the editor');
      await write('docs/picnic-plan.md', kept);
      await t.menu(scope, 'viewer', 'refresh');
      await browser.until('saved again', `${q(`${scope} [data-testid=viewer-status]`)}?.textContent === undefined`);
      void FILE;
    },
  },
  {
    ...common, id: 'docs-html-image-pdf', title: 'Open HTML, images and a PDF',
    description: 'Each file opens in its own viewer under the same bar; Refresh follows a change made behind it; an SVG is only ever an image.',
    async verify(t) {
      const { browser, q, shots } = t;
      const k = viewerKit(t);
      const { VIEWER, openFile, toList, standardBar, write } = k;
      const qa = k.qa;
      // HTML opens in the HTML viewer with preview and source, and Refresh follows a change made behind it.
      await openFile('docs/tide-times.html', 'html');
      let scope = VIEWER('docs/tide-times.html');
      await standardBar(scope, 'HTML');
      await browser.until('preview', `!!${q(`${scope} iframe`)}`);
      assert.equal(await browser.evaluate(`${q(`${scope} iframe`)}.hasAttribute('sandbox') || ${q(`${scope} iframe`)}.srcdoc !== undefined`), true);
      await shots('fileviewers-html');
      await browser.click(q(`${scope} [data-testid=viewer-mode-source]`));
      await browser.until('source', `/<table/.test(${q(`${scope} textarea`)}?.value ?? '')`);
      await shots('fileviewers-html-source');
      await write('docs/tide-times.html', '<h1>Fictional tide times, revised</h1>\n<p>Low tide at the placeholder pier.</p>\n');
      await t.menu(scope, 'viewer', 'refresh');
      await browser.until('refreshed source', `/revised/.test(${q(`${scope} textarea`)}?.value ?? '')`);

      // An image opens in the image viewer, fits first, zooms, and an SVG is only ever an img.
      await openFile('media/moon-badge.png', 'image');
      scope = VIEWER('media/moon-badge.png');
      await browser.until('decoded', `${q(`${scope} [data-testid=viewer-image]`)}?.naturalWidth === 96`);
      await standardBar(scope, 'Image');
      const subtitle = await browser.evaluate(`${q(`${scope} [data-testid=viewer-subtitle]`)}.textContent`);
      assert.match(subtitle, /PNG/); assert.match(subtitle, /96 × 96/); assert.match(subtitle, /KB|B/);
      const width = () => browser.evaluate(`${q(`${scope} [data-testid=viewer-image]`)}.getBoundingClientRect().width`);
      const fitted = await width();
      await browser.click(q(`${scope} [data-testid=viewer-zoom-in]`));
      await browser.until('zoomed in', `${q(`${scope} [data-testid=viewer-image]`)}.getBoundingClientRect().width > ${fitted + 1}`);
      const zoomed = await width();
      assert.ok(zoomed > fitted, `zoom changes the rendered size (${fitted} -> ${zoomed})`);
      await shots('fileviewers-image-zoomed');
      await t.menu(scope, 'viewer', 'zoom-fit');
      await browser.until('fit again', `Math.abs(${q(`${scope} [data-testid=viewer-image]`)}.getBoundingClientRect().width - ${fitted}) < 1`);
      await shots('fileviewers-image');
      await openFile('media/orbit.svg', 'image');
      const svg = VIEWER('media/orbit.svg');
      await browser.until('svg decoded', `${q(`${svg} [data-testid=viewer-image]`)}?.naturalWidth > 0`);
      assert.equal(await browser.evaluate(`${q(`${svg} [data-testid=viewer-image]`)}.tagName`), 'IMG');
      assert.match(await browser.evaluate(`${q(`${svg} [data-testid=viewer-image]`)}.src`), /^blob:/);
      assert.equal(await browser.evaluate(`!${q(`${svg} [data-testid=viewer-stage]`)}.querySelector('svg')`), true, 'the SVG is never injected as markup');
      await shots('fileviewers-svg');

      // Refresh shows a file replaced behind the viewer without reloading the page.
      await write('media/refresh-test.png', moonBadgePng());
      await toList();
      await browser.until('listed', `${qa('.studio-panel li button')}.some(b => b.textContent === 'media/refresh-test.png')`);
      await openFile('media/refresh-test.png', 'image');
      scope = VIEWER('media/refresh-test.png');
      await browser.until('first image', `${q(`${scope} [data-testid=viewer-image]`)}?.naturalWidth === 96`);
      await browser.evaluate(`window.__samePage = 'yes'`);
      await write('media/refresh-test.png', new Uint8Array(solidPng(64, [200, 40, 40])));
      await t.menu(scope, 'viewer', 'refresh');
      await browser.until('the new image', `${q(`${scope} [data-testid=viewer-image]`)}?.naturalWidth === 64`);
      assert.equal(await browser.evaluate(`window.__samePage`), 'yes');

      // A PDF opens in the PDF viewer, inline where the browser can, otherwise with a working Download.
      await openFile('media/moon-brief.pdf', 'pdf');
      scope = VIEWER('media/moon-brief.pdf');
      await browser.until('pdf stage', `['inline', 'fallback'].includes(${q(`${scope} [data-testid=viewer-stage]`)}?.dataset.pdf)`);
      await standardBar(scope, 'PDF');
      const mode = await browser.evaluate(`${q(`${scope} [data-testid=viewer-stage]`)}.dataset.pdf`);
      console.log(`    pdf viewer in headless Chromium: ${mode} (pdfViewerEnabled=${await browser.evaluate('navigator.pdfViewerEnabled')})`);
      if (mode === 'inline') assert.equal(await browser.evaluate(`!!${q(`${scope} iframe`)}`), true);
      else {
        assert.equal(await browser.evaluate(`!!${q(`${scope} [data-testid=viewer-pdf-fallback]`)}`), true);
        // A real click on the fallback's Download: the viewer offers the bytes as a file named like the PDF.
        await browser.evaluate(`(() => { window.__downloads = []; const click = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push({ name: this.download, href: this.href }); else click.call(this); }; return true; })()`);
        await browser.click(q(`${scope} [data-testid=viewer-pdf-download]`));
        await browser.until('download offered', `window.__downloads.length === 1`);
        const offered = await browser.evaluate(`(async () => { const { name, href } = window.__downloads[0]; const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
          return { name, size: bytes.length, head: String.fromCharCode(...bytes.slice(0, 5)) }; })()`);
        assert.deepEqual(offered, { name: 'moon-brief.pdf', size: briefPdf().length, head: '%PDF-' });
      }
      await shots('fileviewers-pdf');
      // Refresh re-reads the file: a longer PDF changes the size shown in the subtitle.
      const before = await browser.evaluate(`${q(`${scope} [data-testid=viewer-subtitle]`)}.textContent`);
      await write('media/moon-brief.pdf', new Uint8Array(Buffer.concat([Buffer.from(briefPdf()), Buffer.from('% '.repeat(1500))])));
      await t.menu(scope, 'viewer', 'refresh');
      await browser.until('new size', `${q(`${scope} [data-testid=viewer-subtitle]`)}.textContent !== ${JSON.stringify(before)}`);
      await write('media/moon-brief.pdf', briefPdf());
    },
  },
  {
    ...common, id: 'docs-interactive-html', title: 'Run an HTML page in the sandbox',
    description: 'The interactive preview runs the page in a sandboxed frame: opaque origin, a CSP, no network, no storage, no popups.',
    async verify(t) {
      const { browser, q, shots, pause } = t;
      const k = viewerKit(t);
      const { VIEWER, openFile, toList, write } = k;
      await write('docs/orbit-demo.html', INTERACTIVE_PAGE);
      await toList();
      await browser.until('orbit listed', `${k.qa('.studio-panel li button')}.some(b => b.textContent === 'docs/orbit-demo.html')`, 15000);
      await openFile('docs/orbit-demo.html', 'html');
      const scope = VIEWER('docs/orbit-demo.html');
      await browser.until('the preview frame', `!!${q(`${scope} iframe`)}`, 15000);
      assert.equal(await browser.evaluate(`${q(`${scope} iframe`)}.getAttribute('sandbox')`), 'allow-scripts', 'the preview is the running page');
      assert.equal(await browser.evaluate(`${k.qa(`${scope} [data-testid=viewer-controls] [role=group] button`)}.map(b => b.getAttribute('aria-label')).join()`), 'HTML preview,HTML source', 'Preview | Source is the only mode switch');
      assert.equal(await browser.evaluate(`!/omits active content/.test(${q(scope)}.innerText)`), true);
      await browser.evaluate(`(() => { window.__frames = []; if (!window.__frameWatch) { window.__frameWatch = true; window.addEventListener('message', event => { if (event.data && event.data.source === 'orbit-demo') window.__frames.push({ ...event.data, eventOrigin: event.origin }); }); } return true; })()`);
      await t.menu(scope, 'viewer', 'refresh');
      await browser.until('the page reported', `window.__frames.length >= 1`, 15000);
      const report = await browser.evaluate(`window.__frames[0]`);
      assert.equal(report.ran, true, 'the inline script ran');
      assert.equal(report.circles, 3, 'it drew its SVG circles');
      assert.equal(report.title, 'orbit-ran', 'and set document.title');
      assert.equal(report.origin, 'null', 'opaque origin');
      assert.equal(report.eventOrigin, 'null');
      assert.match(report.fetch, /^blocked:/, 'fetch to a non-allow-listed origin fails');
      assert.match(report.storage, /^blocked:SecurityError/, 'no storage');
      assert.match(report.cookie, /^blocked:SecurityError/, 'no cookies');
      assert.match(report.parent, /^blocked:/, 'no access to the studio page');
      assert.match(report.script, /^blocked:/, 'a script from a non-allow-listed origin does not load');
      assert.match(report.popup, /^blocked:/, 'no popups');
      const frame = await browser.evaluate(`(() => { const f = ${q(`${scope} [data-testid=viewer-run-frame]`)}; return { sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow'), referrer: f.getAttribute('referrerpolicy'), src: f.getAttribute('src'), srcdoc: f.srcdoc.slice(0, 700) }; })()`);
      assert.equal(frame.sandbox, 'allow-scripts', 'allow-scripts only: no allow-same-origin, top navigation, popups, forms');
      assert.equal(frame.allow, ''); assert.equal(frame.referrer, 'no-referrer'); assert.equal(frame.src, null);
      assert.match(frame.srcdoc, /^<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https:\/\/cdnjs\.cloudflare\.com https:\/\/cdn\.jsdelivr\.net; style-src 'unsafe-inline' https:\/\/cdnjs\.cloudflare\.com https:\/\/cdn\.jsdelivr\.net; img-src data: blob:; font-src data: https:\/\/cdnjs\.cloudflare\.com https:\/\/cdn\.jsdelivr\.net; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">/);
      // Reload runs the page again from the start.
      await browser.evaluate(`window.__frames.length = 0`);
      await t.menu(scope, 'viewer', 'refresh');
      await browser.until('reported again after Reload', `window.__frames.length >= 1`, 15000);
      await pause(400);
      await shots('fileviewers-run');
      await browser.click(q(`${scope} [data-testid=viewer-mode-source]`));
      await browser.until('source', `!!${q(`${scope} textarea`)}`);
    },
  },
  {
    ...common, id: 'docs-viewer-bar', title: 'The viewer bar at any width',
    description: 'One row at 1280 px and at the default panel width; an icon-only mode toggle with tooltips; the status as a dot.',
    async verify(t) {
      const { browser, q, shots, pause } = t;
      const k = viewerKit(t);
      const { VIEWER, openFile } = k;
      const oneRow = async (label, rel) => {
        const row = await browser.evaluate(`(() => { const bar = document.querySelector(${JSON.stringify(`${VIEWER(rel)} [data-testid=viewer-bar]`)}); const b = bar.getBoundingClientRect();
          const centres = [...bar.querySelectorAll('button')].filter(x => x.checkVisibility()).map(x => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; });
          return { bar: Math.round(b.height), spread: Math.round(Math.max(...centres) - Math.min(...centres)), buttons: centres.length }; })()`);
        assert.ok(row.bar <= 60 && row.spread <= 6 && row.buttons >= 3, `${label}: one row of controls ${JSON.stringify(row)}`);
      };
      for (const [width, label] of [[1280, '1280px'], [0, 'default width']]) {
        if (width) await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
        else await browser.send('Emulation.clearDeviceMetricsOverride');
        await pause(300);
        for (const [rel, kind] of [['docs/picnic-plan.md', 'markdown'], ['docs/tide-times.html', 'html'], ['media/moon-badge.png', 'image'], ['media/moon-brief.pdf', 'pdf']]) {
          // Opened by link: at 1280px the file list gives way to the viewer.
          await browser.send('Page.navigate', { url: k.link(rel) });
          await browser.until(`${rel} viewer`, `${q(`${VIEWER(rel)}[data-kind=${kind}] [data-testid=viewer-bar]`)} !== null`, 30000);
          await pause(600);
          await oneRow(`${label} ${rel}`, rel);
        }
      }
      await t.reload();
      await openFile('docs/picnic-plan.md', 'markdown');
      const scope = VIEWER('docs/picnic-plan.md');
      await browser.until('the mode toggle', `${k.qa(`${scope} [data-testid=viewer-controls] [role=group] button`)}.length === 2`, 10000);
      const toggles = await browser.evaluate(`${k.qa(`${scope} [data-testid=viewer-controls] [role=group] button`)}.map(b => ({ label: b.getAttribute('aria-label'), title: b.title, text: b.textContent.trim() }))`);
      assert.deepEqual(toggles, [{ label: 'Rich text', title: 'Rich text', text: '' }, { label: 'Markdown source', title: 'Markdown source', text: '' }]);
      assert.equal(await browser.evaluate(`!${q(`${scope} [data-testid=viewer-status]`)}`), true, 'a clean document shows no status');
      await shots('fileviewers-bar-markdown');
      await openFile('docs/tide-times.html', 'html');
      await shots('fileviewers-bar-html');
      await openFile('media/moon-badge.png', 'image');
      await shots('fileviewers-bar-image');
    },
  },
  {
    ...common, id: 'docs-uploads-restart', title: 'Uploads survive a restart',
    description: 'An image and a PDF attached in the chat are kept in the workspace across a full server restart and still open.',
    async verify(t) {
      const { browser, q, pause } = t;
      const k = viewerKit(t);
      const { VIEWER, openFile, toList, readBytes } = k;
      const fixtures = resolve('.cache/evidence/fileviewers/fixtures'); mkdirSync(fixtures, { recursive: true });
      const png = `${fixtures}/fv-swatch.png`, pdf = `${fixtures}/fv-note.pdf`;
      writeFileSync(png, solidPng(48, [20, 90, 200])); writeFileSync(pdf, briefPdf());
      for (const [file, rel] of [[png, 'uploads/fv-swatch.png'], [pdf, 'uploads/fv-note.pdf']]) {
        await browser.attachFiles(q('[data-testid=composer-file]'), [file]);
        await toList();
        await browser.until(`${rel} listed`, `${k.qa('.studio-panel li button')}.some(b => b.textContent === ${JSON.stringify(rel)})`, 15000);
      }
      const before = await readBytes('uploads/fv-swatch.png');
      await t.restartHost();
      await t.reload();
      assert.deepEqual(Buffer.from(await readBytes('uploads/fv-swatch.png')), Buffer.from(before), 'the bytes are intact after the restart');
      assert.equal(Buffer.from(await readBytes('uploads/fv-note.pdf')).subarray(0, 5).toString(), '%PDF-');
      await toList();
      await browser.until('file list again', `${k.qa('.studio-panel li button')}.some(b => b.textContent === 'uploads/fv-swatch.png')`, 20000);
      await openFile('uploads/fv-swatch.png', 'image');
      await browser.until('uploaded image opens', `${q(`${VIEWER('uploads/fv-swatch.png')} [data-testid=viewer-image]`)}?.naturalWidth === 48`, 15000);
      await openFile('uploads/fv-note.pdf', 'pdf');
      await browser.until('uploaded pdf opens', `!!${q(`${VIEWER('uploads/fv-note.pdf')} [data-testid=viewer-stage][data-pdf]`)}`, 15000);
      await openFile('media/moon-badge.png', 'image');
      await browser.until('seeded image survived too', `${q(`${VIEWER('media/moon-badge.png')} [data-testid=viewer-image]`)}?.naturalWidth === 96`, 15000);
      void pause;
    },
  },
];
