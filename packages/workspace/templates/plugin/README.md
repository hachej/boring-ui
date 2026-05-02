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
    index.ts
  shared/
    constants.ts
    types.ts
```

For app-local integrations around pi packages, keep the pi dependency in the
app or wrapper package `package.json`, then put the adaptation code in this
same shape:

- `server/` loads or calls the pi package and contributes tools, routes,
  provisioning, and prompt text through `defineServerPlugin()`.
- `front/` contributes the Boring-native panels, catalogs, commands, bindings,
  and surface resolvers.
- `shared/` holds ids, surface kinds, and platform-neutral parameter types.

Do not make the pi package know about Boring. Adapt to the pi package's native
shape, such as `package.json` `pi.extensions` and `pi.registerCommand(...)`.
