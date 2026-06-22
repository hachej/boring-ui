import type { BslDashboardSpec } from "../shared"

export const sampleBiDashboardSpec: BslDashboardSpec = {
  kind: "boring.generated-pane",
  version: 1,
  profile: "bi-dashboard",
  title: "Workspace Data Overview",
  description: "Live dashboard backed by the workspace CSV fixtures.",
  queries: {
    total_people: {
      id: "total_people",
      model: "people",
      measures: ["count"],
      dataRef: { kind: "workspace-file", path: "data.csv" },
    },
    people_by_role: {
      id: "people_by_role",
      model: "people",
      groupBy: ["role"],
      measures: ["count"],
      dataRef: { kind: "workspace-file", path: "data.csv" },
    },
    status_by_owner: {
      id: "status_by_owner",
      model: "workspace_status",
      groupBy: ["owner"],
      measures: ["count"],
      dataRef: { kind: "workspace-file", path: "status.csv" },
    },
    people_detail: {
      id: "people_detail",
      model: "people",
      groupBy: ["role", "active"],
      measures: ["count"],
      dataRef: { kind: "workspace-file", path: "data.csv" },
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
