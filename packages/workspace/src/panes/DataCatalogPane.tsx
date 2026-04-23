import { lazy, Suspense } from "react"
import { PanelChrome } from "../dock"
import type { DataCatalogProps } from "../components/DataCatalog"

const DataCatalog = lazy(() =>
  import("../components/DataCatalog").then((m) => ({ default: m.DataCatalog })),
)

export type DataCatalogPaneProps = Partial<DataCatalogProps>

export function DataCatalogPane({
  sources = [],
  onSelect,
  className,
}: DataCatalogPaneProps) {
  return (
    <PanelChrome title="Data Sources">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <span className="animate-pulse">Loading...</span>
          </div>
        }
      >
        <DataCatalog sources={sources} onSelect={onSelect} className={className} />
      </Suspense>
    </PanelChrome>
  )
}
