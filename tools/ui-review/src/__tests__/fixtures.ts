import { createUiReviewStagingPolicy } from "../core/exploration"
import type { UiReviewSpec } from "../core/reviewSpec"
import { workspaceCommandPaletteSpec } from "../review-specs/workspace-command-palette/spec"

export const testSpec: UiReviewSpec = {
  ...workspaceCommandPaletteSpec,
  id: "command-palette",
  specRevision: "command-palette-bombadil-v1",
}

export const testStagingPolicy = createUiReviewStagingPolicy(testSpec)
