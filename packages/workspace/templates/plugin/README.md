# Workspace Plugin Template

Copy this folder into a workspace package or app plugin directory, then delete
the files you do not need. Replace `sample` ids before use.

Expected shape:

```txt
samplePlugin/
  front/
    index.tsx
    panels.tsx
    catalogs.ts
    surfaceResolver.ts
    bindings.tsx
    __tests__/samplePlugin.test.ts
  server/
    index.ts          # trusted Node.js host: routes, DB clients, config
  agent/
    tools/
      sampleTools.ts  # AgentTool[] implementations (pi/sandbox runtime)
    sdk/              # Python SDK installed into agent sandbox (optional)
    transforms/       # Executable/user-editable transforms (optional)
    workspace-template/ # Scaffold copied into workspaces (optional)
    skills/           # Agent skill .md files (optional)
  shared/
    constants.ts
    types.ts
```

## Layer Responsibilities

- `front/` — React UI: panels, catalogs, bindings, surface resolvers.
- `server/` — Trusted Node.js host process only: routes, database clients,
  config loaders. References `agent/` assets via `import.meta.url` URLs in
  `provisioning`. Imports tool factories from `../agent/tools/`.
- `agent/` — Pi/sandbox runtime assets. These run inside the isolated agent
  process, not on the Node.js host. Keep them free of server infrastructure.
  - `tools/` — `AgentTool[]` factories imported by `server/index.ts`.
  - `sdk/` — Python package installed into sandbox via `provisioning.python`.
  - `transforms/` — Executable Python transforms accessible to agent.
  - `workspace-template/` — Workspace seed dirs copied at provision time.
  - `skills/` — Agent skill `.md` files.
- `shared/` — Platform-neutral types, constants, event names. No Node or React.

## Pi Package Adapters

For app-local integrations around pi packages, keep the pi dependency in the
app or wrapper package `package.json`, then put the adaptation code in this
same shape:

- `server/` loads or calls the pi package and contributes routes, provisioning,
  and prompt text through `defineServerPlugin()`.
- `agent/tools/` contributes `AgentTool[]` implementations.
- `front/` contributes the Boring-native panels, catalogs, commands, bindings,
  and surface resolvers.
- `shared/` holds ids, surface kinds, and platform-neutral parameter types.

Do not make the pi package know about Boring. Adapt to the pi package's native
shape, such as `package.json` `pi.extensions` and `pi.registerCommand(...)`.
