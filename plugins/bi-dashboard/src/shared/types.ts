import type { GeneratedPaneElementSpec, GeneratedPaneSpec } from "@hachej/boring-generated-pane/shared"
import type {
  BslChartProps,
  BslDashboardQuerySpec,
  BslFilterProps,
  BslMetricProps,
  BslPerspectiveViewerProps,
  BslTableProps,
  BslTextProps,
  DashboardGridProps,
} from "./schemas"

export type {
  BslChartProps,
  BslDashboardQuerySpec,
  BslFilterProps,
  BslMetricProps,
  BslPerspectiveViewerProps,
  BslTableProps,
  BslTextProps,
  DashboardGridProps,
} from "./schemas"

export type BslChartRenderer = BslChartProps["renderer"]
export type BslChartType = BslChartProps["chartType"]
export type PerspectiveViewerPlugin = BslPerspectiveViewerProps["plugin"]

export interface BiDashboardSpec extends Omit<GeneratedPaneSpec, "profile" | "queries" | "elements"> {
  profile: "bi-dashboard"
  queries: Record<string, BslDashboardQuerySpec>
  elements: Record<string, BiDashboardElementSpec>
}

export type BslDashboardSpec = BiDashboardSpec
export type BslDashboardComponentSpec = BiDashboardElementSpec

export type BiDashboardElementSpec =
  | DashboardGridSpec
  | BslMetricSpec
  | BslChartSpec
  | BslPerspectiveViewerSpec
  | BslTableSpec
  | BslFilterControlSpec
  | BslTextSpec

interface BaseElementSpec extends GeneratedPaneElementSpec {
  props: Record<string, unknown>
}

export interface DashboardGridSpec extends BaseElementSpec {
  type: "DashboardGrid"
  props: DashboardGridProps
  children: string[]
}

export interface BslMetricSpec extends BaseElementSpec {
  type: "BSLMetric"
  props: BslMetricProps
  children?: []
}

export interface BslChartSpec extends BaseElementSpec {
  type: "BSLChart"
  props: BslChartProps
  children?: []
}

export interface BslPerspectiveViewerSpec extends BaseElementSpec {
  type: "BSLPerspectiveViewer"
  props: BslPerspectiveViewerProps
  children?: []
}

export interface BslTableSpec extends BaseElementSpec {
  type: "BSLTable"
  props: BslTableProps
  children?: []
}

export interface BslFilterControlSpec extends BaseElementSpec {
  type: "BSLFilter"
  props: BslFilterProps
  children?: []
}

export interface BslTextSpec extends BaseElementSpec {
  type: "BSLText"
  props: BslTextProps
  children?: []
}
