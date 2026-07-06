import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@hachej/boring-ui-kit'

export interface GovernancePolicyStatus {
  state: 'disabled' | 'active' | 'invalid'
  reason?: string
  path?: string | null
  message?: string
  tenantId?: string
  userCount?: number
}

export interface GovernanceMeResponse {
  enabled: boolean
  role: 'admin' | 'user' | null
  admin: boolean
  policyStatus?: GovernancePolicyStatus
  tenant?: {
    id: string
    companyContextWorkspaceId: string | null
    defaultMonthlyModelBudgetEur: number
    perRunHoldEur: number
  }
  users?: Array<{
    email: string
    role: 'admin' | 'user'
    modelCount: number
    contextRuleCount: number
  }>
  models?: Array<{
    email: string
    provider: string
    id: string
    monthlyBudgetEur: number
    monthlyBudgetMicros: number
  }>
  companyContextRules?: Array<{ email: string; pattern: string }>
}

export function GovernanceAdminView({ status }: { status: GovernanceMeResponse }) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Company admin</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Tenant governance</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                YAML-managed in v1. Review effective tenant roles, exact model grants, monthly EUR budgets, and company-context rules.
              </p>
            </div>
            <Button asChild variant="outline">
              <a href="/">Back to workspace</a>
            </Button>
          </div>
        </header>

        <section className="grid gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm md:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Policy source</p>
            <p className="mt-2 text-sm font-medium text-foreground">YAML-managed in v1</p>
            <p className="mt-1 text-xs text-muted-foreground">Edit the host policy file and restart to reload.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tenant</p>
            <p className="mt-2 text-sm font-medium text-foreground">{status.tenant?.id ?? status.policyStatus?.tenantId ?? '—'}</p>
            <p className="mt-1 text-xs text-muted-foreground">Role: {status.role ?? 'none'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Policy status</p>
            <p className="mt-2 text-sm font-medium text-foreground">{status.policyStatus?.state ?? 'active'}</p>
            <p className="mt-1 text-xs text-muted-foreground">Tenant invites are deferred/not implemented in v1.</p>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <Tabs defaultValue="context" className="gap-4">
            <TabsList aria-label="Company admin tabs" variant="line" className="flex-wrap justify-start">
              <TabsTrigger value="context">Context access</TabsTrigger>
              <TabsTrigger value="models">Model control</TabsTrigger>
              <TabsTrigger value="users">Users</TabsTrigger>
            </TabsList>

            <TabsContent value="context">
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6">
                <h2 className="text-xl font-semibold tracking-tight">Context access</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Read-only effective company-context path grants from the YAML policy.</p>
                <div className="mt-5 overflow-hidden rounded-lg border border-border bg-background">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/60 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <tr><th className="px-3 py-2 font-medium">User</th><th className="px-3 py-2 font-medium">Allowed pattern</th></tr>
                    </thead>
                    <tbody>
                      {(status.companyContextRules ?? []).length > 0 ? status.companyContextRules!.map((rule, index) => (
                        <tr key={`${rule.email}-${index}`} className="border-t border-border">
                          <td className="px-3 py-2 font-medium">{rule.email}</td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{rule.pattern}</td>
                        </tr>
                      )) : <tr><td colSpan={2} className="px-3 py-4 text-muted-foreground">No company-context rules in policy.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="models">
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6">
                <h2 className="text-xl font-semibold tracking-tight">Model control</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Read-only exact model grants and monthly EUR budgets from the YAML policy.</p>
                <div className="mt-5 overflow-hidden rounded-lg border border-border bg-background">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/60 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <tr><th className="px-3 py-2 font-medium">User</th><th className="px-3 py-2 font-medium">Model</th><th className="px-3 py-2 font-medium">Monthly budget</th></tr>
                    </thead>
                    <tbody>
                      {(status.models ?? []).length > 0 ? status.models!.map((model) => (
                        <tr key={`${model.email}-${model.provider}-${model.id}`} className="border-t border-border">
                          <td className="px-3 py-2 font-medium">{model.email}</td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{model.provider}/{model.id}</td>
                          <td className="px-3 py-2">€{model.monthlyBudgetEur}</td>
                        </tr>
                      )) : <tr><td colSpan={3} className="px-3 py-4 text-muted-foreground">No model grants in policy.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="users">
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6">
                <h2 className="text-xl font-semibold tracking-tight">Users</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Read-only tenant users from the YAML policy. Tenant invites are not implemented in v1.</p>
                <div className="mt-5 overflow-hidden rounded-lg border border-border bg-background">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/60 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <tr><th className="px-3 py-2 font-medium">User</th><th className="px-3 py-2 font-medium">Role</th><th className="px-3 py-2 font-medium">Models</th><th className="px-3 py-2 font-medium">Context rules</th></tr>
                    </thead>
                    <tbody>
                      {(status.users ?? []).length > 0 ? status.users!.map((user) => (
                        <tr key={user.email} className="border-t border-border">
                          <td className="px-3 py-2 font-medium">{user.email}</td>
                          <td className="px-3 py-2">{user.role}</td>
                          <td className="px-3 py-2">{user.modelCount}</td>
                          <td className="px-3 py-2">{user.contextRuleCount}</td>
                        </tr>
                      )) : <tr><td colSpan={4} className="px-3 py-4 text-muted-foreground">No users in policy.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </main>
  )
}
