# @hachej/boring-bi-dashboard

BI dashboard plugin primitives for Boring workspace.

This package is the host-side home for the BSL dashboard UX:

- prompt/agent output should target a neutral `boring.generated-pane` JSON contract with `profile: "bi-dashboard"`
- the plugin renders approved dashboard components in boring-ui
- BSL owns semantic queries and artifacts
- the plugin maps components to ECharts/Perspective/json-render runtimes

Current scope is an initial plugin shell and typed dashboard contract. The actual BSL server bridge, Perspective viewer runtime, ECharts runtime, and json-render adapter should be layered behind the same component schema.

## Panel

The plugin registers:

- panel: `bi-dashboard.panel`
- command: `bi-dashboard.open`

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
BORING_EXTERNAL_PLUGINS=1 \
BORING_AGENT_WORKSPACE_ROOT="$PWD/plugins/bi-dashboard/example" \
pnpm --filter workspace-playground dev
```

Run the authoring eval through the plugin-local playground runner:

```bash
pnpm --filter @hachej/boring-bi-dashboard playground:eval
```

The runner checks that the agent writes a dashboard file and validates the generated JSON with `parseDashboardSpec`.

See `playground/README.md` for full playground commands.
