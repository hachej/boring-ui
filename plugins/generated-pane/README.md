# @hachej/boring-generated-pane

Generated pane runtime for Boring workspace.

This plugin wraps Vercel Labs `json-render` so agents can write safe JSON pane specs instead of React code. Apps/plugins provide the component catalog; the runtime validates the spec and renders only registered components.

## Spec shape

```json
{
  "kind": "boring.generated-pane",
  "version": 1,
  "profile": "base",
  "title": "Project Status",
  "root": "main",
  "elements": {
    "main": { "type": "Card", "props": { "title": "Status" }, "children": ["body"] },
    "body": { "type": "Text", "props": { "text": "All systems green" } }
  }
}
```

## Boundary

- Agents generate JSON specs.
- Plugins define allowed components and prop schemas.
- Unknown components/props are rejected by the generated-pane vocabulary/catalog.
- Actions are out of scope for generated JSON specs; no generated JavaScript is executed.

## Eval

Run the plugin-local authoring eval and JSON validation from the repo root:

```bash
pnpm --filter @hachej/boring-generated-pane playground:eval
```

The eval checks that the agent writes a `panes/*.pane.json` file and the runner parses it with `parseGeneratedPaneSpec`.

## Extending

Use `defineGeneratedPaneVocabulary` in shared code plus `defineGeneratedPaneProfile` in front code to add app/plugin-specific components, then render with `GeneratedPaneRenderer` or a profile-specific pane.
