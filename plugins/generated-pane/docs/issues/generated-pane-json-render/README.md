# Generated pane plugin backed by json-render

## Decision

Create a first-party `@hachej/boring-generated-pane` plugin that gives any workspace a safe, agent-authored UI pane system. It uses Vercel Labs `json-render` as the rendering/catalog substrate and keeps boring-ui as the workspace/security boundary.

## Goals

- Agents generate JSON pane specs, never React/JS.
- Child apps and plugins define distinct component catalogs.
- Specs validate against the active catalog before render.
- BI dashboard is a `profile: "bi-dashboard"` component pack on top of generated-pane, not a parallel `bsl.dashboard` UI DSL.
- Plugin examples/evals/playground live with the plugin, not in the generic workspace playground.

## Non-goals

- Do not make generated-pane a default workspace-playground plugin.
- Do not make `bsl.dashboard` the primary dashboard format unless BSL later needs a portable external contract.
- Do not execute generated functions, inline JavaScript, or arbitrary action handlers from specs.

## Spec shape

```json
{
  "kind": "boring.generated-pane",
  "version": 1,
  "profile": "bi-dashboard",
  "title": "Revenue Overview",
  "root": "main",
  "elements": {
    "main": { "type": "DashboardGrid", "props": { "columns": 12 }, "children": ["chart"] },
    "chart": { "type": "BSLChart", "props": { "queryId": "revenue", "chartType": "line" } }
  },
  "queries": {}
}
```

## Architecture

```txt
@hachej/boring-generated-pane
  - owns boring.generated-pane envelope validation
  - wraps @json-render/core + @json-render/react
  - exposes defineGeneratedPaneProfile(...)
  - provides safe base components
  - provides generic GeneratedPanePane/GeneratedPaneRenderer

@hachej/boring-bi-dashboard
  - depends on generated-pane
  - contributes a bi-dashboard profile/catalog:
    DashboardGrid, BSLMetric, BSLChart, BSLPerspectiveViewer, BSLFilter, BSLText
  - owns dashboard query loading and data bridge binding
  - keeps dashboard examples/evals/playground under plugins/bi-dashboard
```

## Safety boundary

- `json-render` validates the renderable `root/elements` tree against the catalog.
- Boring validates the outer envelope (`kind`, `version`, `profile`, acyclic ids, plugin-specific query invariants).
- Component implementations are real React components authored by trusted plugins/apps.
- Generated specs cannot import modules or execute code.
- Future action components must route through explicit WorkspaceBridge allowlists.

## Child app extension model

A child app defines a profile/catalog with its own components, for example:

```ts
defineGeneratedPaneProfile({
  id: "seneca",
  label: "Seneca",
  components: {
    StudentCard,
    AssignmentList,
    GradeTrendChart,
  },
})
```

The agent sees only the active catalog/profile instructions, and the renderer rejects unknown components/props.

## Implementation steps

1. Add `plugins/generated-pane` package with json-render dependencies, base profile, renderer, generic panel, skill, example, and playground docs.
2. Convert BI dashboard specs from `kind: bsl.dashboard` + `components` to `kind: boring.generated-pane`, `profile: bi-dashboard`, and `elements`.
3. Replace BI dashboard's hand-rolled recursive renderer with `GeneratedPaneRenderer` plus a dashboard profile.
4. Keep BI dashboard query/data bridge logic in BI dashboard; generated-pane remains domain-neutral.
5. Keep all examples/evals/playground helpers inside plugin folders.
6. Run focused package gates for generated-pane, data-bridge, and bi-dashboard.

## Acceptance

- PR diff remains plugin-scoped except lockfile.
- `@hachej/boring-generated-pane` typechecks/builds.
- BI dashboard renders through generated-pane/json-render.
- BI dashboard sample/tests use `boring.generated-pane` + `profile: bi-dashboard` + `elements`.
- No workspace-playground default plugin wiring is added.
- Thermo review finds no structural blocker.
