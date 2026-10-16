// Shared Library presentation in both real consumers. Fictional files, scripted model, no credentials.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { launch, q } from '@hachej/boring-testing/browser';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { startWorkspaceApp } from '../workspace-app/server.mjs';
import { startWorkspaceDemo } from '../../demos/workspace/server.mjs';

const evidence = resolve(process.env.LIBRARY_EVIDENCE ?? '.cache/evidence/library/after');
mkdirSync(evidence, { recursive: true });
const tree = '[data-boring=file-tree]';
const brief = '# Fictional project brief\nA calm workspace for a fictional team.';
const figures = 'Quarter,Revenue\nQ1,2400\n';
for (const [name, start, trigger] of [
  ['standalone', startWorkspaceApp, '[data-testid=workspace-library]'],
  ['workspace', startWorkspaceDemo, '[data-testid=chat-action-library]'],
]) {
  const app = await start({ directory: mkdtempSync(join(tmpdir(), 'library-journey-')), scripted: true });
  let browser;
  try {
    browser = await launch(app.url, { evidence });
    const open = async () => {
      if (await browser.evaluate(`!!${q(tree)}`)) return;
      if (name === 'standalone' && !(await browser.evaluate(`${q(trigger)}?.checkVisibility()`))) await browser.click(q('[data-testid=sessions-toggle]'));
      await browser.click(q(trigger));
      await browser.until('Library search', `!!${q(`${tree} input[type=search]`)}`, 20000);
      await browser.until('Library entrance settled', `(() => { const popup = ${q(tree)}?.closest('[data-testid=library-popover], [data-slot=drawer-popup]') ?? ${q(tree)}; return popup && popup.getAnimations({subtree:true}).every(a=>a.playState!=='running'); })()`);
    };
    await browser.until('Library trigger', `!!${q(trigger)}`, 20000);
    await open();
    if (name === 'standalone') {
      await browser.until('empty Library', `${q(`${tree} .file-tree-empty`)}?.innerText.includes('No files yet')`);
      assert.match(await browser.evaluate(`${q(`${tree} .file-tree-empty`)}.innerText`), /Upload or ask the agent to create one/);
      assert.equal(await browser.evaluate(`!!${q(`${tree} .file-tree-empty button`)}`), true);
      await new Promise(resolve => setTimeout(resolve, 400));
      await browser.screenshot('standalone-empty.png');
      await browser.evaluate(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([${JSON.stringify(brief)}], 'Project brief.md', {type:'text/markdown'}));
        transfer.items.add(new File([${JSON.stringify(figures)}], 'Quarterly figures.csv', {type:'text/csv'}));
        window.__libraryDrop = transfer;
        ${q(tree)}.dispatchEvent(new DragEvent('dragenter', {bubbles:true,cancelable:true,dataTransfer:transfer}));
      })()`);
      await browser.until('drop highlight', `${q(tree)}?.dataset.dropping === 'true'`);
      await browser.screenshot('standalone-drop.png');
      await browser.evaluate(`${q(tree)}.dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:window.__libraryDrop})); delete window.__libraryDrop;`);
      await browser.until('drop uploaded and expanded', `!!${q('[role=treeitem][data-path="uploads/Project brief.md"]')}`, 15000);
      assert.equal(await browser.evaluate(`${q(tree)}.dataset.dropping`), undefined);
      const provider = await connectRevisionProvider({ endpoint: new URL('/api/resources', app.url), fetch: request => {
        const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${app.token}`); return fetch(new Request(request, { headers }));
      } });
      const saved = await provider.read({ target: provider.locate('uploads/Project brief.md'), revision: { kind: 'latest' } });
      assert.equal(saved.kind, 'available');
      assert.equal(new TextDecoder().decode(saved.snapshot.bytes), brief, 'drop uses the authenticated publication path');
    } else {
      await browser.until('folder', `!!${q('[role=treeitem][data-path="Policies"]')}`);
      await browser.click(q('[role=treeitem][data-path="Policies"] [data-slot=sidebar-menu-button]'));
      await browser.until('folder expanded', `!!${q('[role=treeitem][data-path="Policies/AP policy.md"]')}`);
    }

    const file = name === 'standalone' ? 'uploads/Project brief.md' : 'Policies/AP policy.md';
    const actions = `button[aria-label=${JSON.stringify(`Actions for ${file}`)}]`;
    for (const phone of [false, true]) {
      await browser.press('Escape');
      await browser.until('Library closed before resizing', `!${q(tree)}`);
      await browser.send('Emulation.setDeviceMetricsOverride', { width: phone ? 360 : 1440, height: phone ? 800 : 950, deviceScaleFactor: 1, mobile: phone });
      for (const dark of [false, true]) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
        console.log(`checking ${name} ${phone ? 'phone' : 'desktop'} ${dark ? 'dark' : 'light'}`);
        await open();
        // A remounted tree starts collapsed. Expand the same folder in either placement.
        const folder = name === 'standalone' ? 'uploads' : 'Policies';
        await browser.until('folder ready', `!!${q(`[role=treeitem][data-path="${folder}"]`)}`);
        if (!(await browser.evaluate(`!!${q(actions)}`))) {
          await browser.until('Library entrance settled', `${q(tree)}.getAnimations({subtree:true}).every(a=>a.playState!=='running')`);
          await browser.click(q(`[role=treeitem][data-path="${folder}"] [data-slot=sidebar-menu-button]`));
        }
        await browser.until('file actions', `!!${q(actions)}`);
        await new Promise(resolve => setTimeout(resolve, 300));
        const geometry = await browser.evaluate(`(() => {
          const panel=${q(tree)}, input=panel.querySelector('input[type=search]'), p=panel.getBoundingClientRect(), s=input.getBoundingClientRect();
          return { left:s.left-p.left, right:p.right-s.right,
            rows:[...panel.querySelectorAll('[data-slot=sidebar-menu-button]')].map(row=>row.getBoundingClientRect().height),
            allMeta:[...panel.querySelectorAll('[data-file-meta]')].every(meta=>meta.textContent.trim().length>0),
            overflow:document.documentElement.scrollWidth>innerWidth || panel.scrollWidth>panel.clientWidth,
            targets:[...panel.querySelectorAll('.file-tree-more,.file-tree-upload,.file-tree-close')].map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})) };
        })()`);
        assert.ok(geometry.left >= 16 && geometry.right >= 16, `inset search: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.rows.every(height => height >= 44 && height <= 48), JSON.stringify(geometry));
        assert.equal(geometry.allMeta, true);
        assert.equal(geometry.overflow, false, `${name}: no horizontal overflow at ${phone ? 360 : 1440}px`);
        if (phone) assert.ok(geometry.targets.every(({ w, h }) => w >= 44 && h >= 44), JSON.stringify(geometry));
        await browser.screenshot(`${name}-${phone ? 'phone' : 'desktop'}-${dark ? 'dark' : 'light'}.png`);

        await browser.evaluate(`${q(actions)}.focus()`); await browser.press('Enter');
        await browser.until('file actions menu', `!!${q('[data-boring=file-actions]')}`);
        const menu = await browser.evaluate(`${q('[data-boring=file-actions]')}.innerText`);
        assert.match(menu, /Open/); assert.match(menu, /Version history/); assert.match(menu, /Download/);
        assert.doesNotMatch(menu, /Rename|Delete/, 'unsupported provider mutations are absent');
        await browser.press('Escape');
        await browser.until('Escape closes only actions', `!${q('[data-boring=file-actions]')} && !!${q(tree)}`);
        await browser.until('menu restores keyboard focus', `document.activeElement === ${q(actions)}`);
        await browser.press('Enter');
        await browser.until('menu reopened', `!!${q('[role=menuitem][data-action=history]')}`);
        await browser.click(q('[role=menuitem][data-action=history]'));
        await browser.until('retained version history', `${q(`section[aria-label=${JSON.stringify(`History of ${file}`)}]`)}?.querySelectorAll('li button').length > 0`);
        await browser.screenshot(`${name}-${phone ? 'phone' : 'desktop'}-history-${dark ? 'dark' : 'light'}.png`);
        await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Close history')?.click()`);
        await browser.press('Escape');
        await browser.until('Library dismissed', `!${q(tree)}`);
      }
    }
    console.log(`ok: ${name} Library, empty/drop, metadata, history menu, light/dark and 360px geometry`);
  } finally { await browser?.close(); await app.close(); }
}
