// Browser-safe random id generation. `crypto.randomUUID()` is only defined
// in "secure contexts" per the Web Crypto spec — HTTPS, localhost, or file:
// origins. Plain-HTTP access over LAN/Tailscale IPs is NOT a secure context,
// so an unguarded `crypto.randomUUID()` call throws there. Always go through
// this helper instead of calling `crypto.randomUUID()` directly.
//
// This mirrors `safeRandomUUID` in `packages/agent/src/shared/random-id.ts`.
// It is duplicated (rather than imported) because workspace front/shared
// code must have zero value imports from `@hachej/boring-agent`
// (docs/procedures/coding-invariants.md).

/**
 * Returns a v4-shaped UUID using `crypto.randomUUID()` when available
 * (secure contexts), falling back to a `crypto.getRandomValues()`-based
 * RFC 4122 v4 id when `randomUUID` is missing (insecure contexts).
 * Throws rather than generating a predictable id when Web Crypto is unavailable.
 */
export function safeRandomUUID(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()

  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  throw new Error('Secure random UUID generation requires crypto.getRandomValues()')
}
