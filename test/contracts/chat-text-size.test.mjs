import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { registryCss } from '../../lab/studio/tailwind.mjs';

// D-1901: the assistant is a reading surface. `--text-chat` (default 0.9375rem, line-height 1.6, at least 1rem on touch) sizes the message prose,
// its Markdown, the composer and the empty state; the meta rows (thought, tool, time, actions) are the token x 0.93 in muted ink; code is one
// step below the prose; the panel title matches the prose in medium weight; nothing in pi-chat computes under 13px except sr-only text.
// A real Chromium measures the real PiChat over a fake controller at 390 (touch) and 1280, light and dark. Set CHAT_TEXT_EVIDENCE to also write the shots.
// In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const item = name => registry.items.find(entry => entry.name === name);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');
const appCss = readFileSync(join(root, 'packages/ui/styles/app.css'), 'utf8');
const chatRules = appCss.slice(appCss.indexOf('/* Assistant reading size'), appCss.indexOf('/* Overlay blur'));
const CSS_ITEMS = ['theme', 'touch-floor', 'button', 'pi-chat', 'pi-chat-markdown', 'pi-chat-question', 'pi-chat-approval', 'inline-question', 'pi-chat-slash', 'pi-chat-mentions', 'pi-chat-pickers', 'pi-chat-voice', 'pi-chat-attachments', 'pi-chat-subagent', 'pi-artifacts'];

