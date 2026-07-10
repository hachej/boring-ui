import type { ResolvedPiHarnessOptions } from './harness/pi-coding-agent/createHarness'
import type { WorkspaceProvisioningResult } from './workspace/provisioning'

export function applyGovernedSkillDiscoveryPolicy(
  pi: ResolvedPiHarnessOptions,
): ResolvedPiHarnessOptions {
  const getHotReloadableResources = pi.getHotReloadableResources

  return {
    ...pi,
    noSkills: true,
    additionalSkillPaths: [],
    ...(getHotReloadableResources
      ? {
          getHotReloadableResources: () => {
            const hot = getHotReloadableResources()
            return {
              ...hot,
              additionalSkillPaths: [],
            }
          },
        }
      : {}),
  }
}

export function createDynamicSkillPathResolver(
): {
  get(): string[]
  refresh(result: WorkspaceProvisioningResult | undefined): Promise<void>
} {
  let paths: string[] = []
  return {
    get: () => paths,
    async refresh(result) {
      paths = [...(result?.skillPaths ?? [])]
    },
  }
}
