#!/usr/bin/env node
// Recomputes the sha256 pins baked into .agents/factory/fleet.yaml (each seat's
// `skills: [{ name, digest }]` bindings). Those pins guard the trusted-agent-composition
// instruction appendices — see createConfiguredAgentHostAgentSpec's canonical-skill digest
// check, consumed by loadConfiguredAgentFleet() — and were previously repinned by hand after
// every .agents/skills/<name>/SKILL.md edit (#1101, #1085 and earlier).
//
// gh-1106 slice 3 moved the pin site from apps/workspace-playground/src/server/factoryAgents.ts
// (a TS object-literal pin, matched by regex) to fleet.yaml (structural YAML, parsed properly).
//
// Deliberately asymmetric with the consumer (loadConfiguredAgentFleet's canonicalSkillContent):
// the consumer enforces symlink/containment checks on the skill file because it runs against an
// admitted repository root at agent-boot time. This script only ever reads a fixed, repo-relative
// `.agents/skills/<name>/SKILL.md` path under a trusted developer/CI checkout, so those runtime
// admission checks don't apply here — there's no untrusted root to escape.
//
// --check (CI-usable): recompute each pinned skill's digest from its canonical SKILL.md and fail
//   (exit 1) listing any that drifted. Also fails loudly if the parsed pin count looks wrong,
//   so an unexpected shape (e.g. a reformatted seat/skills block) can't produce a false "all clear".
// --write: rewrite the drifted pins in place via the YAML document (preserving comments/formatting
//   through the `yaml` package's CST-aware setter), never a blind digest string replace — so
//   colliding digest values (skill A's old digest equals skill B's new digest, or vice versa) can
//   never cross-contaminate each other.

import { readFile, writeFile } from 'node:fs/promises'
import { parseDocument } from 'yaml'

const pinSitePath = '.agents/factory/fleet.yaml'
const pinSiteUrl = new URL('../.agents/factory/fleet.yaml', import.meta.url)

// The full set of skills the pin site is expected to reference today. Anything parsed outside
// this set, or any skill in this set that fails to parse at all, is a hard error rather than a
// silent skip — a partially-matching pattern must be loud, not quietly report "all clear".
const EXPECTED_SKILLS = ['feedback', 'triage', 'handoff', 'plan', 'exec', 'fresh-eyes']

async function sha256(content) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return `sha256:${Buffer.from(hash).toString('hex')}`
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/

/** Walks the parsed YAML document's seats[].skills[] structurally (no regex). */
function collectPins(doc) {
  const seats = doc.get('seats', true)
  if (!seats || typeof seats.items !== 'object') {
    throw new Error(`${pinSitePath}: expected a top-level "seats" sequence`)
  }
  const pins = []
  for (const seatNode of seats.items) {
    const seat = seatNode.get('seat')
    const skills = seatNode.get('skills', true)
    if (!skills || typeof skills.items !== 'object') {
      throw new Error(`${pinSitePath}: seat "${seat}" is missing a "skills" sequence`)
    }
    for (const skillNode of skills.items) {
      const name = skillNode.get('name')
      const digest = skillNode.get('digest')
      if (typeof name !== 'string' || typeof digest !== 'string' || !SHA256_RE.test(digest)) {
        throw new Error(`${pinSitePath}: seat "${seat}" has a malformed skill pin`)
      }
      pins.push({ seat, name, digest, node: skillNode })
    }
  }
  return pins
}

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check'
  const source = await readFile(pinSiteUrl, 'utf8')
  const doc = parseDocument(source)
  const pins = collectPins(doc)

  const parsedNames = new Set(pins.map((pin) => pin.name))
  const missing = EXPECTED_SKILLS.filter((name) => !parsedNames.has(name))
  const unexpected = [...parsedNames].filter((name) => !EXPECTED_SKILLS.includes(name))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${pinSitePath}: pin parse did not find the expected skill set — ` +
      `missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}. ` +
      'The pin site was likely reshaped; update EXPECTED_SKILLS in ' +
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
  // Every occurrence of a drifted skill (it may be pinned under multiple seats) gets its own
  // node's digest set independently — never a blind string replace across the document.
  for (const pin of pins) {
    const d = driftedByName.get(pin.name)
    if (!d) continue
    pin.node.set('digest', d.actual)
  }
  await writeFile(pinSiteUrl, String(doc))
  console.log(`repinned ${drifted.length} skill digest(s) in ${pinSitePath}:`)
  for (const d of drifted) console.log(`  ${d.name}: ${d.pinned} -> ${d.actual}`)
}

await main()
