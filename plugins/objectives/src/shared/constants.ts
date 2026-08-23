export const OBJECTIVES_PLUGIN_ID = "objectives" as const
export const OBJECTIVE_PANEL_ID = "objectives.panel" as const
export const OBJECTIVE_PANEL_TITLE = "Objective" as const
export const OBJECTIVE_SURFACE_KIND = "objective" as const

export const OBJECTIVE_STATUSES = ["active", "paused", "achieved", "abandoned"] as const

/**
 * Canonical, server-generated Objective id shape: `obj-<uuid>`, matching
 * `generateObjectiveId()`'s `` `obj-${randomUUID()}` `` output exactly.
 * Enforced on load (`ObjectiveSchema`), not just on generation — a stored
 * record whose id predates this format (or was hand-crafted) is skipped
 * rather than trusted as a Map key.
 */
export const OBJECTIVE_ID_PATTERN = /^obj-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const OBJECTIVE_SCHEMA_LIMITS = {
  maxTitleLength: 200,
  maxObjectiveLength: 4_000,
  maxMetricLength: 200,
  maxOutcomeLength: 4_000,
  maxConstraints: 50,
  maxConstraintLength: 500,
  maxEvidenceRefs: 100,
  maxEvidenceRefLength: 500,
} as const

/**
 * Aggregate serialized-Objective size cap. Kept safely under the 32 KiB
 * WorkspaceBridge output envelope (`objectiveBridgeHandlers.ts`'s
 * `MAX_OBJECTIVE_BYTES`) so a schema-valid Objective can never become
 * unreadable through the bridge/pane. Per-field limits above bound
 * individual fields but not the sum; this bounds the sum.
 */
export const OBJECTIVE_MAX_AGGREGATE_BYTES = 24 * 1024

export const OBJECTIVE_MAX_CLIENT_REQUEST_ID_LENGTH = 128
