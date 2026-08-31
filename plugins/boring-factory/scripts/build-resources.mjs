import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rm, copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(pluginRoot, '../..')
const outputRoot = path.join(pluginRoot, 'dist/resources')

const sources = [
  { source: path.join(pluginRoot, 'agents'), target: 'agents' },
  { source: path.join(repositoryRoot, '.agents/skills/plan'), target: 'skills/plan' },
  { source: path.join(repositoryRoot, '.agents/skills/exec'), target: 'skills/exec' },
  {
    source: path.join(repositoryRoot, '.agents/skill-references/plan'),
    target: 'skill-references/plan',
  },
  {
    source: path.join(repositoryRoot, '.agents/skill-references/exec'),
    target: 'skill-references/exec',
  },
]

/** @type {Record<string, string>} */
const files = {}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function copyTree(sourceRoot, targetRelative, relative = '') {
  const source = path.join(sourceRoot, relative)
  const info = await lstat(source)
  if (info.isSymbolicLink()) {
    throw new Error(`factory resource source must not contain symlinks: ${source}`)
  }
  if (info.isDirectory()) {
    const entries = (await readdir(source)).sort()
    for (const entry of entries) {
      await copyTree(sourceRoot, targetRelative, path.join(relative, entry))
    }
    return
  }
  if (!info.isFile()) {
    throw new Error(`factory resource source must contain regular files only: ${source}`)
  }

  const destinationRelative = path.posix.join(
    targetRelative,
    relative.split(path.sep).join(path.posix.sep),
  )
  const destination = path.join(outputRoot, destinationRelative)
  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(source, destination)
  files[destinationRelative] = sha256(await readFile(destination))
}

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
for (const entry of sources) {
  await copyTree(entry.source, entry.target)
}

const manifest = {
  contractVersion: 'boring.factory.resources.v1',
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
}
await writeFile(
  path.join(outputRoot, 'resource-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)
