import { afterEach, beforeEach } from "vitest"
import { createUiReviewRunLifecycle, type UiReviewRunLifecycle } from "../../scripts/ui-review-run-lifecycle.mts"
import { createUiReviewStagingPolicy } from "../core/exploration"
import type { UiReviewSpec } from "../core/reviewSpec"
import { workspaceCommandPaletteSpec } from "../review-specs/workspace-command-palette/spec"

export const testSpec: UiReviewSpec = {
  ...workspaceCommandPaletteSpec,
  id: "command-palette",
  specRevision: "command-palette-bombadil-v1",
}

export const testStagingPolicy = createUiReviewStagingPolicy(testSpec)

let testRun: UiReviewRunLifecycle | undefined
beforeEach(async () => { testRun = await createUiReviewRunLifecycle() })
afterEach(async () => {
  const current = testRun
  testRun = undefined
  if (current) await current.shutdown()
})

export async function createTestDirectory(label: string) {
  if (!testRun) throw new Error("UI_REVIEW_TEST_RUN_MISSING")
  return await testRun.allocateDirectory(label)
}
