# @hachej/boring-factory

Trusted, portable Factory identity and procedure resources for Boring applications.
This package is intentionally inert: installing it creates no Agent seat and grants no
Pi extension, skill, tool, provider, credential, or dispatch authority.

## Canonical sources

- Profiles: `agents/factory-orchestrator` and `agents/factory-worker` in this package.
- Worker procedures: repository-canonical `.agents/skills/plan` and
  `.agents/skills/exec`.
- Procedure companions: `.agents/skill-references/plan` and
  `.agents/skill-references/exec`.

`pnpm build` copies those procedures, their direct read-only procedure/reference
closure, and both profiles byte-for-byte into `dist/resources`. The manifest maps
every packaged path to its canonical repository source and SHA-256. Generated
resources are package output and must not be edited directly. Only the top-level
`skills/plan` and `skills/exec` directories are projected as discoverable Worker
skills; bundled support skills and documents remain references, not extra grants.

## Trusted host composition

```ts
import { resolveBoringFactoryResources } from '@hachej/boring-factory/server'

const resources = resolveBoringFactoryResources()
```

The embedding app may compile `resources.agentSources` into an allowlisted internal
fleet and project `resources.skillRoot` only to the addressed Worker runtime. The app
continues to own seats, `/loop`, provider credentials/settings, quotas, and activation policy.

## Server host entry

```ts
import { createFactoryHost } from '@hachej/boring-factory/server'
```

`createFactoryHost({ repositoryRoot, workspaceRoot, epicKey, featureName, stateRoot, env, provider })`
returns `{ agents, plugins, bind(app), rearm(), close() }` for trusted app composition.
The host owns seat specs and appendices, `dispatch_worker`, `fresh_review`, `factory_status`,
durable supervision, and `demo_sandbox`. The embedding app still owns the outer server,
workspace metadata route wiring, provider credentials/settings in `env`, and whether/how to boot.

One stable workspace scope is derived from `epicKey` and is used consistently for delegate,
supervision, demo, and session addressing. App code should not hardcode `factory-playground`
outside playground-specific UI/dev concerns.

Do not add the skill root as a global package default and do not infer authority from
these authored files.

## Private vendoring

No npm publication is required. From an exact reviewed Boring UI commit:

```bash
pnpm --filter @hachej/boring-factory build
pnpm --filter @hachej/boring-factory pack --pack-destination <trusted-output-dir>
```

The consuming private app commits the tarball, its source commit, and its SHA-256,
then installs it through a frozen `file:` dependency.
