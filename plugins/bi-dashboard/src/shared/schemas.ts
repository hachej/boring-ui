import { z } from "zod"

export const chartRenderers = ["echarts", "vega-lite", "plotly"] as const
export const chartTypes = ["bar", "line", "area", "scatter", "heatmap", "pie", "treemap", "sunburst", "gauge", "table"] as const
export const perspectivePlugins = ["Datagrid", "Y Bar", "X Bar", "Y Line", "Y Area", "Y Scatter", "Y Treemap", "Sunburst", "Heatmap"] as const
export const metricFormats = ["number", "currency", "percent"] as const
export const filterControlTypes = ["select", "multiSelect", "dateRange", "numberRange", "search"] as const
export const sortDirections = ["asc", "desc"] as const

export const dashboardDataRefSchema = z.object({
  kind: z.literal("workspace-file"),
  path: z.string().min(1),
  limit: z.number().int().safe().min(1).max(10000).optional(),
})

export const bslFilterExpressionSchema = z.object({
  field: z.string(),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "between"]),
  value: z.unknown(),
})

export const dashboardQuerySchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  query: z.string().min(1).optional(),
  groupBy: z.array(z.string()).optional(),
  measures: z.array(z.string()).optional(),
  dimensions: z.array(z.string()).optional(),
  filters: z.array(bslFilterExpressionSchema).optional(),
  orderBy: z.array(z.tuple([z.string(), z.enum(sortDirections)])).optional(),
  limit: z.number().int().safe().min(1).optional(),
  dataRef: dashboardDataRefSchema.optional(),
})

export const dashboardGridPropsSchema = z.object({
  title: z.string().optional(),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(12)]).optional(),
})

export const bslMetricPropsSchema = z.object({
  queryId: z.string(),
  valueField: z.string(),
  label: z.string(),
  format: z.enum(metricFormats).optional(),
})

export const bslChartPropsSchema = z.object({
  queryId: z.string(),
  title: z.string().optional(),
  renderer: z.enum(chartRenderers).optional(),
  chartType: z.enum(chartTypes),
  x: z.string().optional(),
  y: z.union([z.string(), z.array(z.string())]).optional(),
  color: z.string().optional(),
  controls: z.array(z.string()).optional(),
})

export const bslPerspectiveViewerPropsSchema = z.object({
  queryId: z.string(),
  title: z.string().optional(),
  plugin: z.enum(perspectivePlugins).optional(),
  columns: z.array(z.string()).optional(),
  groupBy: z.array(z.string()).optional(),
  splitBy: z.array(z.string()).optional(),
  sort: z.array(z.tuple([z.string(), z.enum(sortDirections)])).optional(),
})

export const bslFilterPropsSchema = z.object({
  id: z.string(),
  field: z.string(),
  label: z.string().optional(),
  controlType: z.enum(filterControlTypes),
  targetQueries: z.array(z.string()),
})

export const bslTextPropsSchema = z.object({
  markdown: z.string(),
})

export const componentPropsSchemas = {
  DashboardGrid: dashboardGridPropsSchema,
  BSLMetric: bslMetricPropsSchema,
  BSLChart: bslChartPropsSchema,
  BSLPerspectiveViewer: bslPerspectiveViewerPropsSchema,
  BSLFilter: bslFilterPropsSchema,
  BSLText: bslTextPropsSchema,
} as const

export type DashboardGridProps = z.infer<typeof dashboardGridPropsSchema>
export type BslMetricProps = z.infer<typeof bslMetricPropsSchema>
export type BslChartProps = z.infer<typeof bslChartPropsSchema>
export type BslPerspectiveViewerProps = z.infer<typeof bslPerspectiveViewerPropsSchema>
export type BslFilterProps = z.infer<typeof bslFilterPropsSchema>
export type BslTextProps = z.infer<typeof bslTextPropsSchema>
export type BslDashboardQuerySpec = z.infer<typeof dashboardQuerySchema>
export type BslFilterExpression = z.infer<typeof bslFilterExpressionSchema>
