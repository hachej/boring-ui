#!/usr/bin/env node
// Recomputes the sha256 pins baked into apps/workspace-playground/src/server/factoryAgents.ts
// (`{ name: <skill>, digest: 'sha256:<hex>' }` entries inside ROLE_BINDING_DEFINITIONS). Those
// pins guard the trusted-agent-composition instruction appendices — see
// createConfiguredAgentHostAgentSpec's canonical-skill digest check — and were previously
// repinned by hand after every .agents/skills/<name>/SKILL.md edit (#1101, #1085 and earlier).
//
// Deliberately asymmetric with the consumer (factoryAgents.ts's canonicalSkillContent): the
// consumer enforces symlink/containment checks on the skill file because it runs against an
// admitted repository root at agent-boot time. This script only ever reads a fixed, repo-relative
// `.agents/skills/<name>/SKILL.md` path under a trusted developer/CI checkout, so those runtime
// admission checks don't apply here — there's no untrusted root to escape.
//
// --check (CI-usable): recompute each pinned skill's digest from its canonical SKILL.md and fail
//   (exit 1) listing any that drifted. Also fails loudly if the parsed pin count looks wrong,
//   so a pattern that silently stops matching (e.g. a reformatted/multiline entry) can't produce
//   a false "all clear".
// --write: rewrite the drifted pins in place, using the original match spans (not a global
//   string replace) so colliding digest values (skill A's old digest equals skill B's new
//   digest, or vice versa) can never cross-contaminate each other.

import { readFile, writeFile } from 'node:fs/promises'

const pinSitePath = 'apps/workspace-playground/src/server/factoryAgents.ts'
const pinSiteUrl = new URL('../apps/workspace-playground/src/server/factoryAgents.ts', import.meta.url)

// The full set of skills the pin site is expected to reference today. Anything parsed outside
// this set, or any skill in this set that fails to parse at all, is a hard error rather than a
// silent skip — a partially-matching pattern must be loud, not quietly report "all clear".
const EXPECTED_SKILLS = ['feedback', 'triage', 'handoff', 'plan', 'exec', 'fresh-eyes']

async function sha256(content) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return `sha256:${Buffer.from(hash).toString('hex')}`
}

// Anchors on the `{ name: '<skill>', digest: 'sha256:<hex>' }` shape rather than a bare
// sha256-looking regex, so unrelated sha256 literals elsewhere in the file (or repo) are never
// touched. Tolerant of whitespace/newlines between fields and an optional trailing comma, so a
// reformatted (e.g. multiline) entry is still matched instead of silently dropped.
const PIN_PATTERN = /\{\s*name:\s*'([^']+)'\s*,\s*digest:\s*'(sha256:[0-9a-f]{64})'\s*,?\s*\}/g

function parsePins(source) {
  const pins = []
  for (const match of source.matchAll(PIN_PATTERN)) {
    pins.push({
      name: match[1],
      digest: match[2],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return pins
}

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check'
  const source = await readFile(pinSiteUrl, 'utf8')
  const pins = parsePins(source)

  const parsedNames = new Set(pins.map((pin) => pin.name))
  const missing = EXPECTED_SKILLS.filter((name) => !parsedNames.has(name))
  const unexpected = [...parsedNames].filter((name) => !EXPECTED_SKILLS.includes(name))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${pinSitePath}: pin pattern did not parse the expected skill set — ` +
      `missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}. ` +
      'The pin site was likely reformatted; update PIN_PATTERN/EXPECTED_SKILLS in ' +
      'scripts/refresh-skill-digests.mjs rather than trusting a silent partial match.',
    )
  }

  const byName = new Map()
  for (const pin of pins) {
    const previous = byName.get(pin.name)
    if (previous && previous.digest !== pin.digest) {
      throw new Error(`conflicting pins for skill '${pin.name}' in ${pinSitePath}`)
    }
    byName.set(pin.name, pin)
  }

  const drifted = []
  for (const [name, pin] of byName) {
    const skillPath = `.agents/skills/${name}/SKILL.md`
    let content
    try {
      content = await readFile(new URL(`../${skillPath}`, import.meta.url), 'utf8')
    } catch {
      throw new Error(`pinned skill '${name}' has no canonical source at ${skillPath}`)
    }
    const actual = await sha256(content)
    if (actual !== pin.digest) drifted.push({ name, pinned: pin.digest, actual, skillPath })
  }

  if (mode === 'check') {
    if (drifted.length > 0) {
      console.error(`stale skill digest pins in ${pinSitePath}:`)
      for (const d of drifted) console.error(`  ${d.name}: pinned ${d.pinned} != actual ${d.actual} (${d.skillPath})`)
      console.error('run `pnpm write:skill-digests` to repin.')
      process.exit(1)
    }
    console.log(`${pinSitePath}: all ${pins.length} skill digest pin site(s) (${byName.size} unique skills) match .agents/skills/**/SKILL.md`)
    return
  }

  if (drifted.length === 0) {
    console.log(`${pinSitePath}: all ${pins.length} skill digest pin site(s) already match; nothing to write`)
    return
  }

  const driftedByName = new Map(drifted.map((d) => [d.name, d]))
  // Rewrite back-to-front using each match's own [start, end) span, never a global
  // string/digest replace — a global replace would cross-contaminate whenever one skill's old
  // digest collides with another skill's new (or old) digest.
  let rewritten = source
  for (const pin of [...pins].sort((a, b) => b.start - a.start)) {
    const d = driftedByName.get(pin.name)
    if (!d) continue
    const replacement = `{ name: '${pin.name}', digest: '${d.actual}' }`
    rewritten = rewritten.slice(0, pin.start) + replacement + rewritten.slice(pin.end)
  }
  await writeFile(pinSiteUrl, rewritten)
  console.log(`repinned ${drifted.length} skill digest(s) in ${pinSitePath}:`)
  for (const d of drifted) console.log(`  ${d.name}: ${d.pinned} -> ${d.actual}`)
}

await main()
