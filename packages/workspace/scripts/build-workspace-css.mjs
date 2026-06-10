import { createRequire } from "node:module"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"

const require = createRequire(import.meta.url)

const globalsInput = resolve("src/globals.css")
const dockviewCssPath = require.resolve("dockview-react/dist/styles/dockview.css")
const dockviewOverridesPath = resolve("src/front/dock/dockview-overrides.css")
const chatPaneStagePath = resolve("src/front/layout/chat-pane-stage.css")
const output = resolve("dist/workspace.css")

const [dockviewCss, dockviewOverridesCss, chatPaneStageCss, globalsCss] = await Promise.all([
  readFile(dockviewCssPath, "utf8"),
  readFile(dockviewOverridesPath, "utf8"),
  readFile(chatPaneStagePath, "utf8"),
  readFile(globalsInput, "utf8"),
])

const globalsResult = await postcss([tailwindcss()]).process(globalsCss, {
  from: globalsInput,
  to: output,
})

const css = [
  "/* dockview-react/dist/styles/dockview.css */",
  dockviewCss,
  "/* @hachej/boring-workspace globals */",
  globalsResult.css,
  "/* @hachej/boring-workspace dockview overrides */",
  dockviewOverridesCss,
  "/* @hachej/boring-workspace chat pane stage */",
  chatPaneStageCss,
].join("\n\n")

await mkdir(dirname(output), { recursive: true })
await writeFile(output, css)
