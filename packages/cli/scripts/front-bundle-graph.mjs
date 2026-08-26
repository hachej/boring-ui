export function staticManifestImportKeys(chunk) {
  return chunk.imports ?? []
}

/** Collect generated JS and CSS reached by every mandatory manifest import edge. */
export function collectStaticImportResources(manifest, rootKeys) {
  const jsFiles = new Set()
  const cssFiles = new Set()
  const visitedKeys = new Set()

  function visit(key) {
    if (visitedKeys.has(key)) return
    const chunk = manifest[key]
    if (!chunk) throw new Error(`CLI bundle budget: manifest import ${key} is missing`)
    visitedKeys.add(key)
    jsFiles.add(chunk.file)
    for (const cssFile of chunk.css ?? []) cssFiles.add(cssFile)
    for (const importedKey of staticManifestImportKeys(chunk)) visit(importedKey)
  }

  for (const key of rootKeys) visit(key)
  return { jsFiles, cssFiles }
}

export function collectStaticImportFiles(manifest, rootKeys) {
  return collectStaticImportResources(manifest, rootKeys).jsFiles
}
