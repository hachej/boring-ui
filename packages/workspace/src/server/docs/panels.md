# Boring UI Panel Components

Use panels for plugin UI.

## BoringFrontFactory panel registration

```tsx
api.registerPanel({ id: "my-panel", label: "My Panel", component: MyPanel })
api.registerLeftTab({ id: "my-tab", title: "My Plugin", panelId: "my-panel", component: MyPanel })
```

Panel ids must match `package.json["boring"].panels[].id`.

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
