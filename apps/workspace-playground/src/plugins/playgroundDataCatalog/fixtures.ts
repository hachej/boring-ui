export interface PlaygroundCsvDataset {
  id: string
  path: string
  table: string
  title: string
  description: string
  source: string
  rows: number
  columns: string[]
}

export const PLAYGROUND_CSV_DATASETS: PlaygroundCsvDataset[] = [
  {
    id: "demo-people",
    path: "data.csv",
    table: "people",
    title: "Demo People",
    description: "Small CSV fixture with user roles and active status.",
    source: "fixtures",
    rows: 5,
    columns: ["id", "name", "role", "active"],
  },
  {
    id: "workspace-status",
    path: "status.csv",
    table: "workspace_status",
    title: "Workspace Status",
    description: "CSV fixture describing demo workspace components.",
    source: "fixtures",
    rows: 3,
    columns: ["id", "name", "status", "owner"],
  },
]
