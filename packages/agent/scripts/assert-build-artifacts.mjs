import { readFileSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'
import ts from 'typescript'

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const requiredFiles = [
  'dist/shared/index.js',
  'dist/shared/index.d.ts',
  'dist/core/index.d.ts',
  'dist/server/index.d.ts',
  'dist/server/worker/index.js',
  'dist/server/worker/index.d.ts',
  'dist/front/index.js',
  'dist/front/index.d.ts',
  'dist/front/styles.css',
  'dist/eval/index.js',
  'dist/eval/index.d.ts',
]

function resolveFromPackage(relPath) {
  return path.resolve(packageRoot, relPath)
}

function resolvePublishedJsExport(packageJson, exportName) {
  const entry = packageJson.exports?.[exportName]?.import
  if (typeof entry !== 'string' || entry.trim().length === 0) {
    throw new Error(`package export ${exportName} must define a nonempty import path`)
  }
  const distRoot = resolveFromPackage('dist')
  const absolutePath = resolveFromPackage(entry)
  const fromDist = path.relative(distRoot, absolutePath)
  if (fromDist.length === 0
    || fromDist === '..'
    || fromDist.startsWith(`..${path.sep}`)
    || path.isAbsolute(fromDist)) {
    throw new Error(`package export ${exportName} import must stay under published dist: ${entry}`)
  }
  return {
    absolutePath,
    displayPath: path.relative(packageRoot, absolutePath),
  }
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
  const forbidden = [
    /@source\b/,
    /@import\s+['"]tailwindcss/,
    /packages\/agent\/src/,
    /packages\/workspace\/src/,
    /var\(--boring-agent-\*\)/,
    /var\(--…\)/,
    /var\(\.\.\.\)/,
  ]
  for (const pattern of forbidden) {
    if (pattern.test(sourceText)) {
      throw new Error(`${relPath} contains consumer-unsafe CSS directive/path: ${pattern}`)
    }
  }
}

function isFastifySpecifier(specifier) {
  return specifier === 'fastify'
    || specifier.startsWith('fastify/')
    || specifier.startsWith('@fastify/')
}

function findFastifyClosureViolations(metafile) {
  const inputPaths = Object.keys(metafile.inputs)
    .filter((inputPath) => {
      const normalized = inputPath.replaceAll('\\', '/')
      return normalized.includes('node_modules/fastify/')
        || normalized.includes('node_modules/@fastify/')
    })
    .sort()
  const externalSpecifiers = Array.from(new Set(
    Object.values(metafile.outputs)
      .flatMap((output) => output.imports)
      .filter((entry) => entry.external && isFastifySpecifier(entry.path))
      .map((entry) => entry.path),
  )).sort()
  return { externalSpecifiers, inputPaths }
}

function assertFastifyDetectorFixture() {
  const fastifyInput = 'node_modules/.pnpm/fastify@5.10.0/node_modules/fastify/fastify.js'
  const fixture = {
    inputs: {
      'dist/core/index.js': { bytes: 1, imports: [] },
      [fastifyInput]: { bytes: 1, imports: [] },
    },
    outputs: {
      'fixture.js': {
        bytes: 1,
        exports: [],
        imports: [
          { external: true, kind: 'import-statement', path: '@fastify/static' },
          { external: true, kind: 'dynamic-import', path: 'fastify' },
        ],
        inputs: {},
      },
    },
  }
  const actual = findFastifyClosureViolations(fixture)
  const expected = {
    externalSpecifiers: ['@fastify/static', 'fastify'],
    inputPaths: [fastifyInput],
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Fastify closure detector fixture mismatch: ${JSON.stringify(actual)}`)
  }
}

async function analyzeFastifyClosure(entryPoint) {
  const result = await esbuild({
    absWorkingDir: packageRoot,
    bundle: true,
    entryPoints: [entryPoint],
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    packages: 'bundle',
    platform: 'node',
    target: 'node22',
    write: false,
  })
  return findFastifyClosureViolations(result.metafile)
}

async function assertCoreFastifyFree(entryPoint) {
  const violations = await analyzeFastifyClosure(entryPoint)
  if (violations.inputPaths.length > 0 || violations.externalSpecifiers.length > 0) {
    throw new Error(`dist/core Fastify closure violation: ${JSON.stringify(violations)}`)
  }
}

async function assertServerDetectsFastify(entryPoint) {
  const violations = await analyzeFastifyClosure(entryPoint)
  if (violations.inputPaths.length === 0 && violations.externalSpecifiers.length === 0) {
    throw new Error('Fastify closure negative proof did not detect the published server entry')
  }
}

async function main() {
  const packageJson = JSON.parse(readFileSync(resolveFromPackage('package.json'), 'utf8'))
  if (!packageJson.files?.includes('dist')) {
    throw new Error('package files must publish dist')
  }
  const coreEntry = resolvePublishedJsExport(packageJson, './core')
  const serverEntry = resolvePublishedJsExport(packageJson, './server')

  for (const relPath of requiredFiles) {
    await assertExists(relPath)
  }
  await assertExists(coreEntry.displayPath)
  await assertExists(serverEntry.displayPath)

  assertNodeParsable('dist/shared/index.js')
  assertNodeParsable(coreEntry.displayPath)
  assertNodeParsable(serverEntry.displayPath)
  assertNodeParsable('dist/front/index.js')
  assertNodeParsable('dist/eval/index.js')

  assertTsParsable('dist/shared/index.d.ts')
  assertTsParsable('dist/core/index.d.ts')
  assertTsParsable('dist/server/index.d.ts')
  assertTsParsable('dist/front/index.d.ts')
  assertTsParsable('dist/eval/index.d.ts')
  assertConsumerSafeCss('dist/front/styles.css')
  assertFastifyDetectorFixture()
  await assertCoreFastifyFree(coreEntry.absolutePath)
  await assertServerDetectsFastify(serverEntry.absolutePath)

  process.stdout.write('build-artifacts: OK\n')
}

main().catch((error) => {
  process.stderr.write(`build-artifacts: FAIL\n${String(error)}\n`)
  process.exitCode = 1
})
