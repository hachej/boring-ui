/**
 * @boring/workspace/app — composed app-shell helpers.
 *
 * This entry owns APIs that intentionally compose workspace UI behavior with
 * server-side agent wiring. Browser-only workspace exports stay in the root
 * package; lower-level Node primitives stay under `@boring/workspace/server`.
 */
export {
  createWorkspaceAgentApp,
  type CreateWorkspaceAgentAppOptions,
} from "./createWorkspaceAgentApp"
