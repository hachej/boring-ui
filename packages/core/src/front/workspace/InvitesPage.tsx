import { useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
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
import { useCurrentWorkspace, useWorkspaceRole } from '../WorkspaceAuthProvider.js'
import { apiFetch, apiFetchJson, getHttpErrorDetail } from '../utils.js'
import type { WorkspaceInvite, MemberRole } from '../../shared/types.js'
import { HttpError } from '../../shared/errors.js'

function invitesQueryKey(workspaceId: string) {
  return ['invites', workspaceId] as const
}

function generateIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

function getInviteStatus(invite: WorkspaceInvite): 'accepted' | 'expired' | 'pending' {
  if (invite.acceptedAt) return 'accepted'
  if (new Date(invite.expiresAt) <= new Date()) return 'expired'
  return 'pending'
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-[color:var(--accent-soft)] text-foreground',
  expired: 'bg-muted text-muted-foreground',
  accepted: 'bg-[color:var(--success-soft)] text-success',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      data-testid={`status-${status}`}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? ''}`}
    >
      {status}
    </span>
  )
}

export function InvitesPage() {
  const workspace = useCurrentWorkspace()
  const role = useWorkspaceRole()
  const queryClient = useQueryClient()

  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MemberRole>('editor')
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const workspaceId = workspace?.id ?? ''
  const encodedWorkspaceId = encodeURIComponent(workspaceId)

  const invitesQuery = useQuery({
    queryKey: invitesQueryKey(workspaceId),
    queryFn: () =>
      apiFetchJson<{ invites: WorkspaceInvite[] }>(
        `/api/v1/workspaces/${encodedWorkspaceId}/invites`,
      ).then((data) => data.invites),
    enabled: workspaceId.length > 0,
  })

  const createMutation = useMutation({
    mutationFn: async ({ email: invEmail, role: invRole }: { email: string; role: MemberRole }) => {
      const idempotencyKey = generateIdempotencyKey()
      const response = await apiFetch(`/api/v1/workspaces/${encodedWorkspaceId}/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ email: invEmail, role: invRole }),
      })
      return response.json() as Promise<{ invite: WorkspaceInvite }>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: invitesQueryKey(workspaceId) })
      setEmail('')
      setInviteRole('editor')
      setFormError(null)
      setSuccessMessage(`Invite sent to ${variables.email}`)
    },
    onError: (err: unknown) => {
      setSuccessMessage(null)
      const detail = getHttpErrorDetail(err)
      setFormError(detail.message)
    },
  })

  const [revokeError, setRevokeError] = useState<string | null>(null)

  const revokeMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      await apiFetch(
        `/api/v1/workspaces/${encodedWorkspaceId}/invites/${encodeURIComponent(inviteId)}`,
        { method: 'DELETE' },
      )
    },
    onSuccess: () => {
      setRevokeError(null)
      queryClient.invalidateQueries({ queryKey: invitesQueryKey(workspaceId) })
    },
    onError: (err: unknown) => {
      const detail = getHttpErrorDetail(err)
      setRevokeError(detail.message)
    },
  })

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      setFormError(null)
      setSuccessMessage(null)

      const trimmed = email.trim()
      if (!trimmed) {
        setFormError('Email is required')
        return
      }

      createMutation.mutate({ email: trimmed, role: inviteRole })
    },
    [email, inviteRole, createMutation],
  )

  if (role !== 'owner') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>Only workspace owners can manage invites.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Invite a member</CardTitle>
            <CardDescription>
              Send an invite to join {workspace?.name ?? 'this workspace'}.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit} data-testid="invite-form">
            <CardContent className="space-y-4">
              {formError && (
                <div role="alert" className="text-sm text-destructive">
                  {formError}
                </div>
              )}
              {successMessage && (
                <div role="status" className="text-sm text-success">
                  {successMessage}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  data-testid="invite-role-select"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as MemberRole)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                className="w-full"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'Sending…' : 'Send invite'}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>
              {invitesQuery.data?.length
                ? `${invitesQuery.data.length} invite${invitesQuery.data.length === 1 ? '' : 's'}`
                : 'No invites yet'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {revokeError && (
              <div role="alert" className="mb-4 text-sm text-destructive">
                {revokeError}
              </div>
            )}
            {invitesQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {invitesQuery.isError && (
              <p className="text-sm text-destructive">Failed to load invites.</p>
            )}
            {invitesQuery.data && invitesQuery.data.length > 0 && (
              <div className="divide-y" data-testid="invites-list">
                {invitesQuery.data.map((invite) => {
                  const status = getInviteStatus(invite)
                  return (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between py-3"
                      data-testid={`invite-row-${invite.id}`}
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{invite.email}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{invite.role}</span>
                          <StatusBadge status={status} />
                          <span>
                            expires{' '}
                            {new Date(invite.expiresAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      {status === 'pending' && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={revokeMutation.isPending}
                          onClick={() => revokeMutation.mutate(invite.id)}
                          data-testid={`revoke-${invite.id}`}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
