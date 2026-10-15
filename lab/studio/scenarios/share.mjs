// Share links: Share copies a link that names the variant, the conversation and the thing open (an artifact version, the latest, the
// notes, a workspace file). Opening it in a fresh browser (no session state at all) and in the tab the person is on shows the same thing.
import assert from 'node:assert/strict';
import { VIEWER_FILES } from '../fixtures/workspace-files.mjs';
import { launch } from '@hachej/boring-testing/browser';
import { artifactKit, REPORT_PROMPT, REVISE_PROMPT } from './_artifacts.mjs';
import { viewerKit } from './_viewers.mjs';
import { NOTES_PROMPT, REPORT_TURNS, REVISE_TURNS, SAVE_NOTES_TURNS } from './_script.mjs';

/** Clicks a Share button and returns what the browser really copied (an insecure page: the execCommand fallback). */
async function copyLink(t, shareButton) {
  await t.browser.evaluate(`(() => { window.__copied = undefined; if (!window.__copyWatch) { window.__copyWatch = true; document.addEventListener('copy', () => { const a = document.activeElement; window.__copied = String(getSelection()) || (a && 'value' in a ? a.value.slice(a.selectionStart, a.selectionEnd) : ''); }, true); } return true; })()`);
  await t.browser.click(shareButton);
  await t.browser.until('link copied', `typeof window.__copied === 'string'`);
  return t.browser.evaluate(`window.__copied`);
}
// A browser with an empty profile. A deployment that needs a token takes it from the link's fragment, which it removes at once (`t.linkSuffix`).
const inFreshBrowser = async (t, link, check) => {
  const fresh = await launch(`${link}${t.linkSuffix ?? ''}`, { evidence: process.env.STUDIO_EVIDENCE ?? '.cache/evidence/studio' });
  try { await check(fresh); } finally { await fresh.close(); }
};

