#!/usr/bin/env node
// The feature map (features/): four H2 sections per file, kebab sub-feature IDs unique across the map, every ID named in backticks in a
// driving step, every file listed in features/README.md and every link in it alive. The same rules as boring-factory's verify/feature-map.mjs.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, 'features');
const SECTIONS = ['Sub-features', 'How to get to it (user POV)', 'Gotchas'];
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const problems = [];
const sectionsOf = (text) => {
  const parts = text.split(/^## (.+?)\s*$/m), out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ title: parts[i], body: parts[i + 1] });
  return out;
};
const isDriving = (title) => /^Driving it with .+/.test(title);

const index = existsSync(join(folder, 'README.md')) ? readFileSync(join(folder, 'README.md'), 'utf8') : '';
if (!index) problems.push('features/README.md is missing');
const owners = new Map();
for (const file of existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.md') && f !== 'README.md').sort() : []) {
  const sections = sectionsOf(readFileSync(join(folder, file), 'utf8'));
  const titles = sections.map((s) => s.title);
  for (const wanted of SECTIONS) if (titles.filter((t) => t === wanted).length !== 1) problems.push(`features/${file}: needs exactly one "${wanted}" section`);
  if (titles.filter(isDriving).length !== 1) problems.push(`features/${file}: needs exactly one "Driving it with <harness>" section`);
  for (const title of titles) if (!SECTIONS.includes(title) && !isDriving(title)) problems.push(`features/${file}: unexpected section "${title}"`);
  const driving = sections.filter((s) => isDriving(s.title)).map((s) => s.body).join('\n');
  const bullets = (sections.find((s) => s.title === 'Sub-features')?.body ?? '').split('\n').filter((l) => /^\s*[-*] /.test(l));
  if (!bullets.length) problems.push(`features/${file}: no sub-feature bullets`);
  for (const line of bullets) {
    const id = /^\s*[-*] `([^`]+)`/.exec(line)?.[1];
    if (!id || !ID.test(id)) { problems.push(`features/${file}: a bullet does not start with a kebab ID in backticks: ${line.trim().slice(0, 50)}`); continue; }
    if (owners.has(id)) problems.push(`features/${file}: ID ${id} is also in features/${owners.get(id)}`); else owners.set(id, file);
    if (!driving.includes(`\`${id}\``)) problems.push(`features/${file}: ${id} has no driving step that names it in backticks`);
  }
  if (!index.includes(`(${file})`)) problems.push(`features/${file} is not listed in features/README.md`);
}
for (const [, link] of index.matchAll(/\]\((?!https?:)([^)#\s]+\.md)\)/g)) if (!existsSync(join(folder, link))) problems.push(`features/README.md links ${link}, which does not exist`);

if (problems.length) { console.error(`check-features: ${problems.length} problem(s)\n${problems.map((p) => `  ${p}`).join('\n')}`); process.exit(1); }
console.log(`check-features: ${owners.size} sub-features in ${new Set(owners.values()).size} files`);
