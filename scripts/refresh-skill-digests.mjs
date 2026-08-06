// Recomputes the sha256 pins baked into apps/workspace-playground/src/server/factoryAgents.ts
// (`{ name: <skill>, digest: 'sha256:<hex>' }` entries inside ROLE_BINDING_DEFINITIONS). Those
// pins guard the trusted-agent-composition instruction appendices — see
// createConfiguredAgentHostAgentSpec's canonical-skill digest check — and were previously
// repinned by hand after every .agents/skills/<name>/SKILL.md edit (#1101, #1085 and earlier).
//
// --check (default, CI-usable): recompute each pinned skill's digest from its canonical
//   SKILL.md and fail (exit 1) listing any that drifted.
// --write: rewrite the drifted pins in place.

import { readFile, writeFile } from 'node:fs/promises'

const pinSitePath = 'apps/workspace-playground/src/server/factoryAgents.ts'
const pinSiteUrl = new URL('../apps/workspace-playground/src/server/factoryAgents.ts', import.meta.url)

async function sha256(content) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return `sha256:${Buffer.from(hash).toString('hex')}`
}

// Anchors on the `{ name: '<skill>', digest: 'sha256:<hex>' }` shape rather than a bare
// sha256-looking regex, so unrelated sha256 literals elsewhere in the file (or repo) are never
// touched.
const PIN_PATTERN = /\{\s*name:\s*'([^']+)',\s*digest:\s*'(sha256:[0-9a-f]{64})'\s*\}/g

function parsePins(source) {
  const pins = []
  for (const match of source.matchAll(PIN_PATTERN)) {
    pins.push({ name: match[1], digest: match[2], index: match.index, full: match[0] })
  }
  return pins
}

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check'
  const source = await readFile(pinSiteUrl, 'utf8')
  const pins = parsePins(source)
  if (pins.length === 0) throw new Error(`no digest pins found in ${pinSitePath}; pin pattern may be stale`)

  const seen = new Map()
  const drifted = []
  for (const pin of pins) {
    if (seen.has(pin.name) && seen.get(pin.name) !== pin.digest) {
      throw new Error(`conflicting pins for skill '${pin.name}' in ${pinSitePath}`)
    }
    if (seen.has(pin.name)) continue
    seen.set(pin.name, pin.digest)

    const skillPath = `.agents/skills/${pin.name}/SKILL.md`
    let content
    try {
      content = await readFile(new URL(`../${skillPath}`, import.meta.url), 'utf8')
    } catch {
      throw new Error(`pinned skill '${pin.name}' has no canonical source at ${skillPath}`)
    }
    const actual = await sha256(content)
    if (actual !== pin.digest) drifted.push({ name: pin.name, pinned: pin.digest, actual, skillPath })
  }

  if (mode === 'check') {
    if (drifted.length > 0) {
      console.error(`stale skill digest pins in ${pinSitePath}:`)
      for (const d of drifted) console.error(`  ${d.name}: pinned ${d.pinned} != actual ${d.actual} (${d.skillPath})`)
      console.error('run `pnpm digests:write` to repin.')
      process.exit(1)
    }
    console.log(`${pinSitePath}: all ${seen.size} skill digest pins match .agents/skills/**/SKILL.md`)
    return
  }

  if (drifted.length === 0) {
    console.log(`${pinSitePath}: all ${seen.size} skill digest pins already match; nothing to write`)
    return
  }
  let rewritten = source
  for (const d of drifted) {
    rewritten = rewritten.split(`digest: '${d.pinned}'`).join(`digest: '${d.actual}'`)
  }
  await writeFile(pinSiteUrl, rewritten)
  console.log(`repinned ${drifted.length} skill digest(s) in ${pinSitePath}:`)
  for (const d of drifted) console.log(`  ${d.name}: ${d.pinned} -> ${d.actual}`)
}

await main()
