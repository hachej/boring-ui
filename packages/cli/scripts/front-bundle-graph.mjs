export function staticManifestImportKeys(chunk) {
  return chunk.imports ?? []
}

/** Collect generated files reached by every mandatory manifest import edge. */
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
