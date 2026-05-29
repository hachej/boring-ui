import {
  BORING_AGENT_DIR,
  BORING_AGENT_GITIGNORE_CONTENT,
  BORING_AGENT_RUNTIME_DIR_NAMES,
  getBoringAgentPathEntries,
  getBoringAgentRuntimeEnv,
} from '../runtimeLayout'
import { ErrorCode, logProvisioning, toProvisioningError, type ProvisioningLogger } from './errors'
import type { ErrorCode as ErrorCodeValue } from '../../../shared/error-codes'
import { safeCapture } from '../../../shared/telemetry'
import { ensureNodeRuntime } from './node'
import { ensurePythonRuntime } from './python'
import { mirrorPluginSkills } from './skills'
import { seedWorkspaceFiles } from './workspaceFiles'
import type {
  ProvisionWorkspaceRuntimeOptions,
  RuntimeNodePackageSpec,
  RuntimePythonSpec,
  WorkspaceProvisioningResult,
} from './types'

async function ensureRuntimeLayout(
  opts: ProvisionWorkspaceRuntimeOptions,
): Promise<boolean> {
  let changed = false
  const dirs = [
    BORING_AGENT_DIR,
    ...BORING_AGENT_RUNTIME_DIR_NAMES.map((dir) => `${BORING_AGENT_DIR}/${dir}`),
  ]

  for (const dir of dirs) {
    if (!(await opts.adapter.workspaceFs.exists(dir))) changed = true
    await opts.adapter.workspaceFs.mkdir(dir)
  }

  const gitignorePath = `${BORING_AGENT_DIR}/.gitignore`
  const currentGitignore = await opts.adapter.workspaceFs.readText(gitignorePath)
  if (currentGitignore !== BORING_AGENT_GITIGNORE_CONTENT) {
    await opts.adapter.workspaceFs.writeText(gitignorePath, BORING_AGENT_GITIGNORE_CONTENT)
    changed = true
  }

  return changed
}

function collectNodePackages(plugins: ProvisionWorkspaceRuntimeOptions['plugins']): RuntimeNodePackageSpec[] {
  return plugins.flatMap((plugin) => plugin.provisioning?.nodePackages ?? [])
}

function collectPythonPackages(plugins: ProvisionWorkspaceRuntimeOptions['plugins']): RuntimePythonSpec[] {
  return plugins.flatMap((plugin) => plugin.provisioning?.python ?? [])
}

function countSkills(plugins: ProvisionWorkspaceRuntimeOptions['plugins']): number {
  return plugins.reduce((count, plugin) => count + (plugin.skills?.length ?? 0), 0)
}

function countTemplateDirs(plugins: ProvisionWorkspaceRuntimeOptions['plugins']): number {
  return plugins.reduce((count, plugin) => count + (plugin.provisioning?.templateDirs?.length ?? 0), 0)
}

function changedString(result: unknown): 'true' | 'false' | undefined {
  const changed = (result as { changed?: unknown } | null)?.changed
  return typeof changed === 'boolean' ? changed ? 'true' : 'false' : undefined
}

function telemetryProperties(
  opts: ProvisionWorkspaceRuntimeOptions,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    runtimeMode: opts.telemetryContext?.runtimeMode ?? opts.adapter.mode,
    workspaceId: opts.telemetryContext?.workspaceId,
    sessionId: opts.telemetryContext?.sessionId,
    requestId: opts.telemetryContext?.requestId,
    ...extra,
  }
}

function captureProvisioningEvent(
  opts: ProvisionWorkspaceRuntimeOptions,
  name: string,
  properties?: Record<string, unknown>,
): void {
  if (!opts.telemetry) return
  safeCapture(opts.telemetry, {
    name,
    properties: telemetryProperties(opts, properties),
  })
}

async function runPhase<T>(options: {
  opts: ProvisionWorkspaceRuntimeOptions
  logger: ProvisioningLogger | undefined
  phase: string
  telemetryPhase: string
  code: ErrorCodeValue
  details?: Record<string, unknown>
  run: () => Promise<T>
}): Promise<T> {
  const startedAt = Date.now()
  logProvisioning(options.logger, 'info', `workspace provisioning ${options.phase} started`, options.details)
  try {
    const result = await options.run()
    const changed = changedString(result)
    captureProvisioningEvent(options.opts, 'agent.runtime.provisioning.step', {
      phase: options.telemetryPhase,
      status: 'ok',
      durationMs: Date.now() - startedAt,
      ...(changed ? { changed } : {}),
    })
    logProvisioning(options.logger, 'info', `workspace provisioning ${options.phase} completed`, options.details)
    return result
  } catch (error) {
    const provisioningError = toProvisioningError(
      options.code,
      options.phase,
      error,
      options.details,
    )
    captureProvisioningEvent(options.opts, 'agent.runtime.provisioning.step', {
      phase: options.telemetryPhase,
      status: 'error',
      durationMs: Date.now() - startedAt,
      errorCode: provisioningError.code,
    })
    logProvisioning(options.logger, 'error', `workspace provisioning ${options.phase} failed`, {
      code: provisioningError.code,
      ...provisioningError.details,
    })
    throw provisioningError
  }
}

