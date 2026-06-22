import type { BashOperations } from '@mariozechner/pi-coding-agent'

import type { Sandbox } from '../../../shared/sandbox'
import type { Workspace } from '../../../shared/workspace'
import type { RuntimeProvisioningOptions } from '../../runtime/env'
import {
  VERCEL_SANDBOX_REMOTE_ROOT,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
} from '../../workspace/createVercelSandboxWorkspace'
import { remoteSandboxBashOps } from './remoteSandbox'
import {
  remoteWorkspaceEditOps,
  remoteWorkspaceFindOps,
  remoteWorkspaceLsOps,
  type RemoteWorkspacePathOptions,
  remoteWorkspaceReadOps,
  remoteWorkspaceWriteOps,
} from './remoteWorkspace'

const VERCEL_SANDBOX_LEGACY_ROOT = '/vercel/sandbox'
export const VERCEL_SAFE_DEFAULT_PATH = '/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/usr/local/bin:/usr/bin:/bin'

function vercelPathOptions(workspace?: Workspace): RemoteWorkspacePathOptions {
  const rootAliases = []
  // Accept the Vercel SDK's former internal root as a backwards-compatible
  // input alias, but never display it back to the model/user.
  if (!workspace || workspace.root === VERCEL_SANDBOX_WORKSPACE_ROOT) rootAliases.push(VERCEL_SANDBOX_LEGACY_ROOT)
  if (workspace?.root === VERCEL_SANDBOX_LEGACY_ROOT) rootAliases.push(VERCEL_SANDBOX_WORKSPACE_ROOT)
  return {
    rootAliases,
    toRemotePath(value) {
      if (value === VERCEL_SANDBOX_LEGACY_ROOT) return VERCEL_SANDBOX_REMOTE_ROOT
      if (value.startsWith(`${VERCEL_SANDBOX_LEGACY_ROOT}/`)) {
        return `${VERCEL_SANDBOX_REMOTE_ROOT}${value.slice(VERCEL_SANDBOX_LEGACY_ROOT.length)}`
      }
      return value
    },
    toRuntimePath(value) {
      if (value === VERCEL_SANDBOX_LEGACY_ROOT) return VERCEL_SANDBOX_WORKSPACE_ROOT
      if (value.startsWith(`${VERCEL_SANDBOX_LEGACY_ROOT}/`)) {
        return `${VERCEL_SANDBOX_WORKSPACE_ROOT}${value.slice(VERCEL_SANDBOX_LEGACY_ROOT.length)}`
      }
      return value
    },
    sanitizeErrorText(value) {
      return value.replaceAll(VERCEL_SANDBOX_LEGACY_ROOT, VERCEL_SANDBOX_WORKSPACE_ROOT)
    },
  }
}

export function vercelBashOps(sandbox: Sandbox, opts: {
  mergeEnv?: (env: Record<string, string | undefined> | undefined) => Record<string, string | undefined> | undefined
  runtime?: RuntimeProvisioningOptions
  executionRuntimeEnv?: Record<string, string>
} = {}): BashOperations {
  return remoteSandboxBashOps(sandbox, {
    ...opts,
    defaultPath: VERCEL_SAFE_DEFAULT_PATH,
  })
}

export function vercelReadOps(workspace: Workspace) {
  return remoteWorkspaceReadOps(workspace, vercelPathOptions(workspace))
}

export function vercelWriteOps(workspace: Workspace) {
  return remoteWorkspaceWriteOps(workspace, vercelPathOptions(workspace))
}

export function vercelEditOps(workspace: Workspace) {
  return remoteWorkspaceEditOps(workspace, vercelPathOptions(workspace))
}

export function vercelFindOps(sandbox: Sandbox, workspace?: Workspace) {
  return remoteWorkspaceFindOps(sandbox, workspace, vercelPathOptions(workspace))
}

export function vercelLsOps(workspace: Workspace) {
  return remoteWorkspaceLsOps(workspace, vercelPathOptions(workspace))
}
