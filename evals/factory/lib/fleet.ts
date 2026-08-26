/**
 * Fleet composition helpers for the factory eval suite.
 *
 * Two composition paths, both going through the real production loader
 * (`loadConfiguredAgentFleet`, packages/agent/src/server/agentDefinition):
 *
 *  - `composeRealFleet()` — the actual repository fleet: `.agents/factory/
 *    fleet.yaml` + `.agents/factory/policy.yaml` + `.agents/personas/`,
 *    discovered via `discoverRepositoryAgentPackages` exactly as
 *    apps/workspace-playground/src/server/factoryAgents.ts does for the
 *    real playground/production boot.
 *
 *  - `composeTempFleet()` — an eval-only fixture fleet under
 *    evals/factory/fixtures/temp-fleet/, composed from manually constructed
 *    `DiscoveredAgentPackageDescriptor`s (the same shape
 *    loadConfiguredAgentFleet's own unit tests use) rather than a filesystem
 *    scan, so the fixture roster never depends on what happens to be on
 *    disk under `.agents/personas`.
 */
import { resolve } from "node:path"
import {
  loadConfiguredAgentFleet,
  type AgentHostAgentSpec,
  type DiscoveredAgentPackageDescriptor,
} from "@hachej/boring-agent/server"
import { discoverRepositoryAgentPackages } from "@hachej/boring-workspace/server"

const EVALS_ROOT = resolve(import.meta.dirname, "..")
const REPOSITORY_ROOT = resolve(EVALS_ROOT, "../..")

const TEMP_FLEET_ROOT = resolve(EVALS_ROOT, "fixtures", "temp-fleet")
const TEMP_FLEET_PERSONAS_ROOT = resolve(EVALS_ROOT, "fixtures", "personas")
const TEMP_FLEET_CONFIG_PATH = resolve(TEMP_FLEET_ROOT, "factory", "fleet.yaml")
const TEMP_FLEET_POLICY_PATH = resolve(TEMP_FLEET_ROOT, "factory", "policy.yaml")

const REAL_FLEET_CONFIG_PATH = resolve(REPOSITORY_ROOT, ".agents", "factory", "fleet.yaml")
const REAL_FLEET_POLICY_PATH = resolve(REPOSITORY_ROOT, ".agents", "factory", "policy.yaml")
const REAL_SKILLS_ROOT = resolve(REPOSITORY_ROOT, ".agents", "skills")

export interface ComposedFleet {
  agents: readonly AgentHostAgentSpec[]
  diagnostics: readonly { seat: string; code: string; message: string }[]
}

function fixtureDescriptor(seatDir: string, definitionId: string): DiscoveredAgentPackageDescriptor {
  return {
    rootDir: resolve(TEMP_FLEET_PERSONAS_ROOT, seatDir),
    manifest: {
      boring: { agent: { definitionId, version: "1.0.0", instructionsRef: "instructions.md" } },
      pi: { skills: [] },
    },
    preflight: { ok: true },
  }
}

/**
 * Composes the eval-only temp fleet (factory-smoke, creator-growth) from
 * fixtures under evals/factory/fixtures/. Never touches the real,
 * trust-class-B `.agents/factory/fleet.yaml`.
 */
export async function composeTempFleet(): Promise<ComposedFleet> {
  const result = await loadConfiguredAgentFleet({
    discoveredPackages: [
      fixtureDescriptor("factory-smoke", "boring-factory-smoke"),
      fixtureDescriptor("creator-growth", "boring-creator-growth"),
    ],
    workspaceRoot: TEMP_FLEET_ROOT,
    fleetConfigPath: TEMP_FLEET_CONFIG_PATH,
    policyPath: TEMP_FLEET_POLICY_PATH,
    env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "eval-placeholder-key" },
  })
  return result
}

/**
 * Composes the real repository fleet exactly as the production/playground
 * boot path does (apps/workspace-playground/src/server/factoryAgents.ts):
 * `.agents/factory/fleet.yaml` + `.agents/factory/policy.yaml` +
 * `.agents/personas/`, discovered from disk.
 */
export async function composeRealFleet(): Promise<ComposedFleet> {
  const discoveredPackages = await discoverRepositoryAgentPackages(REPOSITORY_ROOT)
  const result = await loadConfiguredAgentFleet({
    discoveredPackages,
    workspaceRoot: REPOSITORY_ROOT,
    fleetConfigPath: REAL_FLEET_CONFIG_PATH,
    policyPath: REAL_FLEET_POLICY_PATH,
    skillsRoot: REAL_SKILLS_ROOT,
    env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "eval-placeholder-key" },
  })
  return result
}

export function isConfiguredAgent(
  agent: AgentHostAgentSpec,
): agent is Exclude<AgentHostAgentSpec, { legacyDefault: true }> {
  return !("legacyDefault" in agent)
}
