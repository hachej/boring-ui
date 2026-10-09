// Helpers for the document and file viewer scenarios (not a scenario: files starting with `_` are skipped by the loader).
// No model is used by those scenarios: files are written through the server side (the variant's own execution environment) to prove
// a viewer follows a change made behind its back.
import assert from 'node:assert/strict';

export function viewerKit(t) {
  const { browser, q, qa } = t;
  const variant = () => t.app.host.variants.get(t.variantId());
  const ok = result => { if (!result.ok) throw result.error; return result.value; };
  // The workspace is `/workspace/<path>` in the browser; the variant's environment keeps it under its own root.
  const REAL = rel => `${variant().root}/${rel}`;
  const FILE = rel => `/workspace/${rel}`;
  const readText = async rel => ok(await variant().env.readTextFile(REAL(rel), t.app.host.context));
  const readBytes = async rel => ok(await variant().env.readBinaryFile(REAL(rel), t.app.host.context));
  const write = async (rel, content) => {
    ok(await variant().env.createDir(REAL(rel).replace(/\/[^/]*$/, ''), { recursive: true }, t.app.host.context));
    return ok(await variant().env.writeFile(REAL(rel), content, t.app.host.context));
  };
  const remove = async rel => ok(await variant().env.remove(REAL(rel), {}, t.app.host.context));
  const VIEWER = rel => `[data-testid=file-viewer][data-path="${FILE(rel)}"]`;
  // The Files tab is the list in the workspace panel; an open file replaces it until the bar's back button returns.
  const LISTED = `document.querySelector('.studio-panel li button')`;
  const toList = async () => {
    if (await browser.evaluate(`!!${LISTED}`)) return;
    if (!await browser.evaluate(`!!${t.WORKSPACE}`)) await t.openPanel();
    else if (await browser.evaluate(`!!document.querySelector('[data-testid=file-back]')`)) await browser.click(`document.querySelector('[data-testid=file-back]')`);
    await browser.until('the file list', `!!${LISTED}`, 15000);
  };
  const openFile = async (rel, kind) => {
    await toList();
    await browser.click(`[...document.querySelectorAll('.studio-panel li button')].find(b => b.textContent === ${JSON.stringify(rel)})`);
    await browser.until(`${rel} viewer`, `${q(`${VIEWER(rel)}[data-kind=${kind}] [data-testid=viewer-more]`)} !== null`);
  };
  const noOverflow = async label => {
    const sizes = await browser.evaluate(`({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })`);
    assert.ok(sizes.scroll <= sizes.inner, `${label}: horizontal overflow ${JSON.stringify(sizes)}`);
  };
  // The standard actions every viewer shows, whatever else it adds.
  const standardBar = async (scope, label, prefix = 'viewer') => {
    // The bar renders its controls as the viewer loads: wait for each instead of asserting at once (the blocking layer allows no retry).
    for (const id of ['more', 'share']) await browser.until(`${label} has ${id}`, `!!${q(`${scope} [data-testid=${prefix}-${id}]`)}`, 10000);
    assert.equal(await browser.evaluate(`${q(`${scope} [data-testid=${prefix}-more]`)}.getAttribute('aria-label')`), 'More actions');
    assert.equal(await browser.evaluate(`${q(`${scope} [data-testid=${prefix}-share]`)}.getAttribute('aria-label')`), 'Share');
  };
  // The caret at the very start of the rich document, as a person puts it there: a click on the left edge of its first character.
  // Ready means the editor's own selection agrees, not only the browser's caret: after a focus or a click ProseMirror writes its selection
  // back to the page a moment later (a freshly loaded document holds it at the end), and on a busy machine that write can land after the
  // caret moved, putting it back at the end. Every Markdown file these scenarios edit starts with a level-1 title, so the toolbar's
  // Heading 1 state (computed from the editor's selection) is that signal.
  const caretAtStart = async scope => {
    const point = await browser.evaluate(`(() => { const box = ${q(`${scope} [role=textbox]`)}; box.firstElementChild.scrollIntoView({ block: 'nearest' });
      const text = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, { acceptNode: node => node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP }).nextNode();
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1); const r = range.getBoundingClientRect();
      return { x: r.left + 1, y: r.top + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    await browser.until('the caret at the start', `(() => { const box = ${q(`${scope} [role=textbox]`)}, s = getSelection();
      if (!box || !s.rangeCount || !s.isCollapsed || !box.contains(s.anchorNode)) return false;
      const before = document.createRange(); before.selectNodeContents(box); before.setEnd(s.anchorNode, s.anchorOffset);
      return before.toString() === '' && ${q(`${scope} [aria-label="Heading 1"]`)}?.getAttribute('aria-pressed') === 'true'; })()`, 5000);
  };
  const editorText = rel => `(${q(`${VIEWER(rel)} [role=textbox]`)}?.innerText ?? '')`;
  // Real copying, no stubs: the page is an insecure context (no navigator.clipboard or navigator.share), so Share and Copy take the
  // execCommand fallback. A capture-phase `copy` listener records what was selected when the browser performed it.
  const watchCopies = () => browser.evaluate(`(() => { window.__copied = undefined; if (!window.__copyWatch) { window.__copyWatch = true;
    document.addEventListener('copy', () => { const a = document.activeElement; window.__copied = String(getSelection()) || (a && 'value' in a ? a.value.slice(a.selectionStart, a.selectionEnd) : ''); }, true); } return true; })()`);
  const link = rel => `${t.pageUrl}?variant=${t.variantId()}&file=${encodeURIComponent(FILE(rel))}`;
  return { variant, REAL, FILE, readText, readBytes, write, remove, VIEWER, toList, openFile, noOverflow, standardBar, caretAtStart, editorText, watchCopies, link, qa };
}
