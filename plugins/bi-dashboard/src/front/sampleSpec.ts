import type { BslDashboardSpec } from "../shared"

export const sampleBiDashboardSpec: BslDashboardSpec = {
  kind: "boring.generated-pane",
  version: 1,
  profile: "bi-dashboard",
  title: "Semantic Data Overview",
  description: "Dashboard backed by data-bridge SQL query strings.",
  queries: {
    total_people: {
      id: "total_people",
      source: "people-duckdb",
      sql: "SELECT count(*) AS count FROM people",
    },
    people_by_role: {
      id: "people_by_role",
      source: "people-duckdb",
      sql: "SELECT role, count(*) AS count FROM people GROUP BY role ORDER BY count DESC",
    },
    status_by_owner: {
      id: "status_by_owner",
      source: "people-duckdb",
      sql: "SELECT owner, count(*) AS count FROM workspace_status GROUP BY owner ORDER BY count DESC",
    },
    people_detail: {
      id: "people_detail",
      source: "people-duckdb",
      sql: "SELECT role, active, count(*) AS count FROM people GROUP BY role, active ORDER BY count DESC",
    },
  },
  root: "dashboard",
  elements: {
    dashboard: {
      type: "DashboardGrid",
      props: { title: "Workspace Data Overview", columns: 12 },
      children: ["total-people", "people-role", "status-owner", "people-table"],
    },
    "total-people": {
      type: "BSLMetric",
      props: {
        queryId: "total_people",
        valueField: "count",
        label: "People rows",
        format: "number",
      },
    },
    "people-role": {
      type: "BSLChart",
      props: {
        queryId: "people_by_role",
        renderer: "echarts",
        chartType: "bar",
        x: "role",
        y: "count",
        title: "People by role",
      },
    },
    "status-owner": {
      type: "BSLChart",
      props: {
        queryId: "status_by_owner",
        renderer: "echarts",
        chartType: "bar",
        x: "owner",
        y: "count",
        title: "Workspace components by owner",
      },
    },
    "people-table": {
      type: "BSLPerspectiveViewer",
      props: {
        queryId: "people_detail",
        title: "People explorer",
        plugin: "Datagrid",
        columns: ["role", "active", "count"],
        sort: [["count", "desc"]],
      },
    },
  },
}
