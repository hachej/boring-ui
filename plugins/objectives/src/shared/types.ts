import type { OBJECTIVE_STATUSES } from "./constants"

/** Owner-ratified kernel noun. See AGENTS.md vocabulary constraint. */
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number]

/**
 * Thin Goal primitive. Vocabulary is owner-ratified: "objective", never
 * "goal"/"investigation"/"action".
 */
export interface Objective {
  id: string
  title: string
  /** The objective statement — what "done" means. */
  objective: string
  metric: string
  baseline: number
  target: number
  current: number
  status: ObjectiveStatus
  constraints: string[]
  evidenceRefs: string[]
  outcome?: string
  createdAt: string
  updatedAt: string
}

export type CreateObjectiveInput = {
  title: string
  objective: string
  metric: string
  baseline: number
  target: number
  current?: number
  status?: ObjectiveStatus
  constraints?: string[]
  evidenceRefs?: string[]
  outcome?: string
}

export type UpdateObjectiveInput = {
  id: string
  title?: string
  objective?: string
  metric?: string
  baseline?: number
  target?: number
  current?: number
  status?: ObjectiveStatus
  constraints?: string[]
  evidenceRefs?: string[]
  outcome?: string
}
