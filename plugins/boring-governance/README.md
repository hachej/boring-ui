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
