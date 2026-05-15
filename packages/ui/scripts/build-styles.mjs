import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

const root = resolve(import.meta.dirname, '..')
const from = resolve(root, 'src/styles.css')
const to = resolve(root, 'dist/styles.css')

const input = await readFile(from, 'utf8')
const result = await postcss([tailwindcss()]).process(input, { from, to })

await mkdir(dirname(to), { recursive: true })
await writeFile(to, result.css)
if (result.map) await writeFile(`${to}.map`, result.map.toString())
