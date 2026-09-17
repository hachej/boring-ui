import { createHash } from "node:crypto"

const PROFILE_PREFIX = "profile-"

/** Stable, non-PII runner cell name for one user's profile. */
export function profileAppName(userId: string): string {
  return `${PROFILE_PREFIX}${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`
}

export function isProfileAppName(appName: string): boolean {
  return appName.startsWith(PROFILE_PREFIX)
}
