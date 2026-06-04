# Generated Runtime Plugin Design-System Plan

## Problem

Scaffolded/generated runtime plugins currently start from a visually generic pane:

```tsx
function MyPane() {
  return <div style={{ padding: 16 }}>Hello from my-plugin</div>
}
```

That shape is useful for proving hot reload, but it teaches agents the wrong default:

- ad-hoc inline styles instead of boring-ui tokens/components;
- generic "hello world" panels instead of integrated workspace panes;
- no loading/empty/error states;
- no guidance on density, toolbar placement, or pane chrome;
- agents reach for random UI libraries when the built-in design system is enough.

The result is plugins that technically load but feel bolted on.

## Goal

Make generated runtime plugins feel native to boring-ui by default, and teach agents to use `@hachej/boring-ui-kit` plus workspace primitives before inventing UI.

## Design principle

Treat `@hachej/boring-ui-kit` like a host singleton design-system package for runtime plugin fronts:

- plugin code may import it directly;
- plugin package.json should **not** list it as a dependency;
- the loader provides the host copy, same as React/workspace singletons;
- components inherit the app's CSS variables/tokens.

This keeps generated plugins visually integrated without forcing each plugin to install or bundle the design system.

## Teaching strategy

Agents need three layers of instruction, because no single prompt channel is reliable enough:

1. **Scaffold output** — generated `front/index.tsx` starts with a native-looking pane using boring-ui-kit.
2. **Authoring skill** — `boring-plugin-authoring` explains design-system rules and common pane patterns.
3. **System prompt nudge** — short reminder: use scaffold + ui-kit; don't invent ad-hoc inline UI.

The scaffold is the strongest teacher: agents copy what they see.

## Canonical scaffold direction

Replace the "Hello" pane with a minimal but native shell:

```tsx
import React from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Toolbar,
  ToolbarGroup,
} from "@hachej/boring-ui-kit"

function MyPane() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <Toolbar className="border-b">
        <ToolbarGroup>
          <Badge variant="secondary">Runtime plugin</Badge>
        </ToolbarGroup>
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle>My Plugin</CardTitle>
            <CardDescription>
              Replace this pane with the plugin's real workspace UI.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="Nothing to show yet"
              description="Connect data, register a surface resolver, or add actions for this plugin."
              action={<Button size="sm">Primary action</Button>}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

Exact component availability can be adjusted to the current `@hachej/boring-ui-kit` exports, but the pattern should stay:

- full-height pane root;
- optional toolbar/header;
- scrollable content region;
- card/list/table primitives;
- explicit empty/loading/error states;
- no raw `style={{ padding: 16 }}` as the default example.

## Agent authoring rules

Add these to the plugin-authoring skill and prompt docs:

- Use `@hachej/boring-ui-kit` for common UI: `Button`, `IconButton`, `Input`, `Badge`, `Card`, `Tabs`, `Toolbar`, `EmptyState`, `LoadingState`, `ErrorState`, `StatusBadge`, `Separator`, `ScrollArea`.
- Use boring-ui CSS tokens/classes (`bg-background`, `text-foreground`, `border-border`, `text-muted-foreground`, `accent`) instead of hard-coded colors.
- Use `className` + Tailwind utilities; avoid inline styles except dynamic sizing/positioning.
- Match pane layout: full-height root, toolbar/header if needed, scrollable body.
- Always include empty/loading/error states for data-driven panes.
- Prefer workspace primitives (`WorkspaceLink`, surface resolvers, `useApiBaseUrl`, `useWorkspaceRequestId`) for workspace actions.
- Do not add `@hachej/boring-ui-kit` to plugin dependencies; it is host-provided.
- Do not install broad UI frameworks for simple controls; only add plugin-local deps when the plugin needs a specialized library (charts, maps, editors, etc.).

## Implementation tasks

- **G1.** Add `@hachej/boring-ui-kit` to the runtime host-singleton/import policy alongside React and workspace packages.
- **G2.** Update `boring-ui-plugin scaffold` canonical `front/index.tsx` template to use boring-ui-kit primitives and native pane layout.
- **G3.** Update `boring-plugin-authoring` skill with design-system rules and a small native-pane example.
- **G4.** Update the compact boring-ui system prompt to tell agents to use the scaffold and `@hachej/boring-ui-kit` instead of ad-hoc UI.
- **G5.** Update verifier diagnostics to warn when generated/runtime plugin fronts import common broad UI libraries for basic controls while not using boring-ui-kit. Keep this as a warning, not a hard error.
- **G6.** Add scaffold tests asserting the generated front imports `@hachej/boring-ui-kit` and does not contain the old `style={{ padding: 16 }}` hello-world pane.
- **G7.** Run the live plugin self-test against a scaffolded plugin to prove the default native pane renders.

## Acceptance

- Newly scaffolded runtime plugins render a native-looking pane without extra user work.
- The scaffold imports `@hachej/boring-ui-kit` from the host singleton surface.
- Agents are explicitly taught to use boring-ui-kit and workspace primitives before adding third-party UI libraries.
- The verifier warns about obvious ad-hoc/generated UI regressions without blocking valid custom designs.
- Existing plugin hot reload/self-test flow still works.

## Non-goals

- No full design review automation.
- No screenshot/visual-diff gate for every generated plugin in this phase.
- No ban on custom CSS or specialized visualization libraries.
- No requirement that publishable package plugins use the runtime scaffold shape.
