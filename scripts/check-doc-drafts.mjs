// Guard: a native document draft (`await tx.doc(...)`) records only writes made through the draft itself. Assigning a fresh object
// and writing into the value the assignment returns loses those writes, with no error:
//   (draft.map ??= {})[key] = value;          // lost
//   const map = draft.map ??= {}; map[key] = v; // lost
// Write `draft.map ??= {};` and then read `draft.map` again before writing into it. Files that open document drafts must not
// contain the lossy forms.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitIgnored, walkProject } from './project-files.mjs';

const sourceFile = /\.(?:ts|tsx|mjs|js|jsx)$/;
const opensDraft = /\btx\.doc\(/;
const lossy = [
  /\(\s*[\w$]+(?:\.[\w$]+)+\s*\?\?=\s*(?:\{\}|\[\])\s*\)\s*[[.]/g,
  /=\s*[\w$]+(?:\.[\w$]+)+\s*\?\?=\s*(?:\{\}|\[\])/g,
];

export function checkDocDrafts(root) {
  const errors = [];
  const check = (entry, file) => {
    if (!entry.isFile() || !sourceFile.test(entry.name)) return;
    const path = resolve(root, file);
    const text = readFileSync(path, 'utf8');
    if (!opensDraft.test(text)) return;
    for (const pattern of lossy) for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      errors.push(`BORING-DOC-DRAFT ${file}:${line}: a write into the value of \`??=\` bypasses the document draft; assign, then re-read the field`);
    }
  };
  const ignored = gitIgnored(root);
  for (const directory of ['packages', 'examples']) if (existsSync(resolve(root, directory))) walkProject(root, directory, check, ignored);
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const errors = checkDocDrafts(resolve(fileURLToPath(new URL('..', import.meta.url))));
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('document draft writes: ok');
}
