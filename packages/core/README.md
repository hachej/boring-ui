# @hachej/boring-core

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-core.svg)](https://www.npmjs.com/package/@hachej/boring-core)

</div>

The foundation package for boring-ui v2 apps: Postgres/Drizzle database, better-auth
(email/password, verification, password reset, magic links, optional Google), TOML+env
config loader, Fastify HTTP app factory, and a React frontend shell with auth/workspace
gating. Every child app imports core first; domain logic, agent runtime, and workspace UI
come from the sibling `@hachej/boring-*` packages.

```bash
pnpm add @hachej/boring-core
```

## Usage essentials

Most apps use the composed `app/*` surfaces, which fuse core + workspace + agent:

```ts
// server entry
import { createCoreWorkspaceAgentServer } from "@hachej/boring-core/app/server"

const app = await createCoreWorkspaceAgentServer({ plugins })
await app.listen({ port: 3000 })
```

```tsx
// frontend entry
import { createRoot } from "react-dom/client"
import { CoreWorkspaceAgentFront } from "@hachej/boring-core/app/front"
import "@hachej/boring-core/app/front/styles.css"

createRoot(document.getElementById("root")!).render(
  <CoreWorkspaceAgentFront apiBaseUrl="" chatEntryMode="chat-first" plugins={plugins} />,
)
```

For a core-only app (no agent/workspace), use `createCoreApp(config)` from
`@hachej/boring-core/server` and `CoreFront` from `@hachej/boring-core/front`.

### Required environment (production)

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`WORKSPACE_SETTINGS_ENCRYPTION_KEY`, `MAIL_FROM`, `MAIL_TRANSPORT_URL`
(`resend://…`, `smtp://…`, or `console://`), `CORS_ORIGINS`. Config is also read from
`boring.app.toml`. For dev without Postgres, set `CORE_STORES=local` (in-memory, resets
on restart; not supported by `createCoreWorkspaceAgentServer`).

Migrations live in `drizzle/`; run them with `drizzle-kit migrate` against
`drizzle.config.ts`.

## Documentation

See [`docs/README.md`](./docs/README.md) for the architecture overview, public API
surface, key abstractions, and links to the gating, plugin, and deployment docs. The
reference app is [`apps/full-app`](../../apps/full-app/).

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

## License

MIT
