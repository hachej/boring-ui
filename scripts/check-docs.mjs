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
const outside = (root, target) => {
  const path = relative(root, target);
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
};

export function checkDocs(directory, expected = required) {
  const root = realpathSync(directory);
  const problems = [];
  let documents = 0;
  for (const path of expected) {
    if (!existsSync(resolve(root, path))) problems.push(`missing required document: ${path}`);
  }
  // Files git ignores (dependencies, caches, other agent worktrees under `.claude/worktrees`) are not documents of this repository.
  walkProject(root, '.', (entry, file) => {
    if (entry.isSymbolicLink()) return false;
    if (!entry.isFile() || !entry.name.endsWith('.md')) return;
    const path = resolve(root, file), directory = dirname(path);
    documents++;
    const text = readFileSync(path, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
    for (const match of text.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)) {
      const link = match[1];
      if (/^(?:https?:|mailto:|#)/i.test(link)) continue;
      const target = resolve(directory, link.split('#')[0]);
      if (outside(root, target) || (existsSync(target) && outside(root, realpathSync(target)))) {
        problems.push(`${relative(root, path)}: link leaves repository: ${link}`);
      } else if (!existsSync(target)) {
        problems.push(`${relative(root, path)}: missing local link target: ${link}`);
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
    console.log(`ok: ${result.documents} documents; required files and local links resolve`);
    console.log('Scope: document structure only, not runtime/type/security/acceptance verification.');
  }
}
