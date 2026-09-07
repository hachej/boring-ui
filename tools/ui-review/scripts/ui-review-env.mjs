import { resolve } from "node:path"

export function uiReviewTempEnvironment(effectiveTempDir) {
  const canonicalTempDir = resolve(effectiveTempDir)
  return { TMPDIR: canonicalTempDir, TMP: canonicalTempDir, TEMP: canonicalTempDir }
}
