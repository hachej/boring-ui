import { Navigate } from 'react-router-dom'
import { Button } from '@hachej/boring-ui-kit'
import { useCompanyAdminStatus } from '../CompanyAdminProvider.js'
import { useCurrentWorkspace, useWorkspaceRouteStatus } from '../WorkspaceAuthProvider.js'
import { routeHref } from '../utils.js'

const DEFAULT_PAGE_TITLE = 'Admin'
const DEFAULT_DENIED_MESSAGE = 'You do not have access to this page.'

export function CompanyAdminPage() {
  const currentWorkspace = useCurrentWorkspace()
  const routeStatus = useWorkspaceRouteStatus()
  const companyAdmin = useCompanyAdminStatus()
  const pageTitle = companyAdmin.labels.pageTitle ?? DEFAULT_PAGE_TITLE
  const deniedMessage = companyAdmin.labels.deniedMessage ?? DEFAULT_DENIED_MESSAGE

  if (!companyAdmin.configured) return <Navigate to="/" replace />

  if (routeStatus.status === 'loading') {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm" aria-busy="true">
          <p className="text-sm text-muted-foreground">Loading admin…</p>
        </section>
      </main>
    )
  }

  if (companyAdmin.configured && companyAdmin.loading && !companyAdmin.status) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm" aria-busy="true">
          <p className="text-sm text-muted-foreground">Loading admin status…</p>
        </section>
      </main>
    )
  }

  if (companyAdmin.error) {
    const workspace = routeStatus.status === 'matched' ? routeStatus.workspace : currentWorkspace
    const workspaceId = routeStatus.workspaceId ?? workspace?.id ?? null

    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-destructive">Admin unavailable</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{pageTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{companyAdmin.error}</p>
          {workspaceId ? (
            <Button asChild className="mt-5">
              <a href={routeHref('workspaceSettings', { id: workspaceId })}>Back to workspace settings</a>
            </Button>
          ) : (
            <Button asChild className="mt-5">
              <a href="/">Back to workspace</a>
            </Button>
          )}
        </section>
      </main>
    )
  }

  if (!companyAdmin.status || companyAdmin.status.enabled !== true) return <Navigate to="/" replace />

  if (routeStatus.status === 'not-found' || routeStatus.status === 'switch-failed' || routeStatus.status === 'mismatched') {
    const message = routeStatus.status === 'mismatched'
      ? 'The requested workspace could not be loaded.'
      : routeStatus.message
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-destructive">Workspace unavailable</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{pageTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <Button asChild className="mt-5">
            <a href="/">Back to workspace</a>
          </Button>
        </section>
      </main>
    )
  }

  const workspace = routeStatus.status === 'matched' ? routeStatus.workspace : currentWorkspace
  const workspaceId = routeStatus.workspaceId ?? workspace?.id ?? null

  if (!workspaceId) return <Navigate to="/" replace />

  if (routeStatus.status === 'forbidden' || companyAdmin.status.admin !== true) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-destructive">Access required</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{pageTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{deniedMessage}</p>
          <Button asChild className="mt-5">
            <a href={routeHref('workspaceSettings', { id: workspaceId })}>Back to workspace settings</a>
          </Button>
        </section>
      </main>
    )
  }

  const renderedAppContent = companyAdmin.renderContent
    ? companyAdmin.renderContent(companyAdmin.status)
    : null

  return renderedAppContent ? <>{renderedAppContent}</> : null
}
