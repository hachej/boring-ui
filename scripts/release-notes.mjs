import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validReleaseVersion } from './release-version.mjs';

// The GitHub release body: the section that release:version promoted for this version, comments removed.
export function releaseNotes(notes, version) {
  if (!validReleaseVersion(version)) throw new Error('Use an exact release version, for example 1.1.0 or 1.1.0-rc.1');
  const sections = notes.split(/^(?=# )/m).filter(section => section.split(/\r?\n/, 1)[0].trim() === `# Migrating to ${version}`);
  if (sections.length !== 1) throw new Error(`MIGRATING.md must have exactly one # Migrating to ${version} section`);
  const body = sections[0].replace(/^.*\r?\n?/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!body) throw new Error(`# Migrating to ${version} is empty`);
  return body;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/release-notes.mjs <version>');
  console.log(releaseNotes(readFileSync('MIGRATING.md', 'utf8'), process.argv[2]));
}
