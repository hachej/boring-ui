// Real-browser journey for the documents item (`?documents=1` of ./page.tsx), fictional content only, scripted model, no key.
// At 390x844 with touch: the « Fiches » tab shows the Library (the file list); choosing the product sheet opens its viewer; its
// Revisions list the three saves; the oldest opens read-only; the product manager's « Voir la fiche » opens DocumentSheet over the app;
// Back closes that sheet and leaves the layer; « Toutes les fiches » closes it and shows the Fiches screen. At 1280x800 the Library, the
// file and its Revisions sit side by side (the list 20rem, the revisions beside the viewer), and the same sheet opens from the layer.
// Every control is at least 44x44px on the phone, nothing overflows horizontally, and the page has no console errors. Screenshots go to
// .cache/evidence/documents/ (APP_EVIDENCE overrides).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pause, q } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/documents';
mkdirSync(evidence, { recursive: true });
const FILE = 'fiche-produit.md';
const SHEET = '[data-testid=document-sheet]';
const noOverflow = `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`;

const directory = mkdtempSync(join(tmpdir(), 'boring-documents-'));
const app = await startAppShell({ directory });
let browser;
try {
  browser = await launch(`${app.url}?documents=1`, { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const { send } = browser;
  const emulate = (width, height, mobile) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) });
  /** A finger tap at the element's centre (the element must be on screen). */
  const tap = async selector => {
    await browser.until(`on screen ${selector}`, `(() => { const r = ${q(selector)}?.getBoundingClientRect(); return !!r && r.width > 0 && r.bottom > 0 && r.top < innerHeight; })()`);
    const r = await browser.evaluate(`(() => { const r = ${q(selector)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await touch('touchStart', [[r.x, r.y]]); await touch('touchEnd', []);
  };
  const live = () => browser.until('the chats are live', `!!${q('[data-testid=agent-trigger]')} || !!${q('[data-testid=nav-user]')}`, 30000);
  const small = async where => {
    const found = await browser.evaluate(`(() => { const out = []; const sel = '[data-testid=screen-fiches] button, [data-testid=screen-fiches] [role=treeitem] button, [data-testid=document-sheet] button, [data-testid=tabbar] [role=tab], [data-testid=agent-layer-action-spec]';
      for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); if (!r.width || e.closest('[hidden]') || r.bottom < 0 || r.top > innerHeight) continue;
        if (r.width < 43.5 || r.height < 43.5) out.push((e.dataset.testid || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); } return out; })()`);
    assert.deepEqual(found, [], `${where}: controls under 44px`);
    assert.ok(await browser.evaluate(noOverflow), `${where}: horizontal overflow`);
  };
  /** The product manager's sheet: the account menu, then « Améliorer l’app ». */
  const openImprove = async () => {
    await tap('[data-testid=account-button]');
    await browser.until('the account sheet', `!!${q('[data-testid=account-improve]')}`);
    await pause(500);
    await tap('[data-testid=account-improve]');
    await browser.until('the product manager', `!!${q('[data-testid=agent-layer-action-spec]')}`, 15000);
  };
  const revisionRows = `[...document.querySelectorAll('[data-testid=revision-item]')].map(row => row.dataset.revision)`;

  // 390x844, touch.
  await emulate(390, 844, true);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await browser.send('Page.reload', {});
  await browser.until('the Fiches tab', `!!${q('[data-testid=tab-fiches]')}`, 30000);
  await live();
  await tap('[data-testid=tab-fiches]');
  await browser.until('the Library lists the file', `!!${q(`[role=treeitem][data-path="${FILE}"] button`)}`, 15000);
  await browser.screenshot('phone-library.png');
  await small('phone Library');
  await tap(`[role=treeitem][data-path="${FILE}"] button`);
  await browser.until('the file opens', `!!${q(`[data-testid=file-viewer][data-path="${FILE}"]`)}`, 15000);
  await browser.until('three revisions', `${revisionRows}.length === 3`, 15000);
  const rows = await browser.evaluate(revisionRows);
  assert.equal(rows.length, 3, 'one row per save');
  assert.ok(rows.every(Boolean), 'each row names its revision');
  await tap(`[data-testid=revision-item][data-revision="${rows[2]}"]`);
  await browser.until('the old revision on show', `!!${q(`[data-testid=artifact-panel][data-artifact-revision="${rows[2]}"]`)}`, 15000);
  assert.match(await browser.evaluate(`${q('[data-testid=artifact-panel]')}.textContent`), /Lecture seule|Read-only/, 'the old revision is read-only');
  await browser.until('its own bytes', `/Brouillon initial/.test(${q('[data-testid=artifact-body]')}?.textContent ?? '')`, 15000);
  await browser.screenshot('phone-revision.png');
  await small('phone Revisions');
  // The product manager's « Voir la fiche » opens the sheet over the app; Back closes the sheet and keeps the layer.
  await openImprove();
  // The drawer slides in first: the action is tapped once it is on screen and the slide has settled.
  await browser.until('the action on screen', `(() => { const r = ${q('[data-testid=agent-layer-action-spec]')}?.getBoundingClientRect(); return !!r && r.bottom <= innerHeight; })()`, 15000);
  await pause(700);
  await tap('[data-testid=agent-layer-action-spec]');
  await browser.until('the sheet opens', `!!${q(`${SHEET} [data-testid=file-viewer][data-path="${FILE}"]`)}`, 15000);
  await pause(800);
  await browser.screenshot('phone-sheet.png');
  await small('phone DocumentSheet');
  await browser.evaluate('history.back()');
  await browser.until('Back closes the sheet', `!${q(SHEET)}`, 15000);
  // One layer at a time: the sheet took the layer's place, and Back returns to the page without reopening the layer.
  assert.equal(await browser.evaluate(`${q('[data-testid=agent-layer]')}?.dataset.state ?? null`), null, 'the product manager stays closed');
  // « Toutes les fiches » closes the sheet and shows the Fiches screen.
  await openImprove();
  await browser.until('the action on screen again', `(() => { const r = ${q('[data-testid=agent-layer-action-spec]')}?.getBoundingClientRect(); return !!r && r.bottom <= innerHeight; })()`, 15000);
  await pause(700);
  await tap('[data-testid=agent-layer-action-spec]');
  await browser.until('the sheet again', `!!${q(SHEET)}`, 15000);
  await pause(700);
  await tap('[data-testid=document-sheet-all]');
  await browser.until('the sheet closes', `!${q(SHEET)}`, 15000);
  assert.equal(await browser.evaluate('location.hash'), '#fiches', 'the Fiches screen shows');

  // 1280x800: the same document, the Library beside it, the sheet from the product manager in the dock. On a wide screen the account is
  // the sidebar's NavUser (no header avatar). The Library row and the sheet's action are DOM clicks: the harness's hit test finds the
  // sidebar's menu button over them, which the screenshot does not show.
  const treeItem = `[role=treeitem][data-path="${FILE}"] button`;
  await emulate(1280, 800, false);
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await browser.send('Page.reload', {});
  await browser.until('the Fiches screen', `!!${q('[data-testid=screen-fiches]')}`, 30000);
  await live();
  await browser.until('the Library lists the file', `!!${q(`[role=treeitem][data-path="${FILE}"] button`)}`, 15000);
  await browser.evaluate(`${q(treeItem)}.click()`);
  await browser.until('the file and its revisions', `!!${q(`[data-testid=file-viewer][data-path="${FILE}"]`)} && ${revisionRows}.length === 3`, 15000);
  assert.ok(await browser.evaluate(`!!${q('[data-testid=list-pane]')} && !!${q('[data-testid=detail-pane]')} && !!${q('[data-testid=revisions]')}`), 'the Library, the file and its Revisions on one screen');
  assert.ok(await browser.evaluate(noOverflow), '1280: no horizontal overflow');
  await browser.screenshot('desktop-documents.png');
  await browser.click(q('[data-testid=nav-user]'));
  await browser.until('the NavUser menu', `!!${q('[data-testid=account-improve]')}`);
  await browser.click(q('[data-testid=account-improve]'));
  await browser.until('the manager in the dock', `!!${q('[data-testid=agent-layer-action-spec]')}`, 15000);
  await pause(700);
  await browser.evaluate(`${q('[data-testid=agent-layer-action-spec]')}.click()`);
  await browser.until('the sheet at 1280', `!!${q(`${SHEET} [data-testid=file-viewer][data-path="${FILE}"]`)}`, 15000);
  await pause(800);
  await browser.screenshot('desktop-sheet.png');
  await browser.evaluate('history.back()');
  await browser.until('Back closes the sheet at 1280', `!${q(SHEET)}`, 15000);

  // The Library renames and deletes files through the app's own /api/resources handler (D-263): a draft written to the workspace is
  // renamed inline from its row's menu, then deleted with the Delete key after the confirmation dialog.
  writeFileSync(join(directory, 'workspace', 'brouillon.md'), '# Brouillon fictif\n');
  await browser.send('Page.reload', {});
  await browser.until('the Fiches screen again', `!!${q('[data-testid=screen-fiches]')}`, 30000);
  await live();
  const draft = path => `[role=treeitem][data-path="${path}"]`;
  await browser.until('the draft is listed', `!!${q(draft('brouillon.md'))}`, 15000);
  await browser.evaluate(`${q('button[aria-label="Actions pour brouillon.md"]')}.focus()`); await browser.press('Enter');
  await browser.until('the row menu', `!!${q('[data-boring=file-actions] [data-action=rename]')}`);
  assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[data-boring=file-actions] [role=menuitem]')].map(item => item.dataset.action)`), ['open', 'download', 'rename', 'move', 'delete']);
  await browser.screenshot('desktop-tree-actions-menu.png');
  await browser.evaluate(`${q('[data-boring=file-actions] [data-action=rename]')}.click()`);
  await browser.until('inline rename', `document.activeElement?.matches('input[data-file-rename][data-revision-known]')`);
  await browser.evaluate(`${q('input[data-file-rename]')}.select()`); await send('Input.insertText', { text: 'brouillon-relu.md' }); await browser.press('Enter');
  await browser.until('the renamed row', `!!${q(draft('brouillon-relu.md'))} && !${q(draft('brouillon.md'))}`, 15000);
  assert.equal(readFileSync(join(directory, 'workspace', 'brouillon-relu.md'), 'utf8'), '# Brouillon fictif\n'); assert.equal(existsSync(join(directory, 'workspace', 'brouillon.md')), false);
  await browser.screenshot('desktop-tree-actions-renamed.png');
  await browser.evaluate(`${q(draft('brouillon-relu.md'))}.focus()`); await browser.press('Delete');
  await browser.until('the delete dialog', `!!${q('[data-boring=file-tree-dialog] [data-confirm=delete]')}`);
  await browser.evaluate(`${q('[data-boring=file-tree-dialog] [data-confirm=delete]')}.click()`);
  await browser.until('the deleted row', `!${q(draft('brouillon-relu.md'))} && !${q('[data-boring=file-tree-dialog]')}`, 15000);
  assert.equal(existsSync(join(directory, 'workspace', 'brouillon-relu.md')), false);
  assert.ok(await browser.evaluate(`!!${q(`[role=treeitem][data-path="${FILE}"]`)}`), 'the other files stay');

  assert.deepEqual(browser.problems.filter(p => !/Failed to load resource/.test(p)), [], 'no page problems');
  console.log('documents journey ok: 390x844 (Library, Revisions, read-only revision, PM sheet, Back, Toutes les fiches) and 1280x800 (side by side, PM sheet, Back, rename and delete from the Library)');
} finally { await browser?.close(); await app.close(); }
