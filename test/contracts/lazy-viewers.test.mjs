// Viewers by kind, lazily (D-257 step 4): the agent page (`AgentWorkspace`, its artifact panel and file viewer, and the documents screen)
// bundled with code splitting, as a consumer's bundler does. Every view module lands in a chunk of its own that the page reaches only by
// a dynamic import, and the chunks the page loads up front carry no view module and none of the view-only packages (the Markdown and HTML
// editors, pdf.js). `LAZY_VIEWERS_SOURCE_ROOT` points the same check at another checkout's source (the fail-first proof runs it on the
// tree before step 4, where the panel imported every pane statically).
import assert from 'node:assert/strict';
import test from 'node:test';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { LAZY_VIEWS } from '../../scripts/check-registry-blocks.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(process.env.LAZY_VIEWERS_SOURCE_ROOT ?? root);
/** npm modules only a view uses: the Markdown and HTML editors and pdf.js. */
/** The view modules by name (scripts/check-registry-blocks.mjs owns the list). */
const VIEWS = LAZY_VIEWS.map(view => view.split('/')[1]);
const VIEW_ONLY = /^(@hachej\/boring-ui-kit\/(markdown-editor|html-viewer)|pdfjs-dist|@tiptap\/)/;

/** The page bundled with splitting: per output, its registry inputs, its external imports, and its static and dynamic chunk imports. */
async function bundle(entries) {
  const result = await build({ entryPoints: entries.map(entry => resolve(source, entry)), bundle: true, splitting: true, write: false, outdir: resolve(root, '.cache/lazy-viewers-test'),
    format: 'esm', platform: 'browser', jsx: 'automatic', packages: 'external', metafile: true, logLevel: 'silent' });
  const outputs = new Map(Object.entries(result.metafile.outputs).map(([path, output]) => [resolve(path), {
    entry: output.entryPoint ? relative(source, resolve(output.entryPoint)) : undefined,
    // A view by its module name (`markdown-pane`), wherever its item puts it: the tree before step 4 kept the panes in `viewers/`.
    inputs: Object.keys(output.inputs).map(input => relative(source, resolve(input))).filter(input => input.startsWith('registry/')).map(input => input.replace(/^.*\//, '').replace(/\.tsx?$/, '')),
    external: output.imports.filter(edge => edge.external).map(edge => edge.path),
    static: output.imports.filter(edge => !edge.external && edge.kind === 'import-statement').map(edge => resolve(edge.path)),
    lazy: output.imports.filter(edge => !edge.external && edge.kind === 'dynamic-import').map(edge => resolve(edge.path)),
  }]));
  return outputs;
}

/** The outputs a page loads before any dynamic import: its entry chunk and every chunk reached by static imports. */
function upFront(outputs, entry) {
  const start = [...outputs].find(([, output]) => output.entry === entry)?.[0];
  assert.ok(start, `no output for ${entry}`);
  const seen = new Set([start]);
  for (const path of seen) for (const next of outputs.get(path).static) seen.add(next);
  return [...seen].map(path => outputs.get(path));
}

const PAGES = ['registry/pi-app/agent-workspace.tsx', 'registry/pi-app/artifact-panel.tsx', 'registry/pi-app/file-viewer.tsx', 'registry/documents/documents.tsx'];

test('the agent page loads no view up front: every view is its own lazily imported chunk (D-257 step 4)', async () => {
  const outputs = await bundle(PAGES);
  for (const page of PAGES) {
    const eager = upFront(outputs, relative(source, resolve(source, page)));
    const views = eager.flatMap(output => output.inputs).filter(input => VIEWS.includes(input));
    assert.deepEqual([...new Set(views)].sort(), [], `${page} loads view modules up front; they belong behind their kind's load()`);
    const packages = eager.flatMap(output => output.external).filter(path => VIEW_ONLY.test(path));
    assert.deepEqual([...new Set(packages)].sort(), [], `${page} loads view-only packages up front`);
  }
  // Each view the agent page draws is bundled, in a chunk no page loads up front: only a kind's dynamic import reaches it.
  const eager = new Set(PAGES.flatMap(page => upFront(outputs, relative(source, resolve(source, page)))));
  for (const view of ['markdown-pane', 'html-pane', 'image-pane', 'pdf-pane', 'maquette-viewer', 'diagram-viewer', 'mockup-viewer', 'record-viewer']) {
    const chunk = [...outputs.values()].find(output => output.inputs.includes(view));
    assert.ok(chunk, `${view} is bundled`);
    assert.ok(!eager.has(chunk), `${view} is not in a chunk a page loads up front`);
  }
  const markdown = [...outputs.values()].find(output => output.inputs.includes('markdown-pane'));
  assert.ok(markdown.external.some(path => /^@hachej\/boring-ui-kit\/markdown-editor/.test(path)), 'the Markdown editor is imported by the Markdown chunk');
});
