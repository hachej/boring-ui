import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadConfiguredAgentFleet } from "@hachej/boring-agent/server"
import { ErrorCode } from "@hachej/boring-agent/shared"
import { afterEach, describe, expect, test } from "vitest"

import { discoverRepositoryAgentPackages } from "../discoverAgentPackages"

/**
 * Scanner → loader integration: the conflict rule ("two packages claiming one
 * definitionId both fail closed") only holds if a MALFORMED claimant still
 * reaches conflict grouping. Injecting descriptors by hand in the loader's own
 * unit tests cannot prove that — the projection step is what used to drop them.
 */

let root: string

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

async function writePersona(
  name: string,
  agent: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const dir = join(root, ".agents", "personas", name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "instructions.md"), `# ${name}\n`, "utf8")
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "0.0.0", boring: { agent: { label: name, ...agent } }, ...extra }, null, 2),
    "utf8",
  )
}

async function writeFactory(seats: { seat: string; agentTypeId: string }[]): Promise<void> {
  const dir = join(root, ".agents", "factory")
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, "fleet.yaml"),
    `models:\n  tiers:\n    T3:\n      - provider: anthropic\n        id: claude-sonnet-4-6\n        envVar: ANTHROPIC_API_KEY\nseats:\n${seats.map((s) => `  - seat: ${s.seat}\n    agentTypeId: ${s.agentTypeId}\n    skills: []\n`).join("")}`,
    "utf8",
  )
  await writeFile(join(dir, "policy.yaml"), "models:\n  seats: {}\n", "utf8")
  await mkdir(join(root, ".agents", "skills"), { recursive: true })
}

async function loadFleet() {
  const discoveredPackages = await discoverRepositoryAgentPackages(root)
  const result = loadConfiguredAgentFleet({
    discoveredPackages,
    workspaceRoot: root,
    fleetConfigPath: join(root, ".agents", "factory", "fleet.yaml"),
    policyPath: join(root, ".agents", "factory", "policy.yaml"),
    skillsRoot: join(root, ".agents", "skills"),
    env: {},
  })
  return { discoveredPackages, result }
}

describe("agent package discovery → fleet loader conflict detection", () => {
  test("a malformed duplicate claimant still fails the valid claimant closed", async () => {
    root = await mkdtemp(join(tmpdir(), "agent-pkg-conflict-"))
    await writePersona("valid", {
      definitionId: "boring-dup",
      version: "1.0.0",
      instructionsRef: "instructions.md",
    })
    // Claims the same definitionId but its version is malformed: the scanner
    // must still surface the claim (with a failed preflight), not drop it.
    await writePersona("malformed", {
      definitionId: "boring-dup",
      version: 42,
      instructionsRef: "instructions.md",
    })
    await writeFactory([{ seat: "dup-seat", agentTypeId: "boring-dup" }])

    const { discoveredPackages, result } = await loadFleet()

    expect(discoveredPackages.map((pkg) => pkg.manifest.boring.agent.definitionId).sort()).toEqual([
      "boring-dup",
      "boring-dup",
    ])
    expect(discoveredPackages.some((pkg) => !pkg.preflight.ok)).toBe(true)
    await expect(result).rejects.toMatchObject({
      name: "ConfiguredFleetSeatError",
      code: ErrorCode.enum.AGENT_DEFINITION_ID_CONFLICT,
      seat: "dup-seat",
      agentTypeId: "boring-dup",
    })
  })

  test("a malformed pi.skills duplicate claimant also conflicts", async () => {
    root = await mkdtemp(join(tmpdir(), "agent-pkg-conflict-"))
    await writePersona("valid", {
      definitionId: "boring-dup",
      version: "1.0.0",
      instructionsRef: "instructions.md",
    })
    await writePersona(
      "malformed",
      { definitionId: "boring-dup", version: "1.0.0", instructionsRef: "instructions.md" },
      { pi: { skills: [7] } },
    )
    await writeFactory([{ seat: "dup-seat", agentTypeId: "boring-dup" }])

    const { result } = await loadFleet()

    await expect(result).rejects.toMatchObject({
      name: "ConfiguredFleetSeatError",
      code: ErrorCode.enum.AGENT_DEFINITION_ID_CONFLICT,
      seat: "dup-seat",
      agentTypeId: "boring-dup",
    })
  })

  test("a single valid claimant still seats normally", async () => {
    root = await mkdtemp(join(tmpdir(), "agent-pkg-conflict-"))
    await writePersona("valid", {
      definitionId: "boring-solo",
      version: "1.0.0",
      instructionsRef: "instructions.md",
    })
    await writeFactory([{ seat: "solo-seat", agentTypeId: "boring-solo" }])

    const { result } = await loadFleet()
    const { agents, diagnostics } = await result

    expect(diagnostics).toEqual([])
    expect(agents.map((agent) => agent.agentTypeId)).toEqual(["boring-solo"])
  })
})
