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
// Skill declarations are resolved with the same symlink rejection and realpath
// containment rules as the runtime consumer. This matters for package-relative
// pi.skills paths, which are authored manifest input even in a trusted checkout.
//
// --check (CI-usable): recompute each pinned skill's digest from its canonical SKILL.md and fail
//   (exit 1) listing any that drifted. Also fails loudly if the parsed pin count looks wrong,
//   so an unexpected shape (e.g. a reformatted seat/skills block) can't produce a false "all clear".
// --write: rewrite the drifted pins in place via the YAML document (preserving comments/formatting
//   through the `yaml` package's CST-aware setter), never a blind digest string replace — so
//   colliding digest values (skill A's old digest equals skill B's new digest, or vice versa) can
//   never cross-contaminate each other.

import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'

const pinSitePath = '.agents/factory/fleet.yaml'
const pinSiteUrl = new URL('../.agents/factory/fleet.yaml', import.meta.url)

const personasUrl = new URL('../.agents/personas/', import.meta.url)

async function declaredPersonaSkills() {
  const byDefinitionId = new Map()
  for (const entry of await readdir(personasUrl, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = JSON.parse(await readFile(new URL(`${entry.name}/package.json`, personasUrl), 'utf8'))
    const definitionId = manifest?.boring?.agent?.definitionId
    const skills = manifest?.pi?.skills
    if (typeof definitionId !== 'string' || !Array.isArray(skills) || skills.some((skill) => typeof skill !== 'string')) {
      throw new Error(`.agents/personas/${entry.name}/package.json: expected boring.agent.definitionId and pi.skills`)
    }
    if (new Set(skills).size !== skills.length) {
      throw new Error(`.agents/personas/${entry.name}/package.json: pi.skills declarations must be unique`)
    }
    if (byDefinitionId.has(definitionId)) throw new Error(`duplicate persona definitionId '${definitionId}'`)
    byDefinitionId.set(definitionId, { directory: entry.name, skills })
  }
  return byDefinitionId
}

function isInside(root, target) {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
}

async function readContainedSkill(root, reference) {
  const realRoot = await realpath(root)
  let candidate = resolve(realRoot, reference)
  const candidateStat = await lstat(candidate)
  if (candidateStat.isDirectory()) candidate = resolve(candidate, 'SKILL.md')
  const fileStat = await lstat(candidate)
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('skill source must be a regular non-symlink file')
  const target = await realpath(candidate)
  if (!isInside(realRoot, target)) throw new Error('skill source escapes its admitted root')
  return await readFile(target, 'utf8')
}

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
    const agentTypeId = seatNode.get('agentTypeId')
    const skills = seatNode.get('skills', true)
    if (!skills || typeof skills.items !== 'object') {
      throw new Error(`${pinSitePath}: seat "${seat}" is missing a "skills" sequence`)
    }
    const seenNames = new Set()
    for (const skillNode of skills.items) {
      const name = skillNode.get('name')
      const digest = skillNode.get('digest')
      if (typeof name !== 'string' || typeof digest !== 'string' || !SHA256_RE.test(digest)) {
        throw new Error(`${pinSitePath}: seat "${seat}" has a malformed skill pin`)
      }
      if (seenNames.has(name)) throw new Error(`${pinSitePath}: seat "${seat}" has duplicate skill pin '${name}'`)
      seenNames.add(name)
      pins.push({ seat, agentTypeId, name, digest, node: skillNode })
    }
  }
  return pins
}

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check'
  const source = await readFile(pinSiteUrl, 'utf8')
  const doc = parseDocument(source)
  const pins = collectPins(doc)
  const personaSkills = await declaredPersonaSkills()
  const expectedSkills = new Set([...personaSkills.values()].flatMap((persona) => persona.skills))

  for (const [definitionId, persona] of personaSkills) {
    const pinned = pins.filter((pin) => pin.agentTypeId === definitionId).map((pin) => pin.name)
    const missing = persona.skills.filter((name) => !pinned.includes(name))
    const unexpected = pinned.filter((name) => !persona.skills.includes(name))
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(`${pinSitePath}: pins for '${definitionId}' do not match package pi.skills — missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`)
    }
  }

  const parsedNames = new Set(pins.map((pin) => pin.name))
  const missing = [...expectedSkills].filter((name) => !parsedNames.has(name))
  const unexpected = [...parsedNames].filter((name) => !expectedSkills.has(name))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${pinSitePath}: pin parse did not find the expected skill set — ` +
      `missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}. ` +
      'The pin site and persona pi.skills declarations must stay in sync.',
    )
  }

  const sharedByName = new Map()
  for (const pin of pins.filter((item) => !item.name.includes('/'))) {
    const previous = sharedByName.get(pin.name)
    if (previous && previous.digest !== pin.digest) {
      throw new Error(`conflicting pins for shared skill '${pin.name}' in ${pinSitePath}`)
    }
    sharedByName.set(pin.name, pin)
  }

  const drifted = []
  for (const pin of pins) {
    const persona = personaSkills.get(pin.agentTypeId)
    if (!persona) throw new Error(`${pinSitePath}: seat '${pin.seat}' names unknown persona '${pin.agentTypeId}'`)
    const isPackagePath = pin.name.includes('/')
    const rootPath = isPackagePath
      ? fileURLToPath(new URL(`../.agents/personas/${persona.directory}/`, import.meta.url))
      : fileURLToPath(new URL('../.agents/skills/', import.meta.url))
    const reference = isPackagePath ? pin.name : `${pin.name}/SKILL.md`
    const skillPath = isPackagePath
      ? `.agents/personas/${persona.directory}/${pin.name}`
      : `.agents/skills/${pin.name}/SKILL.md`
    let content
    try {
      content = await readContainedSkill(rootPath, reference)
    } catch {
      throw new Error(`pinned skill '${pin.name}' has no canonical contained source at ${skillPath}`)
    }
    const actual = await sha256(content)
    if (actual !== pin.digest) drifted.push({ seat: pin.seat, name: pin.name, pinned: pin.digest, actual, skillPath })
  }

  if (mode === 'check') {
    if (drifted.length > 0) {
      console.error(`stale skill digest pins in ${pinSitePath}:`)
      for (const d of drifted) console.error(`  ${d.name}: pinned ${d.pinned} != actual ${d.actual} (${d.skillPath})`)
      console.error('run `pnpm write:skill-digests` to repin.')
      process.exit(1)
    }
    console.log(`${pinSitePath}: all ${pins.length} skill digest pin site(s) (${expectedSkills.size} unique declarations) match persona pi.skills sources`)
    return
  }

  if (drifted.length === 0) {
    console.log(`${pinSitePath}: all ${pins.length} skill digest pin site(s) already match; nothing to write`)
    return
  }

  const driftedBySeatAndName = new Map(drifted.map((d) => [`${d.seat}\0${d.name}`, d]))
  // Every drifted pin gets its own node set independently — never a blind
  // digest string replacement across the document.
  for (const pin of pins) {
    const d = driftedBySeatAndName.get(`${pin.seat}\0${pin.name}`)
    if (!d) continue
    pin.node.set('digest', d.actual)
  }
  await writeFile(pinSiteUrl, String(doc))
  console.log(`repinned ${drifted.length} skill digest(s) in ${pinSitePath}:`)
  for (const d of drifted) console.log(`  ${d.name}: ${d.pinned} -> ${d.actual}`)
}

await main()
