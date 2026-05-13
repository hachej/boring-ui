# Boring UI Panel Components

Use panels for plugin UI.

## BoringFrontFactory panel registration

```tsx
api.registerProvider({ id: "my-runtime", component: MyProvider })
api.registerBinding({ id: "my-listener", component: MyBinding })
api.registerPanel({ id: "my-panel", label: "My Panel", component: MyPanel })
api.registerLeftTab({ id: "my-tab", title: "My Plugin", panelId: "my-panel", component: MyPanel })
api.registerCatalog({ id: "my-catalog", label: "My Catalog", adapter, onSelect })
```

Panel ids must match `package.json["boring"].panels[].id`. Providers, bindings, and catalogs are supported for statically composed app/core plugins; dynamic hot reload currently uses panels, left tabs, commands, and surface resolvers.

## Pane props

Panel components receive workspace pane props when rendered in direct mode. Read `params` defensively because restored layouts are JSON.

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
