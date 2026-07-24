import type { HumanArtifact } from "../../shared/artifacts"
import type { WorkspaceShellCapabilities, WorkspaceShellCapabilityResult } from "../../shared/plugins/workspaceShellCapabilities"

export function openHumanArtifact(
  shell: Pick<WorkspaceShellCapabilities, "openArtifact">,
  artifact: HumanArtifact,
  options?: { sessionId?: string | null },
): WorkspaceShellCapabilityResult {
  return shell.openArtifact({
    type: "surface",
    surfaceKind: artifact.surfaceKind,
    target: artifact.target,
  }, {
    sessionId: options?.sessionId,
    title: artifact.title,
    instanceId: `human-artifact:${artifact.id}`,
  })
}
