import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = await mkdtemp(path.join(packageRoot, '.pack-db-types-'))

try {
  const { stdout } = await execFileAsync('pnpm', ['pack', '--pack-destination', tempRoot], {
    cwd: packageRoot,
  })
  const packedPath = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!packedPath) throw new Error('pnpm pack did not report a tarball')

  const installedRoot = path.join(tempRoot, 'node_modules', '@hachej', 'boring-core')
  await mkdir(installedRoot, { recursive: true })
  const tarball = path.isAbsolute(packedPath) ? packedPath : path.join(tempRoot, packedPath)
  await execFileAsync('tar', ['-xzf', tarball, '-C', installedRoot, '--strip-components=1'])

  const packedManifest = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'))
  const dbTypes = packedManifest.exports?.['./server/db']?.types
  if (typeof dbTypes !== 'string') throw new Error('packed server/db export has no types target')

  await writeFile(path.join(tempRoot, 'consumer.ts'), `
import {
  PostgresFencedSandboxHandleAdmin,
  PostgresFencedSandboxHandleForceAdmin,
  PostgresFencedSandboxHandleStore,
  createDatabase,
  createSandboxHandleCipher,
} from '@hachej/boring-core/server/db'
import type { Database } from '@hachej/boring-core/server/db'

const acceptsDatabase = (db: Database): void => {
  const cipher = createSandboxHandleCipher(new Uint8Array(32))
  void new PostgresFencedSandboxHandleStore(db, cipher)
  void new PostgresFencedSandboxHandleAdmin(db)
  void new PostgresFencedSandboxHandleForceAdmin(db)
}
void acceptsDatabase
void createDatabase
`)
  await writeFile(path.join(tempRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
      types: ['node'],
      noEmit: true,
    },
    files: ['./consumer.ts'],
  }, null, 2))

  await execFileAsync('pnpm', ['exec', 'tsc', '-p', path.join(tempRoot, 'tsconfig.json')], {
    cwd: packageRoot,
  })
  console.log(`packed-db-types: strict consumer resolved ${dbTypes}`)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
