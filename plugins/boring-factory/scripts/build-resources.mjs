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
  ...[
    'boring-loop.md',
    'MODEL-CARD.md',
    'issue-plans.md',
    'bead-ready.md',
    'visual-review-doc.md',
  ].map((name) => ({
    source: path.join(repositoryRoot, 'docs/procedures', name),
    target: path.posix.join('skills/plan/docs/procedures', name),
  })),
  {
    source: path.join(repositoryRoot, '.agents/skills/fresh-eyes'),
    target: 'skills/plan/.agents/skills/fresh-eyes',
  },
  ...[
    'boring-loop.md',
    'MODEL-CARD.md',
    'worktree-agent.md',
    'proof-of-work.md',
    'visual-review.md',
    'owner-review-card.md',
  ].map((name) => ({
    source: path.join(repositoryRoot, 'docs/procedures', name),
    target: path.posix.join('skills/exec/docs/procedures', name),
  })),
  {
    source: path.join(repositoryRoot, '.agents/factory/README.md'),
    target: 'skills/exec/.agents/factory/README.md',
  },
  {
    source: path.join(repositoryRoot, '.agents/skills/present-pr'),
    target: 'skills/exec/.agents/skills/present-pr',
  },
  {
    source: path.join(repositoryRoot, '.agents/skills/show-me'),
    target: 'skills/exec/.agents/skills/show-me',
  },
  {
    source: path.join(repositoryRoot, '.agents/skill-references/show-me'),
    target: 'skills/exec/.agents/skill-references/show-me',
  },
  {
    source: path.join(repositoryRoot, 'scripts/present-pr.mjs'),
    target: 'skills/exec/scripts/present-pr.mjs',
  },
  ...[
    'present-pr-context.mjs',
    'present-pr-files.mjs',
    'present-pr-html.mjs',
    'present-pr-links.mjs',
    'present-pr-theme.mjs',
    'render-mermaid.mjs',
  ].map((name) => ({
    source: path.join(repositoryRoot, 'scripts/lib', name),
    target: path.posix.join('skills/exec/scripts/lib', name),
  })),
]

/** @type {Record<string, string>} */
const files = {}
/** @type {Record<string, string>} */
const sourceFiles = {}

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
  sourceFiles[destinationRelative] = path.posix.join(
    path.relative(repositoryRoot, sourceRoot).split(path.sep).join(path.posix.sep),
    relative.split(path.sep).join(path.posix.sep),
  )
}

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
for (const entry of sources) {
  await copyTree(entry.source, entry.target)
}

const manifest = {
  contractVersion: 'boring.factory.resources.v1',
  files: Object.fromEntries(Object.entries(files).sort()),
  sources: Object.fromEntries(Object.entries(sourceFiles).sort()),
}
await writeFile(
  path.join(outputRoot, 'resource-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)
