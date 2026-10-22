import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkProject } from './project-files.mjs';

const required = [
  'README.md', 'AGENTS.md', 'INVARIANTS.md', 'ARCHITECTURE.json', 'VERIFY.json',
  'docs/LAWS.md', 'docs/architecture/PI-COMPLEMENT.md', 'docs/compatibility/HUB-M1.md',
  'docs/architecture/SPEC.md',
  'docs/architecture/PRODUCT-REQUIREMENTS.md', 'docs/architecture/ROADMAP.md',
  'docs/architecture/CANVAS.md', 'docs/architecture/FILES-GIT-EXEC.md',
  'docs/architecture/WEBSITE-INTEGRATION.md', 'docs/architecture/UPSTREAM-EXAMPLES.md',
  'docs/architecture/EXPERIENCE.md',
  'docs/contracts/CONTRACTS.md', 'docs/acceptance/ACCEPTANCE.md',
  'docs/stress-tests/REDACTION.md', 'docs/stress-tests/BASELINE.md', 'docs/stress-tests/HUB-FACTORY.md',
];
const stripFences = (text) => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
// GitHub's heading ids: rendered text, lower-cased, punctuation dropped, spaces to hyphens, repeats numbered.
export function anchors(markdown) {
  const ids = new Set(), seen = new Map();
  for (const [, id] of markdown.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) ids.add(id);
  for (const [, heading] of stripFences(markdown).matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    const base = heading.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    ids.add(count ? `${base}-${count}` : base);
  }
  return ids;
}
const outside = (root, target) => {
  const path = relative(root, target);
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
};

export function checkDocs(directory, expected = required) {
  const root = realpathSync(directory);
  const problems = [];
  let documents = 0;
  const headingIds = new Map();
  const idsOf = (file) => {
    if (!headingIds.has(file)) headingIds.set(file, anchors(readFileSync(file, 'utf8')));
    return headingIds.get(file);
  };
  for (const path of expected) {
    if (!existsSync(resolve(root, path))) problems.push(`missing required document: ${path}`);
  }
  // Files git ignores (dependencies, caches, other agent worktrees under `.claude/worktrees`) are not documents of this repository.
  walkProject(root, '.', (entry, file) => {
    if (entry.isSymbolicLink()) return false;
    if (!entry.isFile() || !entry.name.endsWith('.md')) return;
    const path = resolve(root, file), directory = dirname(path);
    documents++;
    const text = stripFences(readFileSync(path, 'utf8'));
    for (const match of text.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)) {
      const link = match[1];
      if (/^(?:https?:|mailto:)/i.test(link)) continue;
      const [file, fragment] = link.split('#');
      const target = file ? resolve(directory, file) : path;
      if (outside(root, target) || (existsSync(target) && outside(root, realpathSync(target)))) {
        problems.push(`${relative(root, path)}: link leaves repository: ${link}`);
      } else if (!existsSync(target)) {
        problems.push(`${relative(root, path)}: missing local link target: ${link}`);
      } else if (fragment && target.endsWith('.md') && !idsOf(target).has(decodeURIComponent(fragment))) {
        problems.push(`${relative(root, path)}: missing heading anchor: ${link}`);
      }
    }
  });
  return { documents, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = checkDocs(root);
  if (result.problems.length) {
    console.error(result.problems.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`ok: ${result.documents} documents; required files, local links and heading anchors resolve`);
    console.log('Scope: document structure only, not runtime/type/security/acceptance verification.');
  }
}
