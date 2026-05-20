// Backwards-compatible re-export. The implementation lives in
// `shared/plugins/CommandRegistry` — it has no React/browser
// dependencies and is consumed by both shared/ tests and front/
// providers.
export { CommandRegistry } from "../../shared/plugins/CommandRegistry"
