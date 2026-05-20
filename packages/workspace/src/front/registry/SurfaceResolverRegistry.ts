// Backwards-compatible re-export. The implementation lives in
// `shared/plugins/SurfaceResolverRegistry` — it has no React/browser
// dependencies and is consumed by both shared/ tests and front/
// providers.
export { SurfaceResolverRegistry } from "../../shared/plugins/SurfaceResolverRegistry"
