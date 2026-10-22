import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { isExcludedFromRelease } from './release-set.mjs';
import { setReleaseVersion, unreleasedNotes } from './release-version.mjs';

export function checkReleaseNotes(root, base, head) {
  if (![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha ?? ''))) throw new Error('Release note checks require exact base and head SHAs');
  const git = args => {
    const result = runCaptured('git', args, { cwd: root });
    if (result.status !== 0) throw new Error('Cannot read release note comparison from Git');
    return result.stdout;
  };
  base = git(['merge-base', base, head]).trim();
  const paths = git(['diff', '--name-only', base, head]).trim().split('\n');
  const directories = [...new Set(paths.map(path => /^packages\/([^/]+)\//.exec(path)?.[1]).filter(Boolean))];
  const published = directories.some(directory => {
    let manifest;
    try { manifest = git(['show', `${head}:packages/${directory}/package.json`]); }
    catch { manifest = git(['show', `${base}:packages/${directory}/package.json`]); }
    return !isExcludedFromRelease(JSON.parse(manifest));
  }) || paths.some(path => /^(registry\/|public\/r\/|registry\.json$)/.test(path));
  if (!published) return { required: false };
  const before = git(['show', `${base}:MIGRATING.md`]), after = git(['show', `${head}:MIGRATING.md`]);
  const version = JSON.parse(git(['show', `${head}:package.json`])).version;
  const oldVersion = JSON.parse(git(['show', `${base}:package.json`])).version;
  if (version !== oldVersion) {
    const promoted = before.replace(/^# Unreleased\r?/, `# Unreleased\n\n# Migrating to ${version}`);
    const versionFile = path => /^(package(?:-lock)?\.json|registry\.json|MIGRATING\.md|packages\/[^/]+\/package\.json|public\/r\/[^/]+\.json)$/.test(path);
    // The release may open its notes with prose; anything from the first list item or heading on must be the exact promotion.
    const lines = after.split('\n'), start = lines.indexOf(`# Migrating to ${version}`) + 1;
    let end = start;
    while (start && end < lines.length && !/^([-*] |#)/.test(lines[end])) end++;
    const withoutIntro = start ? [...lines.slice(0, start), '', ...lines.slice(end)].join('\n') : after;
    if (withoutIntro === promoted && paths.every(versionFile)) {
      const directory = mkdtempSync(join(tmpdir(), 'boring-release-notes-'));
      try {
        const files = git(['ls-tree', '-r', '--name-only', base]).trim().split('\n').filter(versionFile);
        for (const path of files) {
          mkdirSync(dirname(join(directory, path)), { recursive: true });
          writeFileSync(join(directory, path), git(['show', `${base}:${path}`]));
        }
        setReleaseVersion(directory, version);
        const released = path => path === 'MIGRATING.md' ? withoutIntro : git(['show', `${head}:${path}`]);
        if (files.every(path => readFileSync(join(directory, path), 'utf8') === released(path))) return { required: true, promoted: true };
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  }
  const pending = unreleasedNotes(after), oldLines = new Set(before.split('\n'));
  if (!pending.split('\n').some(line => /^[-*] \S.+/.test(line) && !oldLines.has(line))) throw new Error('Each PR changing a published package must add its own line under # Unreleased in MIGRATING.md');
  return { required: true, promoted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(checkReleaseNotes(fileURLToPath(new URL('../', import.meta.url)), process.env.BASE_SHA, process.env.HEAD_SHA)));
}
