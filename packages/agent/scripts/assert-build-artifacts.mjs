import { readFileSync } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
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
  'dist/front/index.css',
  'dist/frontend/index.html',
  'dist/bin/boring-agent.js',
  'dist/front-shadcn/styles.css',
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

function assertThemeCss(relPath) {
  const absolutePath = resolveFromPackage(relPath)
  const sourceText = readFileSync(absolutePath, 'utf8')
  if (!sourceText.includes('[data-boring-chat]')) {
    throw new Error(`${relPath} is missing [data-boring-chat] selector`)
  }
}

async function assertFrontendBundle() {
  const assetsDir = resolveFromPackage('dist/frontend/assets')
  const entries = await readdir(assetsDir, { withFileTypes: true })
  const jsAssets = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => `dist/frontend/assets/${entry.name}`)

  if (jsAssets.length === 0) {
    throw new Error('Expected at least one JS asset in dist/frontend/assets')
  }

  for (const jsAsset of jsAssets) {
    assertNodeParsable(jsAsset)
  }
}

function assertCliShebang() {
  const cliPath = resolveFromPackage('dist/bin/boring-agent.js')
  const sourceText = readFileSync(cliPath, 'utf8')
  if (!sourceText.startsWith('#!/usr/bin/env node')) {
    throw new Error('dist/bin/boring-agent.js is missing expected shebang')
  }
}

async function main() {
  for (const relPath of requiredFiles) {
    await assertExists(relPath)
  }

  assertNodeParsable('dist/shared/index.js')
  assertNodeParsable('dist/server/index.js')
  assertNodeParsable('dist/front/index.js')
  assertNodeParsable('dist/bin/boring-agent.js')

  assertTsParsable('dist/shared/index.d.ts')
  assertTsParsable('dist/server/index.d.ts')
  assertTsParsable('dist/front/index.d.ts')
  assertThemeCss('dist/front/index.css')

  await assertFrontendBundle()
  assertCliShebang()

  process.stdout.write('build-artifacts: OK\n')
}

main().catch((error) => {
  process.stderr.write(`build-artifacts: FAIL\n${String(error)}\n`)
  process.exitCode = 1
})
