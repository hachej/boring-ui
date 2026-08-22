export const OBJECTIVES_PLUGIN_ID = "objectives" as const
export const OBJECTIVE_PANEL_ID = "objectives.panel" as const
export const OBJECTIVE_PANEL_TITLE = "Objective" as const
export const OBJECTIVE_SURFACE_KIND = "objective" as const

export const OBJECTIVE_STATUSES = ["active", "paused", "achieved", "abandoned"] as const

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
