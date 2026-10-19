// Real-browser journey of large files as blob pointers in the workspace app (`blobs: true`, `?blobs`, scripted model, no key). The host
// (./blobs.mjs) seeds three fictional pointers and serves their bytes at /_files. The Library lists each pointer under its file's name and
// size; the photo opens inline, the report in the PDF viewer, the budget as a download; an upload above the 256 KB cap goes to the host
// with progress and appears in the Library without the page writing anything. Desktop 1440 and phone 390, light and dark: screenshots in
// .cache/evidence/blob/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceApp } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/blob';
mkdirSync(evidence, { recursive: true });
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const LIBRARY = '[data-testid=workspace-library-side]';
const row = path => q(`${LIBRARY} [role=treeitem][data-path="${path}"]`);
const noOverflow = `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`;
let browser;
const scheme = value => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
const shoot = async name => { for (const value of ['light', 'dark']) { await browser.evaluate(`document.documentElement.classList.toggle('dark', ${value === 'dark'})`); await scheme(value); await pause(300); await browser.screenshot(`${name}-${value}.png`); } await browser.evaluate(`document.documentElement.classList.remove('dark')`); await scheme('light'); };

const directory = mkdtempSync(join(tmpdir(), 'boring-blobs-'));
const app = await startWorkspaceApp({ directory, blobs: true });
try {
  browser = await launch(insecureUrl(`${app.url}?blobs`), { evidence });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.until('the page', `!!${q('[data-testid=workspace-library]')}`, 20000);
  const openLibrary = async tap => {
    if (!(await browser.evaluate(`!!${q(LIBRARY)}`))) await (tap ? browser.tap : browser.click)(q('[data-testid=workspace-library]'));
    await browser.until('the Library lists the pointers', `!!${row('harbour.png.blob.json')}`, 10000);
  };
  const open = async (path, tap) => {
    await openLibrary(tap);
    await (tap ? browser.tap : browser.click)(`${row(path)}.querySelector('button')`);
    await browser.until(`${path} opens`, `${q('[data-testid=file-viewer]')}?.dataset.path === ${JSON.stringify(path)}`, 10000);
  };

  await step('desktop 1440: the Library lists each pointer under its file name, size and kind', async () => {
    await openLibrary(false);
    const meta = await browser.evaluate(`['harbour.png', 'quarterly-report.pdf', 'budget.xlsx'].map(name => { const r = ${q(LIBRARY)}.querySelector('[data-path="' + name + '.blob.json"]'); return r.querySelector('.file-tree-name').textContent + ' | ' + r.querySelector('[data-file-meta]').textContent; })`);
    assert.match(meta[0], /^harbour\.png \| Image · \d/);
    assert.match(meta[1], /^quarterly-report\.pdf \| PDF · /);
    assert.match(meta[2], /^budget\.xlsx \| XLSX · /);
    await shoot('desktop-library');
  });

  await step('desktop: the photo opens inline from /_files (access checked by the page cookie)', async () => {
    await open('harbour.png.blob.json', false);
    await browser.until('the image loaded', `${q('[data-testid=file-viewer] img')}?.complete && ${q('[data-testid=file-viewer] img')}.naturalWidth === 640`, 10000);
    assert.match(await browser.evaluate(`${q('[data-testid=file-viewer] img')}.getAttribute('src')`), /^\/_files\/blob-/);
    const headers = await browser.evaluate(`fetch(${q('[data-testid=file-viewer] img')}.src).then(r => [r.status, r.headers.get('content-disposition'), r.headers.get('x-content-type-options'), r.headers.get('content-security-policy')])`);
    assert.deepEqual(headers.slice(0, 3), [200, "inline; filename*=UTF-8''harbour.png", 'nosniff']);
    assert.match(headers[3], /default-src 'none'/);
    const refused = await browser.evaluate(`fetch(${q('[data-testid=file-viewer] img')}.src, { credentials: 'omit', cache: 'no-store' }).then(r => r.status)`);
    assert.equal(refused, 403, 'without the cookie the bytes are refused');
    await shoot('desktop-image');
  });

  await step('desktop: the report opens in the PDF viewer from its URL', async () => {
    await open('quarterly-report.pdf.blob.json', false);
    await browser.until('the PDF viewer', `['inline', 'pages'].includes(${q('[data-testid=viewer-stage]')}?.dataset.pdf)`, 10000);
    const source = await browser.evaluate(`${q('[data-testid=viewer-frame-pdf]')}?.getAttribute('src') ?? 'pages'`);
    assert.ok(source === 'pages' || /^\/_files\/blob-[^#]+#view=FitH$/.test(source), source);
    await pause(800);
    await shoot('desktop-pdf');
  });

  await step('desktop: the budget is a download named after the file', async () => {
    await open('budget.xlsx.blob.json', false);
    await browser.until('the download action', `!!${q('[data-testid=blob-download]')}`, 10000);
    assert.equal(await browser.evaluate(`${q('[data-testid=blob-download]')}.getAttribute('download')`), 'budget.xlsx');
    const disposition = await browser.evaluate(`fetch(${q('[data-testid=blob-download]')}.href).then(r => r.headers.get('content-disposition'))`);
    assert.equal(disposition, "attachment; filename*=UTF-8''budget.xlsx");
    await shoot('desktop-download');
  });

  await step('desktop: an upload above the cap goes to the host with progress and appears in the Library', async () => {
    const file = join(directory, 'fictional-drone.mov');
    writeFileSync(file, Buffer.alloc(3 * 1024 * 1024, 7));
    await openLibrary(false);
    await browser.attachFiles(`${q(LIBRARY)}.querySelector('input[type=file]')`, [file]);
    await browser.until('the upload row or its result', `!!${q('[data-blob-upload="fictional-drone.mov"]')} || !!${row('uploads')}`, 10000);
    await browser.until('the uploads folder', `!!${row('uploads')}`, 20000);
    if (await browser.evaluate(`${row('uploads')}.getAttribute('aria-expanded') !== 'true'`)) await browser.click(`${row('uploads')}.querySelector('button')`);
    await browser.until('the uploaded pointer', `!!${row('uploads/fictional-drone.mov.blob.json')}`, 10000);
    assert.match(await browser.evaluate(`${row('uploads/fictional-drone.mov.blob.json')}.textContent`), /fictional-drone\.mov.*3 MB/);
    assert.equal(await browser.evaluate(`!!${q(`${LIBRARY} [role=alert]`)}`), false, 'no error');
    await shoot('desktop-library-uploaded');
  });

  await step('phone 390: Library sheet, image, PDF and download; no horizontal scroll', async () => {
    const close = async () => {
      for (let n = 0; n < 5 && await browser.evaluate(`!!${q('[data-testid=file-viewer]')} || !!${q(LIBRARY)}`); n++) {
        await browser.evaluate(`(${q('[data-testid=viewer-close]')} ?? ${q('[data-file-close]')})?.click()`); await pause(300);
      }
    };
    await close();
    await browser.emulate('phone');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await pause(400);
    const library = async () => {
      for (let n = 0; n < 4 && !(await browser.evaluate(`!!${q('[data-testid=workspace-library]')}?.checkVisibility()`)); n++) {
        await browser.until('the navigation toggle', `!!${q('[data-testid=sessions-toggle]')}`, 5000);
        await browser.tap(q('[data-testid=sessions-toggle]')); await pause(500);
      }
      await browser.until('the Library button', `!!${q('[data-testid=workspace-library]')}?.checkVisibility()`, 5000);
      await openLibrary(true);
    };
    await library();
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll at 390 (Library)');
    await shoot('phone-library');
    for (const [path, name, ready] of [
      ['harbour.png.blob.json', 'phone-image', `${q('[data-testid=file-viewer] img')}?.naturalWidth === 640`],
      ['quarterly-report.pdf.blob.json', 'phone-pdf', `['inline', 'pages', 'fallback'].includes(${q('[data-testid=viewer-stage]')}?.dataset.pdf)`],
      ['budget.xlsx.blob.json', 'phone-download', `!!${q('[data-testid=blob-download]')}`],
    ]) {
      await library();
      await browser.tap(`${row(path)}.querySelector('button')`);
      await browser.until(`${path} on the phone`, ready, 10000);
      await pause(600);
      assert.ok(await browser.evaluate(noOverflow), `no horizontal scroll at 390 (${name})`);
      await shoot(name);
      await close();
    }
  });
  console.log(`Screenshots in ${evidence}`);
} finally {
  await browser?.close();
  await app.close();
}
