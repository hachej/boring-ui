import type { CreateDataCatalogOutputsOptions } from "@boring/workspace"

export function createSampleCatalogOptions(
  adapter: CreateDataCatalogOutputsOptions["adapter"],
): CreateDataCatalogOutputsOptions {
  return {
    id: "sample",
    label: "Sample",
    adapter,
    catalogId: "sample",
    catalogLabel: "Sample",
  }
}

