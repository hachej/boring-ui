import {
  BORING_AGENT_DIR,
  BORING_AGENT_GITIGNORE_CONTENT,
  BORING_AGENT_RUNTIME_DIR_NAMES,
  getBoringAgentPathEntries,
  getBoringAgentRuntimeEnv,
} from '../runtimeLayout'
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

export async function provisionWorkspaceRuntime(
  opts: ProvisionWorkspaceRuntimeOptions,
): Promise<WorkspaceProvisioningResult> {
  const layoutChanged = await ensureRuntimeLayout(opts)
  const skills = await mirrorPluginSkills({
    plugins: opts.plugins,
    adapter: opts.adapter,
    runtimeLayout: opts.runtimeLayout,
  })
  const workspaceFiles = await seedWorkspaceFiles({
    plugins: opts.plugins,
    adapter: opts.adapter,
  })
  const node = await ensureNodeRuntime({
    adapter: opts.adapter,
    runtimeLayout: opts.runtimeLayout,
    packages: collectNodePackages(opts.plugins),
  })
  const python = await ensurePythonRuntime({
    adapter: opts.adapter,
    runtimeLayout: opts.runtimeLayout,
    packages: collectPythonPackages(opts.plugins),
  })

  return {
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
}
