/**
 * @boring/workspace/shared — types only, no runtime imports.
 *
 * Importable from BOTH the front bundle (browser) AND the server bundle
 * (Node) without dragging in the wrong runtime. Strict isolation rule
 * (build-enforced via scripts/assert-bundle-isolation.mjs): no imports
 * from `../server/**`, `../components/**`, `../front/**`, or any
 * runtime package.
 */
export type { UiBridge, UiState, UiCommand, CommandResult } from "./ui-bridge"
