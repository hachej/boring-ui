# @hachej/boring-governance

Reusable tenant governance wiring for boring-ui apps: YAML policy loading, model filtering, budget metering, company-context bindings, routes, and Company Admin rendering.

## Server wiring

Call `createGovernance(config)` after loading core config and before `createCoreWorkspaceAgentServer` so invalid production policy still refuses boot early.

```ts
const governance = await createGovernance(config)
const credits = buildCreditsWiring()
let appDb: unknown
const app = await createCoreWorkspaceAgentServer({
  config,
  plugins: createAppPlugins([governance.serverPlugin]),
  metering: governance.createMeteringSink(credits.meteringSink, () => appDb as never),
  filterModels: governance.filterModels,
  getFilesystemBindings: governance.getFilesystemBindings(),
  pi: governance.pi,
})
appDb = app.db
credits.attach(app)
```

## Front wiring

```tsx
const governanceCompanyAdmin = createGovernanceCompanyAdmin()

<CoreWorkspaceAgentFront companyAdmin={governanceCompanyAdmin} />
```

Policy source is configured with `BORING_GOVERNANCE_POLICY_PATH`. Company context source roots use `BORING_GOVERNANCE_COMPANY_CONTEXT_ROOT` or the default workspace root resolver outside sandbox mode.

## Policy budgets

Model grants remain the model picker allowlist. Optional user budgets cap aggregate monthly spend across all allowed models; optional per-model budgets cap individual models.

```yaml
users:
  - email: readonly@example.com
    role: user
    budgets:
      monthlyEur: 10
    models:
      - provider: infomaniak
        id: Qwen/Qwen3.5-122B-A10B-FP8
        monthlyBudgetEur: 2
```

A run is admitted only when the user is allowed to use the selected model, the aggregate user budget has remaining monthly capacity, and the selected model budget has remaining monthly capacity.

## Governance access matrix smoke

The package includes a reusable HTTP matrix runner for deployment smoke tests:

```bash
boring-governance-access-matrix
# or from the source package:
pnpm --filter @hachej/boring-governance smoke:governance-matrix
```

It signs in two environment-provided users and verifies the expected read/write behavior for:

- company-context public paths
- company-context Adam-private paths
- each user's own `user` workspace filesystem
- cross-user workspace access denial

All deployment-specific values must be supplied explicitly; the reusable package intentionally does not ship real credentials or workspace IDs.

| Var | Required value |
| --- | --- |
| `MATRIX_BASE_URL` / `DEPLOY_URL` | Deployment base URL |
| `MATRIX_ADAM_EMAIL` | Admin fixture email |
| `MATRIX_ADAM_PASSWORD` | Admin fixture password |
| `MATRIX_ADAM_WORKSPACE_ID` | Admin fixture workspace ID |
| `MATRIX_READONLY_EMAIL` | Readonly fixture email |
| `MATRIX_READONLY_PASSWORD` | Readonly fixture password |
| `MATRIX_READONLY_WORKSPACE_ID` | Readonly fixture workspace ID |
| `MATRIX_COMPANY_PUBLIC_READ_PATH` | Existing public company-context file readable by both users |
| `MATRIX_COMPANY_PRIVATE_READ_PATH` | Existing private company-context file readable by admin and denied to readonly |
| `MATRIX_COMPANY_PUBLIC_WRITE_DIR` | Company-context directory used for admin public write probes |
| `MATRIX_COMPANY_PRIVATE_WRITE_DIR` | Company-context directory used for admin private write probes |
| `MATRIX_ADMIN_COMPANY_WRITE_EXPECTED` | Optional admin company-context write status, defaults to `403` for the base readonly plugin |
| `MATRIX_READONLY_COMPANY_WRITE_EXPECTED` | Optional readonly company-context write status, defaults to `403` |
