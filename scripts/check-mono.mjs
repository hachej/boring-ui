// Monospace is for code and ids. `font-mono` may sit only on <code>, <kbd>, <pre>, <samp> or an element that carries
// `data-mono-id` (a commit sha, run id, path). Dates, counts, labels and badges are sans (D-1742).
// The sources are parsed with TypeScript, so the check knows which JSX element holds the class; a `font-mono` string that is not
// inside a JSX attribute (a constant handed down later) fails too, because the element that finally gets it is unknown.
// Stylesheets are not scanned: their `font-family: var(--font-mono)` rules name code selectors (code, pre, a path) and are reviewed by hand.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { walkProject } from './project-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const MONO_ROOTS = ['registry', 'shadcn/ui', 'packages/ui/src'];
export const MONO_TAGS = new Set(['code', 'kbd', 'pre', 'samp']);
/** Files where the string `font-mono` is not a class. */
export const MONO_EXEMPT = { 'registry/looks-viewer/looks.ts': 'CSS variable names of the shadcn shape, not classes' };
const SOURCE = /\.(tsx|ts|jsx|js|mjs)$/;
const isMonoToken = token => token.split(':').pop() === 'font-mono';
const hasMono = text => text.split(/\s+/).some(isMonoToken);

/** Violations in one source text: [{ line, tag, reason }]. */
export function monoViolations(text, file = 'file.tsx') {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const lineOf = node => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const attributeName = attribute => (ts.isJsxAttribute(attribute) ? attribute.name.getText(source) : '');
  const isText = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
  const visit = node => {
    if (isText(node) && hasMono(node.text)) {
      let inAttribute = false;
      let owner;
      for (let up = node.parent; up; up = up.parent) {
        if (ts.isJsxAttribute(up)) inAttribute = true;
        if (inAttribute && (ts.isJsxOpeningElement(up) || ts.isJsxSelfClosingElement(up))) { owner = up; break; }
        if (ts.isJsxElement(up) || ts.isSourceFile(up)) break;
      }
      if (!owner) {
        found.push({ line: lineOf(node), tag: '', reason: 'font-mono outside a JSX attribute: put it on the element, so the check can see which one' });
      } else {
        const tag = owner.tagName.getText(source);
        const marked = owner.attributes.properties.some(item => attributeName(item) === 'data-mono-id');
        if (!MONO_TAGS.has(tag) && !marked) found.push({ line: lineOf(node), tag, reason: `font-mono on <${tag}>: use sans, or <code>/<kbd>/<pre>/<samp>, or data-mono-id for an id` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function checkMono(base = root) {
  const problems = [];
  for (const folder of MONO_ROOTS) {
    walkProject(base, folder, (entry, path) => {
      if (entry.isDirectory()) return true;
      if (!SOURCE.test(path) || MONO_EXEMPT[path]) return undefined;
      for (const item of monoViolations(readFileSync(posix.join(base, path), 'utf8'), path)) problems.push(`${path}:${item.line} ${item.reason}`);
      return undefined;
    });
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkMono();
  if (problems.length) {
    console.error(`mono: font-mono is for code and ids (code, kbd, pre, samp, data-mono-id); ${problems.length} other use(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('ok: font-mono only on code, kbd, pre, samp and data-mono-id elements');
}
