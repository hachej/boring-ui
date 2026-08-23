#!/usr/bin/env node
// Static, deterministic end-to-end validation of ONE agent/persona package
// under `.agents/personas/<pkg>`, addressed by its declared
// `boring.agent.definitionId` — not the directory name.
//
// Runs the real declarative-agent loader (packages/agent/src/server/agentDefinition/)
// against the checked-out repo tree: no network, no credential access, no model
// calls. Intended as a fast pre-flight for anyone adding/editing a persona
// package or a fleet.yaml/policy.yaml seat binding.
//
// Usage:
//   pnpm factory:check <definitionId> [--json]
//
// Checks (see docs/procedures/... — none yet; this header is the doc):
//   1. manifest    — package.json parses; boring.agent.{definitionId,version,
//                     label,instructionsRef} present; instructionsRef file exists.
//   2. compiles    — materializeAgentDirectory() compiles the package
//                     (manifest validation + instructions + knowledge/ digesting)
//                     without throwing.
//   3. skills      — loadConfiguredAgentFleet()'s own digest verification for
//                     every seated pi.skills entry; its diagnostics are surfaced
//                     verbatim.
//   4. knowledge   — knowledge/ directory contents (if declared) are readable;
//                     enforced as part of check 2 (compilation digests them).
//   5. seat status — seated (composes into the real fleet.yaml) vs
//                     discovered-but-unseated (AGENT_DEFINITION_UNSEATED) are
//                     both PASS states; an unknown definitionId is FAIL.
//   6. model policy — if seated, the seat's models.seats tier (policy.yaml)
//                     resolves against fleet.yaml's models.tiers candidates.
//                     Structural only: no env var / API key / network check.
//
// Exit status is non-zero if any check fails. `--json` prints a single JSON
// report object instead of the human-readable log.

import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const personasDir = resolve(repoRoot, '.agents/personas')
const fleetConfigPath = resolve(repoRoot, '.agents/factory/fleet.yaml')
const policyPath = resolve(repoRoot, '.agents/factory/policy.yaml')
const skillsRoot = resolve(repoRoot, '.agents/skills')

// The loader publishes seated seats' instruction refs relative to a single
// served workspace root. This script checks the repo tree statically, not a
// running host bound to one workspace, so it always passes `workspaceRoot:
// null` — which deterministically produces exactly one diagnostic per seated
// seat (AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE, "no single ...
// workspaceRoot: null ... path to be addressed against"). That diagnostic is
// the KNOWN BENIGN one this script always expects and never fails on; any
// OTHER diagnostic for the checked definitionId is a real failure.
const BENIGN_UNPUBLISHABLE_NOTE = 'instructions not linkable with workspaceRoot: null'

async function loadAgentDefinitionApi() {
  const agentDefinitionDir = resolve(repoRoot, 'packages/agent/src/server/agentDefinition')
  const [materialize, fleet] = await Promise.all([
    import(pathToFileURL(resolve(agentDefinitionDir, 'materializeAgentDirectory.ts')).href),
    import(pathToFileURL(resolve(agentDefinitionDir, 'loadConfiguredAgentFleet.ts')).href),
  ])
  return {
    materializeAgentDirectory: materialize.materializeAgentDirectory,
    loadConfiguredAgentFleet: fleet.loadConfiguredAgentFleet,
    parseModelTierCandidates: fleet.parseModelTierCandidates,
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Validates ONE persona package's manifest shape per check #1, independent
 * of the compiler: parses package.json, checks the required
 * boring.agent fields are present strings, and that instructionsRef names a
 * file that exists. Returns a structured result rather than throwing, so the
 * caller can both report it and feed a preflight-annotated descriptor to the
 * real loader.
 */
async function checkManifest(pkgDir) {
  const pkgPath = resolve(pkgDir, 'package.json')
  const errors = []
  let raw
  try {
    raw = await readFile(pkgPath, 'utf8')
  } catch (error) {
    return { ok: false, errors: [`package.json could not be read: ${error.message}`] }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, errors: [`package.json is not valid JSON: ${error.message}`] }
  }
  const agent = isRecord(parsed) && isRecord(parsed.boring) ? parsed.boring.agent : undefined
  if (!isRecord(agent)) {
    return { ok: false, errors: ['package.json must declare a boring.agent block'] }
  }
  for (const field of ['definitionId', 'version', 'label', 'instructionsRef']) {
    if (typeof agent[field] !== 'string' || agent[field].trim().length === 0) {
      errors.push(`boring.agent.${field} must be a non-empty string`)
    }
  }
  if (typeof agent.instructionsRef === 'string' && agent.instructionsRef.trim().length > 0) {
    const instructionsPath = resolve(pkgDir, agent.instructionsRef)
    if (!(await pathExists(instructionsPath))) {
      errors.push(`instructionsRef ${JSON.stringify(agent.instructionsRef)} does not exist at ${instructionsPath}`)
    }
  }
  const skills = parsed.pi?.skills
  if (skills !== undefined && (!Array.isArray(skills) || skills.some((skill) => typeof skill !== 'string'))) {
    errors.push('pi.skills, when present, must be an array of strings')
  }
  return { ok: errors.length === 0, errors, manifest: parsed, agent }
}

/** Scans every `.agents/personas/<pkg>` directory into a manifest report keyed by dir name. */
async function scanPersonaPackages() {
  const entries = await readdir(personasDir, { withFileTypes: true })
  const packages = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pkgDir = resolve(personasDir, entry.name)
    const manifestCheck = await checkManifest(pkgDir)
    packages.push({ dirName: entry.name, pkgDir, manifestCheck })
  }
  return packages
}

