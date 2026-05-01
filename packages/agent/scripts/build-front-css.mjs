import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"

const input = resolve("src/front/styles/globals.css")
const output = resolve("dist/front/styles.css")

const css = await readFile(input, "utf8")
const result = await postcss([tailwindcss()]).process(css, {
  from: input,
  to: output,
})
await mkdir(dirname(output), { recursive: true })
await writeFile(output, result.css)
if (result.map) {
  await writeFile(`${output}.map`, result.map.toString())
}
