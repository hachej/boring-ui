import { setTimeout as sleep } from "node:timers/promises"
import { createUiReviewTempDir, uiReviewTempRoot } from "../core/tempRoot"

// Child process used by tempRoot.test.ts to prove the run root survives nothing but the process itself.
const root = await uiReviewTempRoot()
await createUiReviewTempDir("child.")
console.log(`UI_REVIEW_TEMP_ROOT:${root}`)
await sleep(30_000)