test('the assistant reads at --text-chat: prose, Markdown, composer and empty state at the token, meta rows at 0.93 of it, nothing under 13px (390 touch, 1280; light, dark)', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/chat-text-'));
  const shots = process.env.CHAT_TEXT_EVIDENCE; if (shots) mkdirSync(shots, { recursive: true });
  const kit = { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
    const exported = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports;
    builder.onResolve({ filter: /^@hachej\/boring-ui-kit\// }, args => {
      const target = exported[`./${args.path.slice('@hachej/boring-ui-kit/'.length)}`]?.import;
      const base = join(root, 'packages/ui/src', String(target).replace(/^\.\/dist\//, '').replace(/\.js$/, ''));
      return { path: ['.ts', '.tsx'].map(ext => base + ext).find(existsSync) };
    });
  } };
  const bundle = await build({ entryPoints: [join(root, 'test/fixtures/themes/chat-text.jsx')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit] });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${CSS_ITEMS.map(name => registryCss(item(name))).join('\n')}\n${chatRules}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)));
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(path === '/app.js' ? js : path === '/app.css' ? css : html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence: shots ?? work });

  // One page script: the token as the page computes it, the sizes of the parts, and every text-bearing element under 13px that is not sr-only.
  const measure = () => browser.evaluate(`(() => {
    const px = value => parseFloat(value);
    const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;font-size:var(--text-chat);color:var(--muted-foreground)'; document.body.append(probe);
    const token = { defined: getComputedStyle(document.documentElement).getPropertyValue('--text-chat').trim(), px: px(getComputedStyle(probe).fontSize), muted: getComputedStyle(probe).color }; probe.remove();
    const size = (selector, scope = document) => { const node = scope.querySelector(selector); if (!node) return null; const s = getComputedStyle(node); return { size: px(s.fontSize), line: px(s.lineHeight), weight: s.fontWeight, color: s.color }; };
    const small = [];
    for (const node of document.querySelectorAll('.pi-chat *, [data-slot$=-content][class*=pi-chat] *')) {
      if (node.closest('.sr-only, [hidden], svg')) continue;
      const own = [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim());
      if (!own && !(node.matches('textarea, input') && !node.closest('.sr-only'))) continue;
      const s = getComputedStyle(node); if (s.display === 'none' || s.visibility === 'hidden') continue;
      if (px(s.fontSize) < 13) small.push({ tag: node.tagName, testid: node.getAttribute('data-testid') ?? node.getAttribute('data-slot'), text: node.textContent.trim().slice(0, 30), size: px(s.fontSize) });
    }
    return { token, small, title: size('header h2'), userProse: size('[data-role=user] [data-slot=bubble-content]'), prose: size('[data-role=assistant] [data-slot=bubble-content]'),
      li: size('[data-role=assistant] li'), cell: size('[data-role=assistant] td'), codespan: size('[data-role=assistant] p code'), codeblock: size('[data-testid=code-block] pre'),
      composer: size('[data-testid=composer-input]'), empty: size('[data-slot=empty-description]'), line: size('[data-slot=trace-line]'), time: size('[data-testid=message-time]'), answered: size('[data-testid=answered-by]'), question: size('[data-testid=question-text]'), questionInput: size('[data-testid=question-input]'), approval: size('[data-testid=approval-card] [data-slot=item-title]'), titleButton: size('header h2 button'), plusItem: size('[data-testid=composer-plus-menu] [role=menuitem]'), modelItem: size('[data-testid=composer-model-menu] [role=menuitemradio], [data-testid=composer-model-menu] [role=menuitem]') };
  })()`);
  const near = (actual, expected, label) => assert.ok(actual !== null && Math.abs(actual - expected) < 0.2, `${label}: ${actual}px, expected ${expected}px`);
  const states = ['empty', 'reply', 'thought', 'streaming', 'question', 'approval', 'plus', 'model'];
  const report = [];
  try {
    for (const [width, mobile] of [[390, true], [1280, false]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
      for (const theme of ['light', 'dark']) for (const state of states) {
        await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?state=${state === 'plus' || state === 'model' ? 'reply' : state}&theme=${theme}&w=${width}` });
        await browser.until('chat mounted', `document.querySelector('.pi-chat') && document.readyState === 'complete'`);
        if (state === 'plus' || state === 'model') { await browser.evaluate(`document.querySelector('[data-testid=composer-${state}]')?.click()`); await browser.until('menu open', `document.querySelector('[data-testid=composer-${state}-menu]')`); }
        if (state === 'thought') { await browser.evaluate(`document.querySelector('[data-testid=activity] button')?.click()`); await new Promise(done => setTimeout(done, 500)); await browser.evaluate(`document.querySelectorAll('[data-testid=tool-card] button, [data-testid=reasoning] button').forEach(button => button.click())`); }
        await new Promise(done => setTimeout(done, 500));
        const m = await measure(); report.push({ width, theme, state, m });
        if (shots) await browser.screenshot(`chat-${state}-${width}-${theme}.png`);
        const label = `${width} ${theme} ${state}`;
        assert.notEqual(m.token.defined, '', `${label}: --text-chat is defined by the theme`);
        const prose = mobile ? Math.max(m.token.px, 16) : m.token.px;
        if (!mobile) near(m.token.px, 15, `${label}: the token's default`);
        assert.deepEqual(m.small, [], `${label}: nothing in pi-chat computes under 13px except sr-only text`);
        near(m.composer?.size ?? null, prose, `${label}: composer input`);
        if (state === 'empty') near(m.empty?.size ?? null, prose, `${label}: empty state line`);
        if (state === 'reply' || state === 'thought' || state === 'streaming') {
          near(m.userProse?.size ?? null, prose, `${label}: the person's message`);
          near(m.userProse.line, prose * 1.6, `${label}: the person's message line height`);
        }
        if (state === 'reply') {
          near(m.prose?.size ?? null, prose, `${label}: agent prose`); near(m.prose.line, prose * 1.6, `${label}: agent prose line height`);
          near(m.li?.size ?? null, prose, `${label}: list item`); near(m.cell?.size ?? null, prose, `${label}: table cell`);
          near(m.codespan?.size ?? null, prose * 0.875, `${label}: inline code one step down`); near(m.codeblock?.size ?? null, prose * 0.875, `${label}: code block one step down`);
          near(m.time?.size ?? m.answered?.size ?? null, prose * 0.93, `${label}: meta row`);
        }
        if (state === 'thought') { near(m.line?.size ?? null, prose * 0.93, `${label}: thought and tool rows`); assert.equal(m.line.color, m.token.muted, `${label}: meta rows are muted-foreground`); }
        if (state === 'question') { near(m.question?.size ?? null, prose, `${label}: question text`); near(m.questionInput?.size ?? null, prose, `${label}: question input`); }
        if (state === 'approval') near(m.approval?.size ?? null, prose, `${label}: approval card title`);
        if (state === 'plus') assert.ok(m.plusItem && m.plusItem.size >= 13, `${label}: the + menu is sized by the chat (${m.plusItem?.size}px)`);
        if (state === 'model') assert.ok(m.modelItem && m.modelItem.size >= 13, `${label}: the model menu is sized by the chat (${m.modelItem?.size}px)`);
        near(m.titleButton?.size ?? null, prose, `${label}: the rename title button`);
        near(m.title?.size ?? null, prose, `${label}: panel title`); assert.equal(m.title.weight, '500', `${label}: panel title is medium`);
      }
      // An app sets --text-chat in its theme.core.css like any type token: the prose follows it.
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?state=reply&theme=light&override=1&w=${width}` });
      await browser.until('chat mounted', `document.querySelector('.pi-chat') && document.readyState === 'complete'`);
      await browser.evaluate(`document.documentElement.style.setProperty('--text-chat', '1.5rem')`);
      await new Promise(done => setTimeout(done, 200));
      near((await measure()).prose?.size ?? null, 24, `${width}: an app's --text-chat override`);
    }
    if (shots) writeFileSync(join(shots, 'measurements.json'), JSON.stringify(report, null, 1));
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
