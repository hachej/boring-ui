# Boring Plugin Build — Operational Snippets

Copy-paste snippets for the two plugin paths.

---

## 1. Runtime/generated plugin

### Scaffold

```bash
boring-ui scaffold-plugin <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"
```

### Verify

```bash
boring-ui verify-plugin <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"
```

### Reload reminder

Tell the user:

```txt
Run /reload now so the workspace re-scans the plugin.
```

---

## 2. App-local package plugin manifest

Minimal `package.json`:

```json
{
  "name": "my-plugin",
  "version": "0.0.0",
  "private": true,
  "boring": {
    "label": "My Plugin",
    "front": "front/index.tsx",
    "server": "server/index.ts"
  },
  "pi": {
    "systemPrompt": "Use My Plugin when relevant."
  }
}
```

---

## 3. Register package plugin through app manifest

In the app `package.json`:

```json
{
  "boring": {
    "defaultPluginPackages": [
      "./src/plugins/my-plugin"
    ]
  }
}
```

---

## 4. Static front composition for provider/binding plugins

```tsx
<WorkspaceAgentFront plugins={[myPlugin]} ... />
```

---

## 5. Core server boot for manifest plugin discovery

### Production server

```ts
import path from 'node:path'
import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
} from '@hachej/boring-core/app/server'

const appRoot = appRootFromImportMeta(import.meta.url, 2)
const app = await createCoreWorkspaceAgentServer({
  appRoot,
  appPackageJsonPath: path.join(appRoot, 'package.json'),
  serveFrontend: true,
})

await app.listen({ host: app.config.host, port: app.config.port })
```

### Dev server

```ts
import path from 'node:path'
import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
} from '@hachej/boring-core/app/server'

const appRoot = appRootFromImportMeta(import.meta.url, 2)
await startCoreWorkspaceAgentDevServer({
  appRoot,
  buildServer: ({ appRoot, serveFrontend }) =>
    createCoreWorkspaceAgentServer({
      appRoot,
      serveFrontend,
      appPackageJsonPath: path.join(appRoot, 'package.json'),
    }),
})
```

---

## 6. Core Vercel entry for manifest plugin discovery

```ts
import path from 'node:path'
import {
  createCoreWorkspaceAgentServer,
  createVercelFastifyHandler,
} from '@hachej/boring-core/app/server'

process.env.BORING_AGENT_MODE ??= 'vercel-sandbox'
process.env.BORING_AGENT_WORKSPACE_ROOT ??= '/tmp/boring-workspaces'

const appRoot = process.cwd()

export default createVercelFastifyHandler({
  createServer: () =>
    createCoreWorkspaceAgentServer({
      appRoot,
      workspaceRoot: process.env.BORING_AGENT_WORKSPACE_ROOT,
      appPackageJsonPath: path.join(appRoot, 'package.json'),
      serveFrontend: true,
    }),
})
```

---

## 7. Fast verification commands

```bash
pnpm typecheck
pnpm lint:invariants
```

If you changed trusted server code, tell the user plainly:

```txt
This plugin change needs a server restart/redeploy, not just /reload.
```
