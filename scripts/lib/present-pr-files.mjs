export const CATEGORIES = [
  { id: 'generated', label: 'Generated / lockfiles', color: 'var(--cat-generated)' },
  { id: 'config', label: 'Config / CI', color: 'var(--cat-config)' },
  { id: 'docs', label: 'Docs', color: 'var(--cat-docs)' },
  { id: 'test', label: 'Tests', color: 'var(--cat-test)' },
  { id: 'prod', label: 'Production code', color: 'var(--cat-prod)' },
]

/** Order matters: first match wins, most-specific first. */
export function categorize(file) {
  const p = file.toLowerCase()
  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|cargo\.lock|poetry\.lock|go\.sum)$/.test(p)) return 'generated'
  if (/(^|\/)(dist|build|coverage|__snapshots__|\.beads)(\/|$)/.test(p) || /\.(snap|lock)$/.test(p)) return 'generated'
  if (/(^|\/)(__tests__|__mocks__|__fixtures__|tests?|e2e|spec|fixtures)(\/|$)/.test(p)) return 'test'
  if (/\.(test|spec|e2e)\.[a-z0-9]+$/.test(p)) return 'test'
  if (/(^|\/)(docs?|documentation)(\/|$)/.test(p)) return 'docs'
  if (/(^|\/)readme(?:\.[^/]*)?$/.test(p) || /\.(md|mdx|rst|adoc|txt)$/.test(p)) return 'docs'
  if (/(^|\/)\.github\//.test(p)) return 'config'
  if (/(^|\/)(\.[a-z0-9_.-]+rc(\.[a-z]+)?|[a-z0-9.-]*\.config\.[a-z]+|tsconfig[a-z0-9.-]*\.json|package\.json|dockerfile|.*\.ya?ml|.*\.toml|.*\.ini)$/.test(p)) return 'config'
  return 'prod'
}

/** Tests and docs remain in the review, but are supplemental diagram branches. */
export function isDefaultSankeyCategory(category) {
  return category !== 'test' && category !== 'docs'
}

export function createSankeyRows(files) {
  return files.map((file) => ({
    id: `f${file.index}`,
    path: file.path,
    name: file.path.split('/').pop(),
    cat: file.cat,
    area: file.area,
    pkg: file.pkg,
    add: file.additions,
    del: file.deletions,
    rank: file.rank,
    supplemental: !isDefaultSankeyCategory(file.cat),
  }))
}

export function sankeyRowIsVisible(row, enabledCategories, showSupplemental = false) {
  return enabledCategories[row.cat] && (showSupplemental || !row.supplemental)
}
