export const RELEASE_CANDIDATE_AGENT_CSS_MIN_BYTES = 100_000

export function assertReleaseCandidateAgentCss(
  url: string,
  contentType: string | undefined,
  byteLength: number,
): void {
  const pathname = decodeURIComponent(new URL(url).pathname).replaceAll("\\", "/")
  if (!pathname.includes("/packages/agent/dist/front/styles.css")) {
    throw new Error(`release-candidate Agent stylesheet did not load from dist: ${pathname}`)
  }
  if (pathname.includes("/packages/agent/src/")) {
    throw new Error(`release-candidate Agent stylesheet loaded from source: ${pathname}`)
  }
  if (!/^text\/css(?:;|$)/i.test(contentType ?? "")) {
    throw new Error(`release-candidate Agent stylesheet has wrong MIME: ${contentType ?? "missing"}`)
  }
  if (byteLength <= RELEASE_CANDIDATE_AGENT_CSS_MIN_BYTES) {
    throw new Error(
      `release-candidate Agent stylesheet is too small: ${byteLength} bytes (must be > ${RELEASE_CANDIDATE_AGENT_CSS_MIN_BYTES})`,
    )
  }
}
