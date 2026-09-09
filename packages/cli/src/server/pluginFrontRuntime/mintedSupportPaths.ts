import { isImplicitViteSupportPath } from "./viteSupportUrls.js"

/**
 * Capability ledger for the `__vite/*` support routes.
 *
 * A support path is only serveable once a validated plugin module's transform
 * output actually referenced it ("minted" it). Paths are ref-counted per cache
 * key so evicting one cached module does not revoke a path another still uses.
 */
export class MintedSupportPaths {
  private readonly byCacheKey = new Map<string, string[]>()
  private readonly refCounts = new Map<string, number>()

  constructor(private readonly basePath: string) {}

  record(cacheKey: string, paths: string[]): void {
    this.drop(cacheKey)
    const unique = [...new Set(paths)]
    this.byCacheKey.set(cacheKey, unique)
    for (const path of unique) {
      this.refCounts.set(path, (this.refCounts.get(path) ?? 0) + 1)
    }
  }

  drop(cacheKey: string): void {
    const minted = this.byCacheKey.get(cacheKey)
    if (!minted) return
    this.byCacheKey.delete(cacheKey)
    for (const path of minted) {
      const next = (this.refCounts.get(path) ?? 0) - 1
      if (next <= 0) this.refCounts.delete(path)
      else this.refCounts.set(path, next)
    }
  }

  has(path: string): boolean {
    return isImplicitViteSupportPath(path, this.basePath) || (this.refCounts.get(path) ?? 0) > 0
  }

  clear(): void {
    this.byCacheKey.clear()
    this.refCounts.clear()
  }
}
