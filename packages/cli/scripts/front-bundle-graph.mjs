export function staticManifestImportKeys(chunk) {
  const dynamicImports = new Set(chunk.dynamicImports ?? [])
  return (chunk.imports ?? []).filter((key) => !dynamicImports.has(key))
}

/**
 * Collect generated files reached by genuine static manifest edges.
 * Vite 8 can repeat a dynamic target in `imports` as preload metadata; an edge
 * listed in both fields remains dynamic and must not become pre-chat work.
 */
export function collectStaticImportFiles(manifest, rootKeys) {
  const files = new Set()
  const visitedKeys = new Set()

  function visit(key) {
    if (visitedKeys.has(key)) return
    const chunk = manifest[key]
    if (!chunk) throw new Error(`CLI bundle budget: manifest import ${key} is missing`)
    visitedKeys.add(key)
    files.add(chunk.file)
    for (const importedKey of staticManifestImportKeys(chunk)) visit(importedKey)
  }

  for (const key of rootKeys) visit(key)
  return files
}
