import type { TelemetrySink } from '../../../shared/telemetry'
import type { BoringAgentRuntimePaths } from '../runtimeLayout'
import type { ProvisioningLogger } from './errors'

export type PluginSkillAccess = 'invisible' | 'readonly' | 'readwrite'

export interface PluginSkillAccessContext {
  userId?: string
  userEmail?: string
  userEmailVerified?: boolean
}

export interface PluginSkillAccessRequest extends PluginSkillAccessContext {
  pluginId: string
  skillName: string
  defaultAccess: PluginSkillAccess
}

export type PluginSkillAccessResolver = (
  request: PluginSkillAccessRequest,
) => PluginSkillAccess | undefined | Promise<PluginSkillAccess | undefined>

export interface PluginSkillSource {
  name: string
  source: string | URL
  /**
   * Controls how a plugin-contributed skill is surfaced in the workspace.
   * Uses the same `access` naming as governance/filesystem bindings.
   *
   * - invisible: do not expose the skill to Pi or the workspace UI.
   * - readonly: mirror into generated .boring-agent/skills; visible but plugin-owned.
   * - readwrite: seed into .agents/skills once; user/workspace-owned after creation.
   *
   * Defaults to readonly for backwards compatibility.
   */
  access?: PluginSkillAccess
}

export interface RuntimeTemplateContribution {
  id: string
  path: string | URL
  target?: string
}

export interface RuntimePythonSpec {
  id: string
  projectFile: string | URL
  packageName?: string
  packageRoot?: string | URL
  version?: string
  extraLibs?: string[]
  env?: Record<string, string | URL>
  expectedBins?: string[]
}

export interface RuntimeNodePackageSpec {
  id: string
  packageName: string
  packageRoot?: string | URL
  version?: string
  expectedBins?: string[]
}

export interface RuntimeProvisioningContribution {
  templateDirs?: RuntimeTemplateContribution[]
  python?: RuntimePythonSpec[]
  nodePackages?: RuntimeNodePackageSpec[]
}

export interface WorkspaceProvisioningResult {
  changed: boolean
  env: Record<string, string>
  pathEntries: string[]
  skillPaths: string[]
  readonlySkillRoots?: string[]
}

export interface WorkspaceProvisioningExecResult {
  stdout?: string
  stderr?: string
}

export interface ResolveInstallSourceOpts {
  kind: 'node' | 'python'
  id: string
  fingerprint: string
}

export interface WorkspaceProvisioningAdapter {
  mode: 'direct' | 'local' | 'vercel-sandbox'

  exec(command: string, args: string[], opts?: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  }): Promise<WorkspaceProvisioningExecResult | void>

  resolveInstallSource(source: string | URL, opts: ResolveInstallSourceOpts): Promise<string>

  workspaceFs: {
    exists(workspaceRelativePath: string): Promise<boolean>
    /** Remove a workspace-relative generated path. Missing path is success. */
    rm(workspaceRelativePath: string): Promise<void>
    /** Create a workspace-relative directory recursively. */
    mkdir(workspaceRelativePath: string): Promise<void>
    writeText(workspaceRelativePath: string, content: string): Promise<void>
    readText(workspaceRelativePath: string): Promise<string | null>
    /** Copy a host file or directory into the workspace; directory copies are recursive. */
    copyFromHost(hostSourcePath: string | URL, workspaceRelativeTarget: string): Promise<void>
  }

  getRuntimeCacheRoot(): string
}

export interface ProvisioningTelemetryContext {
  workspaceId?: string
  sessionId?: string
  requestId?: string
  runtimeMode?: string
}

export interface ProvisionWorkspaceRuntimeOptions {
  plugins: Array<{
    id: string
    skills?: PluginSkillSource[]
    provisioning?: RuntimeProvisioningContribution
  }>
  adapter: WorkspaceProvisioningAdapter
  runtimeLayout: BoringAgentRuntimePaths
  logger?: ProvisioningLogger
  telemetry?: TelemetrySink
  telemetryContext?: ProvisioningTelemetryContext
  skillAccessContext?: PluginSkillAccessContext
  resolvePluginSkillAccess?: PluginSkillAccessResolver
}
