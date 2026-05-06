import { useCallback, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  LoadingState,
  Notice,
} from '@hachej/boring-ui'
import { useSession } from './AuthProvider.js'
import { apiFetch, apiFetchJson, getHttpErrorDetail, routes } from '../utils.js'
import { WORKSPACES_QUERY_KEY } from '../WorkspaceAuthProvider.js'
import { HttpError } from '../../shared/errors.js'
import type { MemberRole, Workspace } from '../../shared/types.js'

interface ResolveResult {
  workspaceName: string
  role: MemberRole
  expiresAt: string
}

interface AcceptResult {
  workspace: Workspace
  member: { workspaceId: string; userId: string; role: MemberRole }
}

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>()
  const session = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [acceptError, setAcceptError] = useState<string | null>(null)

  const isSignedIn = Boolean(session.data)
  const isSessionPending = session.isPending

  const resolveQuery = useQuery({
    queryKey: ['invite-resolve', token],
    queryFn: () =>
      apiFetchJson<ResolveResult>('/api/v1/invites/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    enabled: Boolean(token) && !isSessionPending && isSignedIn,
    retry: false,
  })

  const acceptMutation = useMutation({
    mutationFn: () =>
      apiFetchJson<AcceptResult>('/api/v1/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
      navigate(`/w/${data.workspace.id}`)
    },
    onError: (err: unknown) => {
      const detail = getHttpErrorDetail(err)
      if (detail.status === 403 || detail.code === 'invite_email_mismatch') {
        setAcceptError('This invite is for a different email. Sign in with that account to accept.')
      } else if (detail.status === 410) {
        setAcceptError('This invite has expired.')
      } else if (detail.status === 429) {
        setAcceptError('Too many attempts. Please wait a minute.')
      } else {
        setAcceptError(detail.message)
      }
    },
  })

  const handleAccept = useCallback(() => {
    setAcceptError(null)
    acceptMutation.mutate()
  }, [acceptMutation])

  const handleDecline = useCallback(() => {
    navigate('/')
  }, [navigate])

  if (isSessionPending) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center">
            <LoadingState data-testid="loading" className="justify-center" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isSignedIn) {
    const signinUrl = `${routes.signin}?redirect=${encodeURIComponent(`/invites/${token}`)}`
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Sign in to accept this invite</CardTitle>
            <CardDescription>
              You need to sign in before you can accept a workspace invite.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button className="w-full" onClick={() => navigate(signinUrl)} data-testid="signin-redirect">
              Sign in
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (resolveQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center">
            <LoadingState data-testid="loading" className="justify-center" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (resolveQuery.error) {
    const detail = getHttpErrorDetail(resolveQuery.error)
    let message: string
    if (detail.status === 404) {
      message = 'This invite is no longer valid. It may have been revoked or never existed.'
    } else if (detail.status === 410) {
      message = 'This invite has expired.'
    } else if (detail.status === 423) {
      message = 'This invite is temporarily locked due to too many failed attempts. Try again later.'
    } else {
      message = detail.message
    }

    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invite unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <Notice data-testid="resolve-error" tone="error" description={message} />
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={() => navigate('/')}>
              Go home
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  const preview = resolveQuery.data
  if (!preview) return null

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>You&apos;ve been invited</CardTitle>
          <CardDescription>
            Join <strong>{preview.workspaceName}</strong> as <strong>{preview.role}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {acceptError && (
            <Notice role="alert" data-testid="accept-error" tone="error" description={acceptError} />
          )}
          <div className="text-sm text-muted-foreground">
            This invite expires on{' '}
            {new Date(preview.expiresAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
        </CardContent>
        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleDecline}
            data-testid="decline-btn"
          >
            Decline
          </Button>
          <Button
            className="flex-1"
            disabled={acceptMutation.isPending}
            onClick={handleAccept}
            data-testid="accept-btn"
          >
            {acceptMutation.isPending ? 'Accepting…' : 'Accept invite'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
