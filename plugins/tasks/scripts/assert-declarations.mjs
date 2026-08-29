import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
const publicTypeEntries = [".", "./front", "./front/descriptor"]

for (const exportName of publicTypeEntries) {
  const typePath = packageJson.exports[exportName]?.types
  if (!typePath || !existsSync(resolve(packageDir, typePath))) {
    throw new Error(`tasks declarations: ${exportName} has no emitted types at ${typePath ?? "<missing>"}`)
  }
}

function declarationFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? declarationFiles(path) : path.endsWith(".d.ts") ? [path] : []
  })
}

function relativeDeclarationExists(importer, specifier) {
  const target = resolve(dirname(importer), specifier)
  if (extname(target) === ".js") return existsSync(target.slice(0, -3) + ".d.ts")
  return existsSync(target) || existsSync(`${target}.d.ts`) || existsSync(join(target, "index.d.ts"))
}

const unresolved = []
for (const declaration of declarationFiles(join(packageDir, "dist"))) {
  const source = readFileSync(declaration, "utf8")
  for (const match of source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
    const specifier = match[1]
    if (specifier.startsWith(".") && !relativeDeclarationExists(declaration, specifier)) {
      unresolved.push(`${declaration.slice(packageDir.length + 1)} -> ${specifier}`)
    }
  }
}

if (unresolved.length > 0) {
  throw new Error(`tasks declarations contain unresolved relative imports:\n${unresolved.join("\n")}`)
}

const broadDeclaration = readFileSync(join(packageDir, "dist/front/index.d.ts"), "utf8")
if (!broadDeclaration.includes("from '@hachej/boring-workspace/plugin'")) {
  throw new Error("tasks declarations: broad front type does not resolve through the public workspace plugin export")
}

console.log("tasks declarations: root, front, and front/descriptor types resolve through emitted/public paths")
