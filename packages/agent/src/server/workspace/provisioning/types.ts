import type { BoringAgentRuntimePaths } from '../runtimeLayout'
import type { ProvisioningLogger } from './errors'

export interface PluginSkillSource {
  name: string
  source: string | URL
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
}

export interface WorkspaceProvisioningExecResult {
  stdout?: string
  stderr?: string
}

export interface WorkspaceProvisioningAdapter {
  mode: 'direct' | 'local' | 'vercel-sandbox'

  exec(command: string, args: string[], opts?: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  }): Promise<WorkspaceProvisioningExecResult | void>

  resolveInstallSource(source: string | URL, opts: {
    kind: 'node' | 'python'
    id: string
    fingerprint: string
  }): Promise<string>

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

export interface ProvisionWorkspaceRuntimeOptions {
  plugins: Array<{
    id: string
    skills?: PluginSkillSource[]
    provisioning?: RuntimeProvisioningContribution
  }>
  adapter: WorkspaceProvisioningAdapter
  runtimeLayout: BoringAgentRuntimePaths
  logger?: ProvisioningLogger
}
