// Backwards-compatible re-export. The implementation lives in
// `shared/plugins/CatalogRegistry` — it has no React/browser
// dependencies and is consumed by both shared/ tests and front/
// providers. See DECISIONS.md / packages/workspace docs for the
// layer-agnostic registries rationale.
export { CatalogRegistry } from "../../shared/plugins/CatalogRegistry"
export type { CatalogRegistryOptions } from "../../shared/plugins/CatalogRegistry"
