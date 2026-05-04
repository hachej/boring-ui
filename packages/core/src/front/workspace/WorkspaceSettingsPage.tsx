import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  IconButton,
  SettingsActionRow as UiSettingsActionRow,
  SettingsNav as UiSettingsNav,
  SettingsPanel as UiSettingsPanel,
  Input,
  Label,
} from '@boring/ui'
import {
  AlertCircle,
  HardDrive,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { useCurrentWorkspace, useWorkspaceRole } from '../WorkspaceAuthProvider.js'
import { WORKSPACES_QUERY_KEY, workspaceQueryKey } from '../WorkspaceAuthProvider.js'
import { apiFetch, apiFetchJson, getHttpErrorDetail } from '../utils.js'
import type { WorkspaceRuntime } from '../../shared/types.js'

export interface WorkspaceSettingsPageProps {
  topBar?: ReactNode
}

const STATE_STYLES: Record<string, string> = {
  pending: 'border-accent/35 bg-[color:var(--accent-soft)] text-foreground',
  ready: 'border-success/35 bg-[color:var(--success-soft)] text-success',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
}

function StateBadge({ state }: { state: string }) {
  return (
    <span
      data-testid={`runtime-state-${state}`}
      className={`inline-flex h-6 items-center rounded-md border px-2 text-[12px] font-medium ${STATE_STYLES[state] ?? 'border-border bg-muted/30 text-muted-foreground'}`}
    >
      {state}
    </span>
  )
}

function SettingsTopBar({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const navigate = useNavigate()
  const workspaceHref = workspaceId ? `/workspace/${encodeURIComponent(workspaceId)}` : '/'
  return (
    <header
      className="relative flex h-[52px] items-center justify-between gap-3 border-b border-border/40 bg-background px-4"
      aria-label="App top bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <IconButton
          type="button"
          variant="default"
          size="icon-xs"
          aria-label="Back to workspace"
          title="Back to workspace"
          onClick={() => navigate(workspaceHref)}
          className="shrink-0 bg-foreground text-[12px] font-semibold text-background hover:bg-foreground/90"
        >
          B
        </IconButton>
        <span className="truncate text-[13px] font-medium tracking-tight text-foreground">
          Boring
        </span>
        <span aria-hidden="true" className="text-muted-foreground/30">/</span>
        <span className="truncate text-[13px] text-muted-foreground">{workspaceName}</span>
        <span aria-hidden="true" className="text-muted-foreground/30">/</span>
        <span className="truncate text-[13px] text-muted-foreground">Settings</span>
      </div>
    </header>
  )
}

function SettingsPageHeader({
  workspaceName,
  workspaceInitial,
  role,
  isDefault,
}: {
  workspaceName: string
  workspaceInitial: string
  role: string | null
  isDefault: boolean
}) {
  return (
    <header className="boring-settings-page-header">
      <div className="boring-settings-context">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground text-[12px] font-semibold text-background">
          {workspaceInitial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">{workspaceName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex h-5 items-center rounded border border-border/60 px-1.5 text-[11px] text-muted-foreground">
              {roleLabel(role)}
            </span>
            {isDefault ? (
              <span className="inline-flex h-5 items-center rounded border border-border/60 px-1.5 text-[11px] text-muted-foreground">
                Default
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="max-w-2xl">
        <p className="text-[11px] font-medium uppercase leading-4 text-muted-foreground">Workspace</p>
        <h1 className="mt-1 text-[20px] font-semibold leading-7 tracking-tight text-foreground">
          Workspace settings
        </h1>
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          Manage workspace identity, runtime recovery, and irreversible workspace actions.
        </p>
      </div>
    </header>
  )
}

function StatusMessage({
  children,
  testId,
}: {
  children: ReactNode
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] leading-5 text-destructive"
    >
      {children}
    </div>
  )
}

function FieldNote({ children }: { children: ReactNode }) {
  return <p className="text-[12px] leading-5 text-muted-foreground">{children}</p>
}

function roleLabel(role: string | null): string {
  if (!role) return 'Loading role'
  return role.charAt(0).toUpperCase() + role.slice(1)
}

const WORKSPACE_NAV_ITEMS = [
  { href: '#general', label: 'General', description: 'Name and access' },
  { href: '#runtime', label: 'Runtime', description: 'Provisioning state' },
  { href: '#danger-zone', label: 'Danger zone', description: 'Permanent actions' },
]

export function WorkspaceSettingsPage({ topBar }: WorkspaceSettingsPageProps = {}) {
  const workspace = useCurrentWorkspace()
  const role = useWorkspaceRole()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const workspaceId = workspace?.id ?? ''

  const [nameValue, setNameValue] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const displayName = nameValue ?? workspace?.name ?? ''
  const encodedWorkspaceId = encodeURIComponent(workspaceId)

  const runtimeQuery = useQuery({
    queryKey: ['runtime', workspaceId],
    queryFn: async () => {
      try {
        const data = await apiFetchJson<{ runtime: WorkspaceRuntime }>(
          `/api/v1/workspaces/${encodedWorkspaceId}/runtime`,
        )
        return data.runtime
      } catch (err: unknown) {
        const detail = getHttpErrorDetail(err)
        if (detail.status === 404) return null
        throw err
      }
    },
    enabled: workspaceId.length > 0,
  })

  const renameMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiFetch(`/api/v1/workspaces/${encodedWorkspaceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    },
    onSuccess: () => {
      setNameError(null)
      queryClient.invalidateQueries({ queryKey: workspaceQueryKey(workspaceId) })
      queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
      setNameValue(null)
    },
    onError: (err: unknown) => {
      const detail = getHttpErrorDetail(err)
      setNameError(detail.message)
    },
  })

  const retryMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(`/api/v1/workspaces/${encodedWorkspaceId}/runtime/retry`, {
        method: 'POST',
      })
    },
    onSuccess: () => {
      setRetryError(null)
      queryClient.invalidateQueries({ queryKey: ['runtime', workspaceId] })
    },
    onError: (err: unknown) => {
      const detail = getHttpErrorDetail(err)
      setRetryError(detail.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(`/api/v1/workspaces/${encodedWorkspaceId}`, {
        method: 'DELETE',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
      setDeleteDialogOpen(false)
      navigate('/')
    },
    onError: (err: unknown) => {
      const detail = getHttpErrorDetail(err)
      if (detail.code === 'destroy_failed') {
        setDeleteError(`Destroy failed: ${detail.message}. Try again.`)
      } else if (detail.code === 'provision_failed' || detail.status === 409) {
        setDeleteError(detail.message)
      } else {
        setDeleteError(detail.message)
      }
      setDeleteDialogOpen(false)
    },
  })

  const handleSaveName = useCallback(() => {
    const trimmed = displayName.trim()
    if (!trimmed || trimmed === workspace?.name) return
    renameMutation.mutate(trimmed)
  }, [displayName, workspace?.name, renameMutation])

  const handleDelete = useCallback(() => {
    setDeleteError(null)
    deleteMutation.mutate()
  }, [deleteMutation])

  const runtime = runtimeQuery.data ?? null
  const hasRuntime = runtime !== null && runtimeQuery.isSuccess
  const nameChanged = nameValue !== null && nameValue.trim() !== workspace?.name
  const canEditName = role !== 'viewer'
  const canDeleteWorkspace = role === 'owner' || role === null
  const workspaceName = workspace?.name ?? 'Workspace'
  const workspaceInitial = (workspace?.name?.trim()?.[0] ?? 'W').toUpperCase()
  const topBarNode = topBar === undefined
    ? <SettingsTopBar workspaceId={workspaceId} workspaceName={workspaceName} />
    : topBar
  const navItems = hasRuntime
    ? WORKSPACE_NAV_ITEMS
    : WORKSPACE_NAV_ITEMS.filter((item) => item.href !== '#runtime')

  return (
    <main className="boring-settings-shell">
      {topBarNode}
      <div className="boring-settings-scroll">
        <div className="boring-settings-layout">
          <aside className="boring-settings-sidebar">
            <UiSettingsNav label="Workspace settings" items={navItems} />
          </aside>

          <div className="boring-settings-content space-y-4">
            <SettingsPageHeader
              workspaceName={workspaceName}
              workspaceInitial={workspaceInitial}
              role={role}
              isDefault={Boolean(workspace?.isDefault)}
            />
          <UiSettingsPanel
            id="general"
            icon={<Settings2 className="h-3.5 w-3.5" aria-hidden="true" />}
            title="General"
            description="Keep the workspace name clear enough to scan in menus."
            footer={(
              <>
                {nameChanged ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setNameValue(null)
                      setNameError(null)
                    }}
                    disabled={renameMutation.isPending}
                  >
                    Reset
                  </Button>
                ) : null}
                <Button
                  data-testid="save-name"
                  size="sm"
                  disabled={!nameChanged || renameMutation.isPending || !canEditName}
                  onClick={handleSaveName}
                >
                  {renameMutation.isPending ? 'Saving...' : 'Save changes'}
                </Button>
              </>
            )}
          >
            <div className="space-y-4">
              {nameError && <StatusMessage testId="name-error">{nameError}</StatusMessage>}
              <div className="space-y-2">
                <Label htmlFor="workspace-name" className="text-[12px]">Workspace name</Label>
                <Input
                  id="workspace-name"
                  data-testid="workspace-name-input"
                  className="h-8 text-[13px]"
                  value={displayName}
                  onChange={(e) => setNameValue(e.target.value)}
                  disabled={!canEditName}
                  aria-invalid={nameError ? 'true' : 'false'}
                />
                <FieldNote>
                  {canEditName
                    ? 'Editors and owners can rename a workspace.'
                    : 'Viewers can inspect settings, but cannot rename this workspace.'}
                </FieldNote>
              </div>
            </div>
          </UiSettingsPanel>

          {hasRuntime && (
            <UiSettingsPanel
              id="runtime"
              testId="runtime-card"
              icon={<HardDrive className="h-3.5 w-3.5" aria-hidden="true" />}
              title="Runtime"
              description="Provisioning status for this workspace."
            >
              <div className="space-y-3">
                <div className="flex min-h-10 flex-wrap items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/10 px-3 py-2">
                  <span className="text-[13px] font-medium">State</span>
                  <StateBadge state={runtime.state} />
                </div>
                {runtime.state === 'ready' && runtime.volumePath && (
                  <div
                    data-testid="volume-path"
                    className="space-y-1 rounded-md border border-border/50 bg-muted/10 px-3 py-2"
                  >
                    <p className="text-[13px] font-medium">Volume</p>
                    <code className="block overflow-x-auto whitespace-nowrap text-[12px] text-muted-foreground">
                      {runtime.volumePath}
                    </code>
                  </div>
                )}
                {runtime.state === 'error' && runtime.lastError && (
                  <div
                    data-testid="runtime-error"
                    role="alert"
                    className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] leading-5 text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {runtime.lastError}
                  </div>
                )}
                {runtime.state === 'error' && runtime.lastErrorOp === 'provision' && (
                  <div className="space-y-3">
                    <Button
                      data-testid="retry-provision"
                      variant="outline"
                      size="sm"
                      disabled={retryMutation.isPending}
                      onClick={() => retryMutation.mutate()}
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      {retryMutation.isPending ? 'Retrying...' : 'Retry provisioning'}
                    </Button>
                    {retryError && <StatusMessage testId="retry-error">{retryError}</StatusMessage>}
                  </div>
                )}
                {runtime.state === 'error' && runtime.lastErrorOp === 'destroy' && (
                  <p
                    data-testid="destroy-guidance"
                    className="rounded-md border border-border/50 bg-muted/10 px-3 py-2 text-[13px] leading-5 text-muted-foreground"
                  >
                    Destroy failed. Use the Delete button below to re-issue the delete.
                  </p>
                )}
              </div>
            </UiSettingsPanel>
          )}

          <UiSettingsPanel
            id="danger-zone"
            testId="danger-zone"
            icon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />}
            title="Danger zone"
            description="Permanently delete this workspace and all provisioned data."
            danger
          >
            <div className="space-y-4">
              {deleteError && <StatusMessage testId="delete-error">{deleteError}</StatusMessage>}
              {!canDeleteWorkspace ? (
                <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-2 text-[13px] leading-5 text-muted-foreground">
                  Only workspace owners can delete this workspace.
                </div>
              ) : null}
              <UiSettingsActionRow
                title="Delete workspace"
                description="Delete the workspace record and re-issue cleanup for provisioned runtime data."
                action={(
              <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="delete-workspace"
                  disabled={!canDeleteWorkspace}
                  onClick={() => { setDeleteDialogOpen(true); setDeleteConfirmName('') }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete workspace
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. Type <strong>{workspace?.name}</strong> to confirm.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="px-6 pb-2">
                    <Input
                      data-testid="delete-confirm-input"
                      className="h-8 text-[13px]"
                      placeholder={workspace?.name ?? ''}
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <Button
                      variant="destructive"
                      size="sm"
                      data-testid="confirm-delete"
                      disabled={deleteConfirmName !== workspace?.name || deleteMutation.isPending}
                      onClick={handleDelete}
                    >
                      {deleteMutation.isPending ? 'Deleting...' : 'Delete workspace'}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
                )}
              />
            </div>
          </UiSettingsPanel>
          </div>
        </div>
      </div>
    </main>
  )
}
