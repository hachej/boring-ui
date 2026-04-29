import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@boring/workspace/ui-shadcn'
import { useCurrentWorkspace, useWorkspaceRole } from '../WorkspaceAuthProvider.js'
import { useSession } from '../auth/AuthProvider.js'
import { useWorkspaceMembers } from '../hooks/useWorkspaceMembers.js'
import type { EnrichedMember } from '../hooks/useWorkspaceMembers.js'
import { apiFetch, getHttpErrorDetail } from '../utils.js'
import type { MemberRole } from '../../shared/types.js'

const ROLE_OPTIONS: MemberRole[] = ['owner', 'editor', 'viewer']

export function MembersPage() {
  const workspace = useCurrentWorkspace()
  const myRole = useWorkspaceRole()
  const session = useSession()
  const queryClient = useQueryClient()

  const workspaceId = workspace?.id ?? ''
  const currentUserId = session.data?.user?.id ?? ''

  const membersQuery = useWorkspaceMembers(workspaceId)

  const [toast, setToast] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<EnrichedMember | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }, [])

  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: MemberRole }) => {
      await apiFetch(`/api/v1/workspaces/${workspaceId}/members/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] })
    },
    onError: (err: unknown) => {
      const detail = getHttpErrorDetail(err)
      if (detail.code === 'last_owner') {
        showToast('Cannot demote: workspace would have no owners.')
      } else {
        showToast(detail.message)
      }
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] })
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiFetch(`/api/v1/workspaces/${workspaceId}/members/${userId}`, {
        method: 'DELETE',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] })
      setConfirmTarget(null)
    },
    onError: (err: unknown) => {
      const detail = getHttpErrorDetail(err)
      if (detail.code === 'last_owner') {
        showToast('Cannot remove: workspace would have no owners.')
      } else {
        showToast(detail.message)
      }
      setConfirmTarget(null)
    },
  })

  const handleRoleChange = useCallback(
    (userId: string, newRole: MemberRole) => {
      changeRoleMutation.mutate({ userId, role: newRole })
    },
    [changeRoleMutation],
  )

  const handleRemoveConfirm = useCallback(() => {
    if (!confirmTarget) return
    removeMutation.mutate(confirmTarget.userId)
  }, [confirmTarget, removeMutation])

  const isOwner = myRole === 'owner'

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {workspace?.name ?? 'Workspace'} &middot;{' '}
              {membersQuery.data?.length ?? 0} member
              {(membersQuery.data?.length ?? 0) !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {toast && (
              <div
                role="alert"
                data-testid="toast"
                className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {toast}
              </div>
            )}
            {membersQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {membersQuery.isError && (
              <p className="text-sm text-destructive">Failed to load members.</p>
            )}
            {membersQuery.data && membersQuery.data.length > 0 && (
              <div className="divide-y" data-testid="members-list">
                {membersQuery.data.map((member) => {
                  const isSelf = member.userId === currentUserId
                  const canChangeRole = isOwner && !isSelf
                  const canRemove = isOwner || isSelf

                  return (
                    <div
                      key={member.userId}
                      className="flex items-center justify-between py-3"
                      data-testid={`member-row-${member.userId}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {(member.user.name?.[0] ?? member.user.email[0]).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {member.user.name ?? member.user.email}
                            {isSelf && (
                              <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">{member.user.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          data-testid={`role-select-${member.userId}`}
                          value={member.role}
                          disabled={!canChangeRole}
                          onChange={(e) =>
                            handleRoleChange(member.userId, e.target.value as MemberRole)
                          }
                          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs disabled:opacity-50"
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        {canRemove && (
                          <Button
                            variant="destructive"
                            size="sm"
                            data-testid={`remove-${member.userId}`}
                            onClick={() => setConfirmTarget(member)}
                          >
                            {isSelf ? 'Leave' : 'Remove'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <AlertDialog
          open={confirmTarget !== null}
          onOpenChange={(open: boolean) => { if (!open) setConfirmTarget(null) }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmTarget?.userId === currentUserId
                  ? 'Leave workspace?'
                  : `Remove ${confirmTarget?.user.name ?? confirmTarget?.user.email}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmTarget?.userId === currentUserId
                  ? 'You will lose access to this workspace.'
                  : 'This member will lose access to the workspace.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={removeMutation.isPending}
                onClick={handleRemoveConfirm}
                data-testid="confirm-remove"
              >
                {removeMutation.isPending
                  ? 'Removing…'
                  : confirmTarget?.userId === currentUserId
                    ? 'Leave'
                    : 'Remove'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