/** Builds the `discoveredPackages` shape `loadConfiguredAgentFleet` expects. */
function toDiscoveredDescriptor(pkg) {
  const { manifest, agent } = pkg.manifestCheck
  return {
    rootDir: pkg.pkgDir,
    manifest: {
      boring: { agent },
      ...(manifest?.pi ? { pi: manifest.pi } : {}),
    },
    preflight: pkg.manifestCheck.ok
      ? { ok: true }
      : { ok: false, errors: pkg.manifestCheck.errors.map((message) => ({ code: 'MANIFEST_INVALID', message })) },
  }
}

async function readSeats(path) {
  const raw = parseYaml(await readFile(path, 'utf8'))
  return Array.isArray(raw?.seats) ? raw.seats : []
}

async function readSeatTier(path, seat) {
  const raw = parseYaml(await readFile(path, 'utf8'))
  const tier = raw?.models?.seats?.[seat]
  return typeof tier === 'string' ? tier : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')
  const definitionId = args.find((arg) => !arg.startsWith('--'))

  const report = {
    definitionId: definitionId ?? null,
    checks: [],
    ok: true,
  }

  function record(name, ok, detail) {
    report.checks.push({ name, ok, detail: detail ?? null })
    if (!ok) report.ok = false
  }

  if (!definitionId) {
    record('args', false, 'usage: pnpm factory:check <definitionId> [--json]')
    emit(report, jsonMode)
    process.exit(1)
  }

  const api = await loadAgentDefinitionApi()
  const packages = await scanPersonaPackages()

  // ---- Check 1: manifest -------------------------------------------------
  const target = packages.find((pkg) => pkg.manifestCheck.agent?.definitionId === definitionId)
  const targetsWithBrokenManifests = packages.filter(
    (pkg) => !pkg.manifestCheck.ok && pkg.manifestCheck.manifest === undefined,
  )
  if (!target) {
    // The definitionId might belong to a package whose manifest was so broken
    // it never parsed far enough to report a definitionId at all — those are
    // structurally indistinguishable from "unknown" here, and check 5 below
    // reports that distinction precisely (unknown vs. present-but-invalid).
    record(
      'manifest',
      false,
      `no .agents/personas/<pkg> directory declares boring.agent.definitionId ${JSON.stringify(definitionId)}` +
        (targetsWithBrokenManifests.length > 0
          ? `; ${targetsWithBrokenManifests.length} package(s) have unreadable manifests and could not be checked: ${
            targetsWithBrokenManifests.map((pkg) => pkg.dirName).join(', ')
          }`
          : ''),
    )
  } else if (!target.manifestCheck.ok) {
    record('manifest', false, target.manifestCheck.errors.join('; '))
  } else {
    record('manifest', true, `${target.dirName}/package.json valid (v${target.manifestCheck.agent.version})`)
  }

  // ---- Check 2 + 4: compiles + knowledge ---------------------------------
  if (target && target.manifestCheck.ok) {
    try {
      const bundle = await api.materializeAgentDirectory({
        directory: target.pkgDir,
        expectedAgentTypeId: definitionId,
        manifest: 'package.json',
      })
      record(
        'compiles',
        true,
        `definitionDigest ${bundle.definitionDigest}${bundle.knowledgeDir ? `; knowledge/ digested from ${bundle.knowledgeDir}` : '; no knowledge/ declared'}`,
      )
    } catch (error) {
      record('compiles', false, error instanceof Error ? error.message : String(error))
    }
  } else {
    record('compiles', false, 'skipped: manifest check failed')
  }

  // ---- Checks 3, 5, 6: skills / seat status / model policy ---------------
  const discoveredPackages = packages
    .filter((pkg) => pkg.manifestCheck.agent?.definitionId)
    .map(toDiscoveredDescriptor)

  let fleetResult
  try {
    fleetResult = await api.loadConfiguredAgentFleet({
      discoveredPackages,
      workspaceRoot: null,
      fleetConfigPath,
      policyPath,
      skillsRoot,
    })
  } catch (error) {
    record('fleet-compose', false, `fleet.yaml/policy.yaml could not be loaded: ${error instanceof Error ? error.message : String(error)}`)
  }

  const seats = await readSeats(fleetConfigPath)
  const seatBinding = seats.find((seat) => seat?.agentTypeId === definitionId)

  if (!target) {
    record('seat-status', false, `unknown definitionId ${JSON.stringify(definitionId)}: FAIL`)
  } else if (fleetResult) {
    const relevantDiagnostics = fleetResult.diagnostics.filter((d) => d.agentTypeId === definitionId)
    const composed = fleetResult.agents.find((agent) => agent.agentTypeId === definitionId)
    const benign = relevantDiagnostics.filter((d) => d.code === 'AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE')
    const unseatedMarker = relevantDiagnostics.find((d) => d.code === 'AGENT_DEFINITION_UNSEATED')
    const realFailures = relevantDiagnostics.filter(
      (d) => d.code !== 'AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE' && d.code !== 'AGENT_DEFINITION_UNSEATED',
    )

    for (const diag of benign) {
      record('diagnostic (benign)', true, `${BENIGN_UNPUBLISHABLE_NOTE} — ${diag.code}: ${diag.message}`)
    }
    for (const diag of realFailures) {
      record('diagnostic', false, `${diag.code}${diag.seat ? ` (seat ${diag.seat})` : ''}: ${diag.message}`)
    }

    if (seatBinding && composed) {
      record('seat-status', true, `SEATED as "${seatBinding.seat}" — composes in fleet.yaml (PASS)`)
    } else if (seatBinding && !composed && realFailures.length === 0) {
      // Seated per fleet.yaml but didn't compose and no diagnostic pinned to
      // this definitionId explains why (e.g. a conflicted definitionId,
      // whose diagnostics are recorded against every claimant equally, or a
      // thrown fleet-compose error swallowed above) — surface it as a
      // failure rather than silently reporting "seated".
      record('seat-status', false, `seat "${seatBinding.seat}" is bound to this definitionId but did not compose, and no diagnostic explains why`)
    } else if (seatBinding) {
      record('seat-status', false, `seat "${seatBinding.seat}" is bound to this definitionId but failed to compose (see diagnostics above)`)
    } else if (unseatedMarker) {
      record('seat-status', true, `DISCOVERED-BUT-UNSEATED (AGENT_DEFINITION_UNSEATED) — inert, PASS`)
    } else if (realFailures.length > 0) {
      record('seat-status', false, 'discovered but excluded before seat resolution (see diagnostics above)')
    } else {
      // Reachable only if a same-definitionId conflict excluded it from both
      // the unseated-marker path and any seat binding.
      record('seat-status', false, 'definitionId is ambiguous or excluded (see diagnostics above); not seated and not cleanly unseated')
    }

    // ---- Check 6: model policy (structural only) -------------------------
    if (seatBinding) {
      try {
        const seatTier = await readSeatTier(policyPath, seatBinding.seat)
        const fleetRaw = parseYaml(await readFile(fleetConfigPath, 'utf8'))
        const tierCandidates = api.parseModelTierCandidates(fleetRaw, fleetConfigPath)
        if (!seatTier) {
          record('model-policy', false, `policy.yaml models.seats has no tier for seat "${seatBinding.seat}"`)
        } else if (!tierCandidates[seatTier]) {
          record('model-policy', false, `policy.yaml models.seats.${seatBinding.seat} references tier ${JSON.stringify(seatTier)}, which fleet.yaml models.tiers does not declare`)
        } else {
          record('model-policy', true, `seat "${seatBinding.seat}" -> tier ${seatTier} -> ${tierCandidates[seatTier].length} candidate(s) declared (structural only, no network/credential check)`)
        }
      } catch (error) {
        record('model-policy', false, error instanceof Error ? error.message : String(error))
      }
    } else {
      record('model-policy', true, 'not seated: no model tier to resolve (n/a, PASS)')
    }
  }

  emit(report, jsonMode)
  process.exit(report.ok ? 0 : 1)
}

function emit(report, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`[factory:check] ${report.definitionId ?? '(no definitionId given)'}`)
  for (const check of report.checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
  }
  console.log(`[factory:check] ${report.ok ? 'PASS' : 'FAIL'} overall`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
