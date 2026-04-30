import { useCallback, useState } from 'react'
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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@boring/workspace/ui-shadcn'
import { useCurrentWorkspace } from '../WorkspaceAuthProvider.js'
import { WORKSPACES_QUERY_KEY, workspaceQueryKey } from '../WorkspaceAuthProvider.js'
import { apiFetch, apiFetchJson, getHttpErrorDetail } from '../utils.js'
import type { WorkspaceRuntime } from '../../shared/types.js'

const STATE_STYLES: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ready: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

function StateBadge({ state }: { state: string }) {
  return (
    <span
      data-testid={`runtime-state-${state}`}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLES[state] ?? ''}`}
    >
      {state}
    </span>
  )
}

export function WorkspaceSettingsPage() {
  const workspace = useCurrentWorkspace()
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

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>Workspace settings for {workspace?.name ?? 'this workspace'}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {nameError && (
              <div data-testid="name-error" role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {nameError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                data-testid="workspace-name-input"
                value={displayName}
                onChange={(e) => setNameValue(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              data-testid="save-name"
              disabled={!nameChanged || renameMutation.isPending}
              onClick={handleSaveName}
            >
              {renameMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </CardFooter>
        </Card>

        {hasRuntime && (
          <Card data-testid="runtime-card">
            <CardHeader>
              <CardTitle>Runtime</CardTitle>
              <CardDescription>Provisioning status for this workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">State:</span>
                <StateBadge state={runtime.state} />
              </div>
              {runtime.state === 'ready' && runtime.volumePath && (
                <div data-testid="volume-path">
                  <span className="text-sm font-medium">Volume: </span>
                  <code className="text-sm">{runtime.volumePath}</code>
                </div>
              )}
              {runtime.state === 'error' && runtime.lastError && (
                <div data-testid="runtime-error" role="alert" className="text-sm text-destructive">
                  {runtime.lastError}
                </div>
              )}
              {runtime.state === 'error' && runtime.lastErrorOp === 'provision' && (
                <>
                  <Button
                    data-testid="retry-provision"
                    variant="outline"
                    disabled={retryMutation.isPending}
                    onClick={() => retryMutation.mutate()}
                  >
                    {retryMutation.isPending ? 'Retrying…' : 'Retry'}
                  </Button>
                  {retryError && (
                    <div data-testid="retry-error" role="alert" className="text-sm text-destructive">
                      {retryError}
                    </div>
                  )}
                </>
              )}
              {runtime.state === 'error' && runtime.lastErrorOp === 'destroy' && (
                <p data-testid="destroy-guidance" className="text-sm text-muted-foreground">
                  Destroy failed. Use the Delete button below to re-issue the delete.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card data-testid="danger-zone">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>Permanently delete this workspace and all its data.</CardDescription>
          </CardHeader>
          <CardContent>
            {deleteError && (
              <div data-testid="delete-error" role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {deleteError}
              </div>
            )}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <Button
                variant="destructive"
                data-testid="delete-workspace"
                onClick={() => { setDeleteDialogOpen(true); setDeleteConfirmName('') }}
              >
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
                    placeholder={workspace?.name ?? ''}
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <Button
                    variant="destructive"
                    data-testid="confirm-delete"
                    disabled={deleteConfirmName !== workspace?.name || deleteMutation.isPending}
                    onClick={handleDelete}
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
