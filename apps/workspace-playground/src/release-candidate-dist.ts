export function assertReleaseCandidateDistModule(id: string, hook: string): void {
  const normalized = id.split("?", 1)[0].replaceAll("\\", "/")
  if (/\/(packages|plugins)\/[^/]+\/src(?:\/|$)/.test(normalized)) {
    throw new Error(
      `release-candidate dist-only resolution violation: ${hook} loaded ${normalized}`,
    )
  }
}
