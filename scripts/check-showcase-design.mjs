import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The showcase site demos the kit, so its fixtures are held to the kit's own design rules (`boring-ui-blocks design`): no raw form control or table,
// no arbitrary size, no hand-written touch size. Source layout rules (line length) are not design drift and stay out.
const root = fileURLToPath(new URL('../', import.meta.url));
// The type scale is the app's own (theme.core.css); the showcase fixtures run on the kit's default theme, which declares text-base to text-4xl, so design-type-scale does not apply to them.
const SKIP = new Set(['line-length', 'component-length', 'file-length', 'design-type-scale']);
export const showcaseFiles = (base = root) => [
  ...readdirSync(`${base}/test/fixtures/themes`).filter(file => /^one-composer.*\.jsx$/.test(file)).map(file => `test/fixtures/themes/${file}`),
  ...readdirSync(`${base}/ux/fixtures`).filter(file => file.endsWith('.jsx')).map(file => `ux/fixtures/${file}`),
];
export function showcaseFindings(dir = root, files = showcaseFiles(dir)) {
  const bin = fileURLToPath(new URL('../packages/ui/bin/boring-ui-blocks.mjs', import.meta.url));
  let out;
  try { out = execFileSync('node', [bin, 'design', '.', '--changed', ...files, '--json'], { encoding: 'utf8', cwd: dir }); } catch (error) { out = error.stdout; }
  return JSON.parse(out).findings.filter(finding => !SKIP.has(finding.rule));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = showcaseFindings();
  for (const finding of findings) console.error(`${finding.file}:${finding.line} ${finding.rule} ${finding.message}`);
  if (findings.length) { console.error(`showcase design: ${findings.length} finding(s)`); process.exit(1); }
  console.log('showcase design: ok');
}