export async function provisionWorkspaceRuntime(
  opts: ProvisionWorkspaceRuntimeOptions,
): Promise<WorkspaceProvisioningResult> {
  const logger = opts.logger
  const startedAt = Date.now()
  const pluginIds = opts.plugins.map((plugin) => plugin.id)
  const nodePackages = collectNodePackages(opts.plugins)
  const pythonPackages = collectPythonPackages(opts.plugins)
  const summaryCounts = {
    nodePackageCount: nodePackages.length,
    pythonPackageCount: pythonPackages.length,
    skillCount: countSkills(opts.plugins),
    templateDirCount: countTemplateDirs(opts.plugins),
  }
  captureProvisioningEvent(opts, 'agent.runtime.provisioning.started', {
    status: 'started',
    ...summaryCounts,
  })

  try {
    const layoutChanged = await runPhase({
      opts,
      logger,
      phase: 'layout',
      telemetryPhase: 'layout',
      code: ErrorCode.enum.PROVISIONING_LAYOUT_FAILED,
      details: { workspaceRoot: opts.runtimeLayout.workspaceRoot },
      run: () => ensureRuntimeLayout(opts),
    })
    const skills = await runPhase({
      opts,
      logger,
      phase: 'skill mirror',
      telemetryPhase: 'skills-mirror',
      code: ErrorCode.enum.PROVISIONING_SKILLS_FAILED,
      details: { workspaceRoot: opts.runtimeLayout.workspaceRoot, pluginIds },
      run: () => mirrorPluginSkills({
        plugins: opts.plugins,
        adapter: opts.adapter,
        runtimeLayout: opts.runtimeLayout,
      }),
    })
    const workspaceFiles = await runPhase({
      opts,
      logger,
      phase: 'workspace files',
      telemetryPhase: 'workspace-files',
      code: ErrorCode.enum.PROVISIONING_TEMPLATES_FAILED,
      details: { workspaceRoot: opts.runtimeLayout.workspaceRoot, pluginIds },
      run: () => seedWorkspaceFiles({
        plugins: opts.plugins,
        adapter: opts.adapter,
      }),
    })
    const node = await runPhase({
      opts,
      logger,
      phase: 'node packages',
      telemetryPhase: 'node-packages',
      code: ErrorCode.enum.PROVISIONING_NPM_INSTALL_FAILED,
      details: { workspaceRoot: opts.runtimeLayout.workspaceRoot, packageIds: nodePackages.map((pkg) => pkg.id) },
      run: () => ensureNodeRuntime({
        adapter: opts.adapter,
        runtimeLayout: opts.runtimeLayout,
        packages: nodePackages,
      }),
    })
    const python = await runPhase({
      opts,
      logger,
      phase: 'python packages',
      telemetryPhase: 'python-packages',
      code: ErrorCode.enum.PROVISIONING_UV_INSTALL_FAILED,
      details: { workspaceRoot: opts.runtimeLayout.workspaceRoot, packageIds: pythonPackages.map((pkg) => pkg.id) },
      run: () => ensurePythonRuntime({
        adapter: opts.adapter,
        runtimeLayout: opts.runtimeLayout,
        packages: pythonPackages,
        // Provider-neutral seam: a deploy/provider (e.g. Vercel Node runtime) may
        // export the explicit uv path since it is not on the non-interactive exec
        // PATH. Unset for direct/local — they fall back to bare `uv`.
        explicitUvBin: process.env.BORING_AGENT_UV_BIN?.trim() || undefined,
      }),
    })

    const result = {
      changed: layoutChanged
        || skills.changed
        || workspaceFiles.changed
        || node.changed
        || python.changed,
      env: {
        ...getBoringAgentRuntimeEnv(opts.runtimeLayout, opts.adapter.getRuntimeCacheRoot()),
        ...python.env,
      },
      pathEntries: getBoringAgentPathEntries(opts.runtimeLayout),
      skillPaths: skills.skillPaths,
    }
    captureProvisioningEvent(opts, 'agent.runtime.provisioning.completed', {
      status: 'ok',
      durationMs: Date.now() - startedAt,
      changed: result.changed ? 'true' : 'false',
      ...summaryCounts,
    })
    return result
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    captureProvisioningEvent(opts, 'agent.runtime.provisioning.failed', {
      status: 'error',
      durationMs: Date.now() - startedAt,
      ...(typeof code === 'string' ? { errorCode: code } : {}),
      ...summaryCounts,
    })
    throw error
  }
}
