import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));

// D-1814: an inline Button (D-1767) is underlined at rest in prose, but inside a kit TableCell it is underlined on hover and focus-visible only.
test('inline Button in a TableCell: no underline at rest, underline on hover and focus-visible; in prose still underlined', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'getComputedStyle' ? window[name].bind(window) : window[name] });
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const out = `${root}.cache/button-inline-table/`; mkdirSync(out, { recursive: true });
  await build({
    stdin: { contents: `export { Button } from '${root}shadcn/ui/button'; export { Table, TableBody, TableRow, TableCell } from '${root}shadcn/ui/table';`, resolveDir: root, loader: 'tsx' },
    outfile: `${out}bundle.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external',
  });
  const { Button, Table, TableBody, TableRow, TableCell } = await import(`file://${out}bundle.mjs`);
  const host = window.document.createElement('div'); window.document.body.append(host); const react = createRoot(host);
  t.after(async () => { await act(async () => react.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const classes = el => new Set(el.className.split(/\s+/));

  await act(async () => react.render(h(Table, null, h(TableBody, null, h(TableRow, null, h(TableCell, null, h(Button, { size: 'inline', 'data-testid': 'in-cell' }, 'Edit')))))));
  const cell = host.querySelector('[data-testid=in-cell]');
  assert.ok(cell.closest('[data-slot=table-cell]'), 'the Button sits inside a real kit TableCell');
  const c = classes(cell);
  for (const cls of ['in-data-[slot=table-cell]:no-underline', 'in-data-[slot=table-cell]:hover:underline', 'in-data-[slot=table-cell]:focus-visible:underline']) assert.ok(c.has(cls), `table-cell variant ${cls}`);
  for (const cls of ['decoration-current', 'underline-offset-2', 'text-primary', 'focus-visible:ring-3', "pointer-coarse:after:h-[var(--control-min,2.75rem)]"]) assert.ok(c.has(cls), `${cls} stays`);

  await act(async () => react.render(h('p', null, 'Read ', h(Button, { size: 'inline', 'data-testid': 'in-prose' }, 'the terms'))));
  const prose = host.querySelector('[data-testid=in-prose]');
  assert.ok(!prose.closest('[data-slot=table-cell]'), 'not in a cell');
  assert.ok(classes(prose).has('underline'), 'in prose it is underlined at rest');
});
