/**
 * Shared types for the macro frontend's series consumers (ChartCanvasPane,
 * DeckPane, and any future pane). Both panes hit the same
 * `/api/macro/series/:id` endpoint; without these shared types they
 * silently disagreed on metadata fields (`SeriesPayload.metadata` was
 * narrower in DeckPane than in ChartCanvasPane).
 */

export interface Observation {
  date: string
  value: number | null
}

export interface SeriesMetadata {
  id: string
  title: string
  units?: string | null
  frequency?: string | null
  source?: string | null
  seasonal_adjustment?: string | null
  observation_start?: string | null
  observation_end?: string | null
  observation_count?: number | null
  transform_name?: string | null
  transform_file?: string | null
  notes?: string | null
}

export interface SeriesPayload {
  observations: Observation[]
  metadata: SeriesMetadata | null
}
