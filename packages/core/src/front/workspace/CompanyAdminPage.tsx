import { useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Button } from '@hachej/boring-ui-kit'
import { useCurrentWorkspace, useWorkspaceRole } from '../WorkspaceAuthProvider.js'
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
  const { id } = useParams<{ id: string }>()
  const workspace = useCurrentWorkspace()
  const role = useWorkspaceRole()
  const [activeTab, setActiveTab] = useState<AdminTab>('context')

  const workspaceId = id ?? workspace?.id ?? null
  const workspaceName = workspace?.name ?? 'Current workspace'
  const active = useMemo(
    () => TABS.find((tab) => tab.id === activeTab) ?? TABS[0],
    [activeTab],
  )

  if (!workspaceId) return <Navigate to="/" replace />

  if (role !== 'owner') {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-destructive">Owner access required</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Company admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Only workspace owners can manage company context and model access controls.
          </p>
          <Button asChild className="mt-5">
            <a href={routeHref('workspaceSettings', { id: workspaceId })}>Back to workspace settings</a>
          </Button>
        </section>
      </main>
    )
  }

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

        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 pt-4 sm:px-6">
            <div role="tablist" aria-label="Company admin tabs" className="flex flex-wrap gap-2">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active.id === tab.id}
                  aria-controls={`company-admin-${tab.id}-panel`}
                  id={`company-admin-${tab.id}-tab`}
                  onClick={() => setActiveTab(tab.id)}
                  className="rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition data-[active=true]:border-border data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=false]:border-transparent data-[active=false]:text-muted-foreground data-[active=false]:hover:bg-muted/60"
                  data-active={active.id === tab.id ? 'true' : 'false'}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div
            role="tabpanel"
            id={`company-admin-${active.id}-panel`}
            aria-labelledby={`company-admin-${active.id}-tab`}
            className="p-6"
          >
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6">
              <h2 className="text-xl font-semibold tracking-tight">{active.label}</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{active.description}</p>
              <p className="mt-5 text-sm text-muted-foreground">
                Configuration controls will land in the next stacked PR. This shell establishes the owner-only admin surface and navigation entry point.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
