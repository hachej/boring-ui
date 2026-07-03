import { Navigate } from 'react-router-dom'
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@hachej/boring-ui-kit'
import { useCompanyAdminStatus } from '../CompanyAdminProvider.js'
import { useCurrentWorkspace, useWorkspaceRole, useWorkspaceRouteStatus } from '../WorkspaceAuthProvider.js'
import { routeHref } from '../utils.js'

type AdminTab = 'context' | 'models'

const TABS: Array<{ id: AdminTab; label: string; description: string }> = [
  {
    id: 'context',
    label: 'Context access',
    description: 'Control which company context paths each user can read with simple regex allow rules.',
  },
  {
    id: 'models',
    label: 'Model control',
    description: 'Control which models each user can select and the budget allowed per model.',
  },
]

export function CompanyAdminPage() {
  const currentWorkspace = useCurrentWorkspace()
  const role = useWorkspaceRole()
  const routeStatus = useWorkspaceRouteStatus()
  const companyAdmin = useCompanyAdminStatus()

  if (routeStatus.status === 'loading') {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm" aria-busy="true">
          <p className="text-sm text-muted-foreground">Loading company admin…</p>
        </section>
      </main>
    )
  }

  if (routeStatus.status === 'not-found' || routeStatus.status === 'switch-failed' || routeStatus.status === 'mismatched') {
    const message = routeStatus.status === 'mismatched'
      ? 'The requested workspace could not be loaded.'
      : routeStatus.message
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-destructive">Workspace unavailable</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Company admin</h1>
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
  const workspaceName = workspace?.name ?? 'Current workspace'

  if (!workspaceId) return <Navigate to="/" replace />

  const governanceEnabled = companyAdmin.status?.enabled === true

  if (companyAdmin.configured && companyAdmin.loading && !companyAdmin.status) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm" aria-busy="true">
          <p className="text-sm text-muted-foreground">Loading company admin policy…</p>
        </section>
      </main>
    )
  }

  if (companyAdmin.error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-destructive">Company admin unavailable</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Company admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">{companyAdmin.error}</p>
          <Button asChild className="mt-5">
            <a href={routeHref('workspaceSettings', { id: workspaceId })}>Back to workspace settings</a>
          </Button>
        </section>
      </main>
    )
  }

  if (routeStatus.status === 'forbidden' || (governanceEnabled ? companyAdmin.status?.admin !== true : role !== 'owner')) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-destructive">{governanceEnabled ? 'Company admin access required' : 'Owner access required'}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Company admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {governanceEnabled
              ? 'You do not have access to this company admin surface.'
              : 'Only workspace owners can manage company context and model access controls.'}
          </p>
          <Button asChild className="mt-5">
            <a href={routeHref('workspaceSettings', { id: workspaceId })}>Back to workspace settings</a>
          </Button>
        </section>
      </main>
    )
  }

  const renderedAppContent = governanceEnabled && companyAdmin.status && companyAdmin.renderContent
    ? companyAdmin.renderContent(companyAdmin.status)
    : null

  if (renderedAppContent) return <>{renderedAppContent}</>

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Company admin</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{workspaceName}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Manage user access to company context and model budgets for this workspace.
              </p>
            </div>
            <Button asChild variant="outline">
              <a href={routeHref('workspaceSettings', { id: workspaceId })}>Workspace settings</a>
            </Button>
          </div>
        </header>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <Tabs defaultValue="context" className="gap-4">
            <TabsList aria-label="Company admin tabs" variant="line" className="flex-wrap justify-start">
              {TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {TABS.map((tab) => (
              <TabsContent key={tab.id} value={tab.id}>
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6">
                  <h2 className="text-xl font-semibold tracking-tight">{tab.label}</h2>
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{tab.description}</p>
                  <p className="mt-5 text-sm text-muted-foreground">
                    Configuration controls will land in the next stacked PR. This shell establishes the owner-only admin surface and navigation entry point.
                  </p>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </section>
      </div>
    </main>
  )
}
