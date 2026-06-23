/**
 * Layout mode for the workspace shell.
 *
 * - `single-project`: one project on screen at a time; the workspace switcher is
 *   a dropdown. The left bar shows only the current project's sessions.
 * - `multi-project`: all accessible projects are listed inline in the left bar,
 *   with their sessions nested.
 *
 * This is a LAYOUT/UX choice, not an access-control boundary — see
 * docs/plans/multi-project-left-bar.md §2.1. Bounded access for a tenant is a
 * tenancy/authz concern, not this flag.
 */
export type LayoutMode = 'single-project' | 'multi-project'

/**
 * How a tenant governs the layout mode. `force` pins it (a user cannot widen
 * visibility); `allow` lets the user choose, falling back to `default`.
 */
export type TenantLayoutPolicy =
  | { kind: 'force'; mode: LayoutMode }
  | { kind: 'allow'; default: LayoutMode }

/** Default when a tenant sets no policy: users may choose, defaulting to the
 * focused single-project layout. */
export const DEFAULT_LAYOUT_POLICY: TenantLayoutPolicy = {
  kind: 'allow',
  default: 'single-project',
}

/**
 * Resolve the effective layout mode. The ONE place precedence is decided —
 * consume this everywhere instead of scattering `??` chains.
 */
export function resolveLayoutMode(
  policy: TenantLayoutPolicy,
  userPref?: LayoutMode,
): LayoutMode {
  if (policy.kind === 'force') return policy.mode
  return userPref ?? policy.default
}
