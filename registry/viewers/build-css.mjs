// Converts registry/viewers/viewers.css into the `css` object of the viewers item in registry.json (the shadcn registry schema keeps
// css as JSON). `node registry/viewers/build-css.mjs` rewrites registry.json; the source test fails when the two differ.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);

/** Nested rules: `{ selector: { property: value } | { nested: ... } }`. Handles at-rules, comments and one level of declarations. */
export function parseCss(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let index = 0;
  function block() {
    const rules = {};
    for (;;) {
      while (/\s/.test(text[index] ?? '')) index++;
      if (index >= text.length || text[index] === '}') return rules;
      let end = index, depth = 0;
      // A declaration ends at `;`, a rule at `{`. Parentheses (url(), color-mix()) may contain either character class.
      while (end < text.length) {
        const char = text[end];
        if (char === '(') depth++; else if (char === ')') depth--;
        else if (depth === 0 && (char === ';' || char === '{' || char === '}')) break;
        end++;
      }
      const head = text.slice(index, end).trim();
      if (text[end] === '{') {
        index = end + 1;
        const body = block();
        if (text[index] !== '}') throw new Error(`Unclosed block for ${head}`);
        index++;
        const key = head.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ');
        rules[key] = { ...(rules[key] ?? {}), ...body };
      } else {
        const colon = head.indexOf(':');
        if (colon < 0) throw new Error(`Bad declaration: ${head}`);
        rules[head.slice(0, colon).trim()] = head.slice(colon + 1).trim().replace(/\s+/g, ' ');
        index = text[end] === ';' ? end + 1 : end;
      }
    }
  }
  return block();
}

export const viewersCss = () => parseCss(readFileSync(new URL('viewers.css', here), 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifestPath = fileURLToPath(new URL('../../registry.json', import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const item = manifest.items.find(entry => entry.name === 'viewers');
  if (!item) throw new Error('registry.json has no viewers item');
  item.css = viewersCss();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('registry.json viewers css updated');
}
