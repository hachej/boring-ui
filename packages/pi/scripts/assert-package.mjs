import { access, readFile } from "node:fs/promises"
import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dirname, "..")
const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"))
if (manifest.name !== "@hachej/boring-pi") {
  throw new Error("boring-pi package identity is invalid")
}
await access(resolve(packageRoot, "skills", "boring-plugin-authoring", "SKILL.md"))
console.log("boring-pi package resources: OK")
