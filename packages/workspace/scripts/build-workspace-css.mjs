import { createRequire } from "node:module"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"

const require = createRequire(import.meta.url)

const globalsInput = resolve("src/globals.css")
const dockviewCssPath = require.resolve("dockview-react/dist/styles/dockview.css")
const dockviewOverridesPath = resolve("src/front/dock/dockview-overrides.css")
const output = resolve("dist/workspace.css")

const [dockviewCss, dockviewOverridesCss, globalsCss] = await Promise.all([
  readFile(dockviewCssPath, "utf8"),
  readFile(dockviewOverridesPath, "utf8"),
  readFile(globalsInput, "utf8"),
])

const globalsResult = await postcss([tailwindcss()]).process(globalsCss, {
  from: globalsInput,
  to: output,
})

const css = [
  "/* dockview-react/dist/styles/dockview.css */",
  dockviewCss,
  "/* @boring/workspace globals */",
  globalsResult.css,
  "/* @boring/workspace dockview overrides */",
  dockviewOverridesCss,
].join("\n\n")

await mkdir(dirname(output), { recursive: true })
await writeFile(output, css)
