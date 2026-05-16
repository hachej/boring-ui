# Boring UI Panel Components

Use panels for plugin UI.

## BoringFrontFactory panel registration

```tsx
api.registerProvider({ id: "my-runtime", component: MyProvider })
api.registerBinding({ id: "my-listener", component: MyBinding })
api.registerPanel({ id: "my-panel", label: "My Panel", component: MyPanel })
api.registerPanelCommand({ id: "open-my-panel", title: "Open My Panel", panelId: "my-panel" })
api.registerLeftTab({ id: "my-tab", title: "My Plugin", panelId: "my-panel", component: MyPanel })
api.registerCatalog({ id: "my-catalog", label: "My Catalog", adapter, onSelect })
```

Panel ids are registered at runtime by `BoringFrontFactory`; do not declare
panels in `package.json#boring`. That manifest field is discovery metadata only.
Providers, bindings, and catalogs are supported for statically composed app/core
plugins; dynamic hot reload currently uses panels, left tabs, panel commands,
and surface resolvers.

## Pane props

Panel components receive workspace pane props when rendered in direct mode. Read `params` defensively because restored layouts are JSON. Hot-loaded plugin panels may be normal React function components using hooks; host Vite config is responsible for aliasing/deduping React so plugin hooks use the workspace shell's React singleton.

## Surface resolvers

```ts
api.registerSurfaceResolver({
  kind: "my.open",
  resolve: (request) => ({ component: "my-panel", id: `my:${request.target}` }),
})
```

Return `null`/`undefined` if the resolver cannot handle the request.

## V1 vs V2

- V1 local mode imports `front/index.tsx` directly and renders the React component in the host tree.
- V2 remote mode will load plugin UI through an iframe bundle. Keep `front/index.tsx` browser-only.
