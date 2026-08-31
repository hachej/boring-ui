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

`pnpm build` copies those procedure resources byte-for-byte into `dist/resources`
and writes a SHA-256 manifest. Generated resources are package output and must not
be edited directly.

## Trusted host composition

```ts
import { resolveBoringFactoryResources } from '@hachej/boring-factory/server'

const resources = resolveBoringFactoryResources()
```

The embedding app may compile `resources.agentSources` into an allowlisted internal
fleet and project `resources.skillRoot` only to the addressed Worker runtime. The app
continues to own seats, `/loop`, sandbox tools, reviewer/dispatch capabilities,
providers, credentials, quotas, and activation policy.

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
