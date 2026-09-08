import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

async function files(dir) {
  const output = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) output.push(...await files(path))
    else if (entry.name.endsWith('.ts')) output.push(path)
  }
  return output
}

for (const file of await files(fileURLToPath(new URL('../src/', import.meta.url)))) {
  const source = await readFile(file, 'utf8')
  if (/from\s+['"]node:|\bBuffer\b/.test(source)) {
    throw new Error(`${file}: provider edge must remain Web-API portable`)
  }
}
console.log('channels-whatsapp invariants: OK')
