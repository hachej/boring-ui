// Keep semantics in sync with @hachej/boring-workspace's filesystemPlugin
// file-search helper. This is intentionally duplicated rather than imported
// across package boundaries so @hachej/boring-agent remains standalone.
export function toFileSearchGlob(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return '*'
  const glob = /[*?\[\]{}]/.test(trimmed) ? trimmed : `*${trimmed}*`
  return toCaseInsensitiveGlob(glob)
}

function toCaseInsensitiveGlob(glob: string): string {
  let out = ''
  let inClass = false
  let escaped = false

  for (const char of glob) {
    if (escaped) {
      out += char
      escaped = false
      continue
    }
    if (char === '\\') {
      out += char
      escaped = true
      continue
    }
    if (char === '[' && !inClass) {
      inClass = true
      out += char
      continue
    }
    if (char === ']' && inClass) {
      inClass = false
      out += char
      continue
    }
    if (!inClass && /[a-z]/i.test(char)) {
      const lower = char.toLowerCase()
      const upper = char.toUpperCase()
      out += lower === upper ? char : `[${upper}${lower}]`
      continue
    }
    out += char
  }

  return out
}
