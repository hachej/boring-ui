import { createHash } from "node:crypto"

/** Stable, non-PII runner cell name for one user's profile. */
export function profileAppName(userId: string): string {
  return `profile-${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`
}
