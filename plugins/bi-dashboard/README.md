# @hachej/boring-bi-dashboard

BI dashboard plugin primitives for Boring workspace.

This package is the host-side home for the BSL dashboard UX:

- prompt/agent output should target a neutral `boring.generated-pane` JSON contract with `profile: "bi-dashboard"`
- the plugin renders approved dashboard components in boring-ui
- data-bridge owns query execution and adapters
- the plugin maps dashboard components to generated-pane, data-bridge, and Perspective runtimes

Current scope includes the generated-pane BI profile, structured validation, JSON/Arrow data-bridge query execution, and Perspective-backed dashboard charts/tables.

## Panel

The plugin registers:

- panel: `bi-dashboard.panel`
- command: `bi-dashboard.open`

## Custom dashboard catalogs

`DashboardCatalogPane` lets hosts reuse the dashboard browser for server-backed or virtual dashboards instead of
materializing every dashboard as a workspace file. Provide a stable adapter and map each row to either file-path or
in-memory-spec panel parameters:

```tsx
const adapter = useMemo(() => ({
  search: ({query, limit, offset, signal}) =>
    fetchDashboardCatalog({query, limit, offset, signal}),
}), [])

return <DashboardCatalogPane {...sourceProps} adapter={adapter} />
```

The pane owns loading, cancellation, grouping, badges, refresh, pagination, and panel opening. The built-in
`DashboardFilesPane` uses the same component with its filesystem-backed adapter, so existing plugin behavior is
unchanged.

## Dashboard contract

Agents should generate specs shaped like:

```json
{
  "kind": "boring.generated-pane",
  "profile": "bi-dashboard",
  "version": 1,
  "title": "Revenue Overview",
  "queries": {
    "revenue_by_month": {
      "id": "revenue_by_month",
      "model": "orders",
      "query": "sm.group_by(\"month\").aggregate(\"revenue\").order_by(\"month\")"
    }
  },
  "root": "dashboard",
  "elements": {
    "dashboard": {
      "type": "DashboardGrid",
      "props": { "columns": 12 },
      "children": ["revenue-line"]
    },
    "revenue-line": {
      "type": "BSLChart",
      "props": {
        "queryId": "revenue_by_month",
        "renderer": "echarts",
        "chartType": "line",
        "x": "month",
        "y": "revenue"
      }
    }
  }
}
```

## Example and playground

Example workspace fixtures live in `example/`:

- `example/data/people.csv`
- `example/dashboards/people.dashboard.json`
- `example/eval/bi-dashboard.yaml`

Run the plugin through the existing workspace playground without making it a default playground plugin:

```bash
pnpm --filter @hachej/boring-bi-dashboard playground:dev
```

Run the authoring eval through the plugin-local playground runner:

```bash
pnpm --filter @hachej/boring-bi-dashboard playground:eval
```

The runner checks that the agent writes a dashboard file and validates the generated JSON with `parseDashboardSpec`.

See `playground/README.md` for full playground commands.
