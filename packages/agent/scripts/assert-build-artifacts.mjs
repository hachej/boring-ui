import { readFileSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const requiredFiles = [
  'dist/shared/index.js',
  'dist/shared/index.d.ts',
  'dist/server/index.js',
  'dist/server/index.d.ts',
  'dist/front/index.js',
  'dist/front/index.d.ts',
  'dist/front/styles.css',
  'dist/eval/index.js',
  'dist/eval/index.d.ts',
]

function resolveFromPackage(relPath) {
  return path.resolve(packageRoot, relPath)
}

async function assertExists(relPath) {
  await access(resolveFromPackage(relPath), constants.F_OK)
}

function assertNodeParsable(relPath) {
  const absolutePath = resolveFromPackage(relPath)
  const checkResult = spawnSync(process.execPath, ['--check', absolutePath], {
    encoding: 'utf8',
  })
  if (checkResult.status !== 0) {
    throw new Error(
      `JS parse failed for ${relPath}: ${checkResult.stderr || checkResult.stdout || 'unknown error'}`,
    )
  }
}

function assertTsParsable(relPath) {
  const absolutePath = resolveFromPackage(relPath)
  const sourceText = readFileSync(absolutePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  if (sourceFile.parseDiagnostics.length > 0) {
    const firstError = sourceFile.parseDiagnostics[0]
    throw new Error(
      `Type parse failed for ${relPath}: ${firstError.messageText}`,
    )
  }
}

function assertConsumerSafeCss(relPath) {
  const sourceText = readFileSync(resolveFromPackage(relPath), 'utf8')
  const forbidden = [/@source\b/, /@import\s+['"]tailwindcss/, /packages\/agent\/src/, /packages\/workspace\/src/]
  for (const pattern of forbidden) {
    if (pattern.test(sourceText)) {
      throw new Error(`${relPath} contains consumer-unsafe CSS directive/path: ${pattern}`)
    }
  }
}

async function main() {
  for (const relPath of requiredFiles) {
    await assertExists(relPath)
  }

  assertNodeParsable('dist/shared/index.js')
  assertNodeParsable('dist/server/index.js')
  assertNodeParsable('dist/front/index.js')
  assertNodeParsable('dist/eval/index.js')

  assertTsParsable('dist/shared/index.d.ts')
  assertTsParsable('dist/server/index.d.ts')
  assertTsParsable('dist/front/index.d.ts')
  assertTsParsable('dist/eval/index.d.ts')
  assertConsumerSafeCss('dist/front/styles.css')

  process.stdout.write('build-artifacts: OK\n')
}

main().catch((error) => {
  process.stderr.write(`build-artifacts: FAIL\n${String(error)}\n`)
  process.exitCode = 1
})
