// Converts registry/feedback/feedback.css into the `css` object of the feedback item in registry.json (the shadcn registry schema keeps
// css as JSON), with the viewers item's CSS parser. Tooling, outside the registry folders so the feedback item depends on no other item.
// `node scripts/build-feedback-css.mjs` rewrites registry.json; the source test fails when the two differ.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCss } from '../registry/viewers/build-css.mjs';

export const feedbackCss = () => parseCss(readFileSync(new URL('../registry/feedback/feedback.css', import.meta.url), 'utf8'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifestPath = fileURLToPath(new URL('../registry.json', import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const item = manifest.items.find(entry => entry.name === 'feedback');
  if (!item) throw new Error('registry.json has no feedback item');
  item.css = feedbackCss();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('registry.json feedback css updated');
}