export default [
  {
    id: 'share-artifact-link', group: 'Share links', requires: ['workspace'], title: 'Share an artifact version', description: 'A link to a pinned version, and one to the latest, open the same conversation, presented file and version elsewhere.',
    script: { 0: REPORT_TURNS, 1: REVISE_TURNS },
    steps: [{ prompt: REPORT_PROMPT }, { prompt: REVISE_PROMPT }],
    async verify(t) {
      const { browser, q } = t;
      const kit = artifactKit(t);
      const { PANEL, openCard, editorText } = kit;
      const [report] = await kit.cards();
      const conversation = await browser.evaluate(`${q('[data-testid=studio-main]')}.dataset.conversation`);
      for (const [version, follow, marker] of [[1, 'false', /^(?!.*Safety notes)/is], [2, 'true', /Safety notes/]]) {
        await openCard(report.id, version, `${q(PANEL)}?.dataset.follow === ${JSON.stringify(follow)} && ${editorText}.length > 100`, `version ${version}`);
        const link = await copyLink(t, q('[data-testid=artifact-share]'));
        const url = new URL(link);
        assert.equal(url.origin, new URL(t.pageUrl).origin, 'the link uses the origin the person is on');
        assert.deepEqual([url.searchParams.get('variant'), url.searchParams.get('conversation'), url.searchParams.get('artifact'), url.searchParams.get('version')], [t.variantId(), conversation, report.id, follow === 'true' ? 'latest' : report.revision]);
        const opened = on => `!!${on}('[data-testid=artifact-panel]') && ${on}('[data-testid=artifact-panel]').dataset.artifactId === ${JSON.stringify(report.id)} && ${on}('[data-testid=artifact-panel]').dataset.follow === ${JSON.stringify(follow)} && ${on}('[data-testid=artifact-panel]').dataset.artifactRevision === ${JSON.stringify(follow === 'true' ? undefined : report.revision)} && ${on}('[data-testid=artifact-panel] [role=textbox]')?.innerText.length > 100`;
        await inFreshBrowser(t, link, async other => {
          await other.until(`fresh browser shows version ${version}`, opened('document.querySelector'), 40000);
          assert.equal(await other.evaluate(`document.querySelector('[data-testid=studio-main]').dataset.conversation`), conversation, 'the same conversation');
          assert.match(await other.evaluate(`document.querySelector('[data-testid=artifact-panel] [role=textbox]').innerText`), marker);
        });
        await browser.click(q('[data-testid=artifact-close]'));
        await browser.until('closed', `!${q(PANEL)}`);
        await browser.send('Page.navigate', { url: link });
        await browser.until(`this tab shows version ${version}`, opened('document.querySelector'), 40000);
      }
    },
  },
  {
    id: 'share-notes-link', group: 'Share links', requires: ['notes'], title: 'Share the shared document', description: 'A link from the shared document opens the same variant and conversation, with the document in the panel.',
    script: { 0: SAVE_NOTES_TURNS },
    steps: [{ prompt: NOTES_PROMPT }],
    async verify(t) {
      const { browser, q } = t;
      const conversation = await browser.evaluate(`${q('[data-testid=studio-main]')}.dataset.conversation`);
      await browser.until('the shared document with Share', `!!${q('[data-testid=workspace-panel] [data-testid=document]')} && !!${q('[data-testid=workspace-panel] [data-testid=artifact-share]')}`, 30000);
      const link = await copyLink(t, q('[data-testid=workspace-panel] [data-testid=artifact-share]'));
      assert.equal(new URL(link).origin, new URL(t.pageUrl).origin, 'the link uses the origin the person is on');
      assert.equal(new URL(link).searchParams.get('conversation'), conversation, 'the link names the conversation');
      await inFreshBrowser(t, link, async fresh => {
        await fresh.until('the shared document opened', `!!document.querySelector('[data-testid=workspace-panel] [data-testid=document]')`, 30000);
        assert.equal(await fresh.evaluate(`document.querySelector('[data-testid=studio-main]').dataset.conversation`), conversation);
      });
      // This tab, showing something else: the link wins.
      await t.fresh();
      await browser.send('Page.navigate', { url: link });
      await browser.until('the shared document in the same tab', `${q('[data-testid=studio-main]')}.dataset.conversation === ${JSON.stringify(conversation)} && !!${q('[data-testid=workspace-panel] [data-testid=document]')}`, 30000);
    },
  },
  {
    id: 'share-file-link', group: 'Share links', title: 'Share a workspace file', requires: ['workspace'], seed: VIEWER_FILES, panel: 'files', steps: [{ action: 'openPanel' }],
    description: 'Share copies a link; opening it shows the same file, the link wins over what the tab shows, and a refused copy falls back to a selected link.',
    async verify(t) {
      const { browser, q } = t;
      const k = viewerKit(t);
      const { VIEWER, openFile, watchCopies, editorText } = k;
      const conversation = await browser.evaluate(`${q('[data-testid=studio-main]')}.dataset.conversation`);
      const scope = VIEWER('media/moon-badge.png');
      // Share pressed while the viewer is still reading the file: the loading frame is replaced by the image pane's own when the bytes
      // arrive, so a Share there copied the link but its "Link copied" went with the old frame (the person got no feedback). The read is
      // held to show that frame for as long as the check takes: it offers no Share, and the frame that does stays.
      await k.toList();
      await browser.evaluate(`(() => { if (!window.__holdReads) { const real = window.fetch; window.__holdReads = { on: true, held: [] };
        window.fetch = (...args) => window.__holdReads.on && String(args[0]?.url ?? args[0]).includes('/api/resources') ? new Promise(resolve => window.__holdReads.held.push(() => resolve(real(...args)))) : real(...args); }
        window.__holdReads.on = true; return true; })()`);
      await browser.click(`[...document.querySelectorAll('.studio-panel li button')].find(b => b.textContent === 'media/moon-badge.png')`);
      await browser.until('the image viewer, still reading the file', `window.__holdReads.held.length > 0 && !!${q(`${scope} [data-testid=file-title]`)}`, 15000);
      assert.equal(await browser.evaluate(`!!${q(`${scope} [data-testid=viewer-share]`)}`), false, 'a viewer still reading its file offers no Share');
      await browser.evaluate(`(() => { window.__holdReads.on = false; window.__holdReads.held.splice(0).forEach(release => release()); return true; })()`);
      await browser.until('the image shown', `${q(`${scope} [data-testid=viewer-image]`)}?.naturalWidth > 0`, 15000);
      await watchCopies();
      // The notice disappears after a few seconds; record it when it appears instead of hoping to see it later on a loaded machine.
      await browser.evaluate(`(() => { window.__notices = []; new MutationObserver(() => { for (const node of document.querySelectorAll('[data-testid=viewer-notice]')) if (!window.__notices.includes(node.textContent)) window.__notices.push(node.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true }); })()`);
      // A viewer may re-render while it loads, so a click that landed on a replaced button is repeated (as the artifact cards do).
      for (let attempt = 1; ; attempt++) {
        await browser.click(q(`${scope} [data-testid=viewer-share]`));
        try { await browser.until('link copied', `typeof window.__copied === 'string'`, 5000); break; } catch (error) { if (attempt === 3) throw error; }
      }
      const link = await browser.evaluate(`window.__copied`);
      const url = new URL(link);
      assert.equal(url.searchParams.get('variant'), t.variantId());
      assert.equal(url.searchParams.get('file'), '/workspace/media/moon-badge.png');
      assert.equal(url.searchParams.get('conversation'), conversation, 'a file link names the conversation');
      assert.equal(url.origin, new URL(t.pageUrl).origin, 'the link uses the origin the person is on');
      await browser.until('the Link copied notice was shown', `window.__notices.includes('Link copied')`, 5000);
      // A different file is open when the link is loaded: the link wins.
      await openFile('docs/tide-times.html', 'html');
      await browser.send('Page.navigate', { url: link });
      await browser.until('the linked file', `${q(`${VIEWER('media/moon-badge.png')}[data-kind=image] [data-testid=viewer-image]`)}?.naturalWidth === 96`, 30000);
      assert.equal(await browser.evaluate(`location.search`), '', 'the link is removed from the address bar once opened');
      // The same for a Markdown file; Copy puts its text on the clipboard.
      await openFile('docs/picnic-plan.md', 'markdown');
      await watchCopies();
      await browser.click(q(`${VIEWER('docs/picnic-plan.md')} [data-testid=viewer-share]`));
      await browser.until('markdown link', `typeof window.__copied === 'string'`);
      const markdownLink = await browser.evaluate(`window.__copied`);
      await t.menu(VIEWER('docs/picnic-plan.md'), 'viewer', 'copy');
      await browser.until('document text copied', `String(window.__copied).includes('Moon picnic plan')`);
      // When the browser refuses even the execCommand copy, the link is shown selected for a manual copy: never a bare "Could not share".
      await browser.evaluate(`(() => { document.execCommand = () => false; return true; })()`);
      await browser.click(q(`${VIEWER('docs/picnic-plan.md')} [data-testid=viewer-share]`));
      await browser.until('manual copy popover', `!!${q(`${VIEWER('docs/picnic-plan.md')} [data-testid=viewer-manual-copy-text]`)}`);
      assert.equal(await browser.evaluate(`(() => { const f = ${q(`${VIEWER('docs/picnic-plan.md')} [data-testid=viewer-manual-copy-text]`)}; return f.value.slice(f.selectionStart, f.selectionEnd); })()`), markdownLink, 'the link is shown selected');
      assert.doesNotMatch(await browser.evaluate(`${q(`${VIEWER('docs/picnic-plan.md')} [data-testid=viewer-bar]`)}.innerText`), /Could not share/);
      await browser.send('Page.navigate', { url: markdownLink });
      await browser.until('the linked document', `${editorText('docs/picnic-plan.md')}.includes('Moon picnic plan')`, 30000);
      // A second browser with an empty profile, opened straight on the link someone shared.
      await inFreshBrowser(t, markdownLink, async fresh => {
        await fresh.until('the shared file', `document.querySelector('[data-testid=file-viewer][data-path="/workspace/docs/picnic-plan.md"] [role=textbox]')?.innerText.includes('Moon picnic plan')`, 30000);
        assert.equal(await fresh.evaluate(`document.querySelector('[data-testid=studio-main]').dataset.conversation`), conversation, 'the same conversation');
        assert.equal(await fresh.evaluate(`document.querySelector('.studio').dataset.variant`), t.variantId());
      });
    },
  },
];
