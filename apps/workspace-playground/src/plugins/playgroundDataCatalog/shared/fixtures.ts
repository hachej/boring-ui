export interface PlaygroundCsvDataset {
  table: string
  path: string
  title: string
  description: string
  columns: string[]
}

export const PLAYGROUND_CSV_DATASETS: PlaygroundCsvDataset[] = [
  {
    table: "people",
    path: "data.csv",
    title: "People",
    description: "Small CSV fixture with names, roles, and active status.",
    columns: ["id", "name", "role", "active"],
  },
  {
    table: "workspace_status",
    path: "status.csv",
    title: "Workspace Status",
    description: "CSV fixture describing demo workspace components.",
    columns: ["id", "name", "status", "owner"],
  },
]
