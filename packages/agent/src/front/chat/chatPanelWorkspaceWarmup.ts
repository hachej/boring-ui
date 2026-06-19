import { ErrorCode } from '../../shared/error-codes'

export type ChatPanelRuntimeDependenciesWarmupStatus = {
  state: 'preparing' | 'ready' | 'failed'
  message?: string
  requirement?: string
}

export type ChatPanelWorkspaceWarmupStatus =
  | { status: 'preparing'; requirement?: 'workspace-fs' | 'sandbox-exec' | 'ui-bridge'; message?: string; runtimeDependencies?: ChatPanelRuntimeDependenciesWarmupStatus }
  | { status: 'ready'; runtimeDependencies?: ChatPanelRuntimeDependenciesWarmupStatus }
  | { status: 'failed'; requirement?: 'workspace-fs' | 'sandbox-exec' | 'ui-bridge'; message?: string; runtimeDependencies?: ChatPanelRuntimeDependenciesWarmupStatus }

export interface ComposerStatusNotice {
  title: string
  detail?: string
  code?: string
}

export function composerNoticeForWarmup(status: ChatPanelWorkspaceWarmupStatus | undefined): ComposerStatusNotice | null {
  if (!status || status.status === 'ready') return null
  if (status.status === 'failed') {
    return {
      title: 'Workspace setup failed.',
      detail: status.message ?? 'Reload the workspace and try again.',
      code: ErrorCode.enum.RUNTIME_PROVISIONING_FAILED,
    }
  }
  return {
    title: 'Preparing workspace...',
    code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
  }
}

export function composerNoticeForRuntimeDependencies(status: ChatPanelWorkspaceWarmupStatus | undefined): ComposerStatusNotice | null {
  const runtime = status?.runtimeDependencies
  if (!runtime || runtime.state === 'ready') return null
  if (runtime.state === 'failed') {
    return {
      title: 'Runtime tools failed to prepare.',
      detail: runtime.message ?? 'Chat still works, but dependency-backed tools may be unavailable.',
      code: ErrorCode.enum.RUNTIME_PROVISIONING_FAILED,
    }
  }
  return null
}
