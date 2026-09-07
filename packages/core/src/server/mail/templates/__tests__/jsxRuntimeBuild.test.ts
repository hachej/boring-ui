import { describe, it, expect, afterAll } from 'vitest'
import { build, type BuildOptions } from 'esbuild'
import { render } from '@react-email/render'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Regression test for #1438: mail templates crashed at SSR with
// "React is not defined" because the *build* (packages/core/tsup.config.ts)
// used esbuild's default CLASSIC jsx transform while the templates (authored
// for tsconfig's "jsx": "react-jsx") import no React.
//
// A unit test that imports the templates straight from src (like
// templates.test.ts) can't catch this class of bug: vitest transforms .tsx
// on the fly with its own automatic-jsx pipeline, so it passes regardless of
// what the *shipped build* does. This test instead runs the templates
// through the real tsup.config.ts esbuild pipeline and — crucially — points
// esbuild at an explicit tsconfig that has no "jsx" compiler option, so the
// result depends only on what tsup.config.ts itself configures, not on
// tsconfig.json auto-discovery (which is what let a local `pnpm build`
// accidentally succeed even before the fix). Before the fix (no `jsx` set in
// tsup.config.ts's esbuildOptions), this reproduces the exact crash; after
// the fix (`options.jsx = 'automatic'`), it renders successfully.

const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, '..')
const packageRoot = join(here, '..', '..', '..', '..', '..')

const tmpDir = mkdtempSync(join(tmpdir(), 'core-jsx-runtime-build-'))
afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// A tsconfig with no "jsx" field at all, deliberately shadowing
// packages/core/tsconfig.json's "jsx": "react-jsx" so esbuild's tsconfig
// auto-detection cannot rescue an unfixed build config.
const noJsxTsconfigPath = join(tmpDir, 'tsconfig.no-jsx.json')
writeFileSync(
  noJsxTsconfigPath,
  JSON.stringify({ compilerOptions: { module: 'esnext', target: 'es2022' } }),
)

async function buildTemplate(entryFile: string, outFile: string) {
  const { esbuildOptions } = (await import(
    pathToFileURL(join(packageRoot, 'tsup.config.ts')).href
  ).then((m) => {
    const cfg = m.default
    const entryCfg = Array.isArray(cfg) ? cfg[0] : cfg
    return entryCfg
  })) as { esbuildOptions?: (options: BuildOptions) => void }

  const options: BuildOptions = {
    entryPoints: [join(templatesDir, entryFile)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    tsconfig: noJsxTsconfigPath,
    external: ['react', 'react-dom', '@react-email/components'],
  }

  // Apply the package's real build config, mirroring exactly what
  // `pnpm --filter @hachej/boring-core build` runs.
  esbuildOptions?.(options)

  const result = await build(options)
  const code = result.outputFiles![0]!.text
  const outPath = join(tmpDir, outFile)
  writeFileSync(outPath, code)
  return import(pathToFileURL(outPath).href)
}

describe('mail templates built via the real tsup esbuild config (#1438)', () => {
  it('renderVerifyEmail: built VerifyEmail produces non-empty HTML without throwing', async () => {
    const mod = await buildTemplate('VerifyEmail.tsx', 'VerifyEmail.mjs')
    const element = mod.VerifyEmail({
      verifyUrl: 'https://app.test/verify?token=abc',
      appName: 'TestApp',
      expiresInHours: 24,
    })
    const html = await render(element)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('Verify your email address')
  })

  it('renderWelcome: built Welcome produces non-empty HTML without throwing', async () => {
    const mod = await buildTemplate('Welcome.tsx', 'Welcome.mjs')
    const element = mod.Welcome({
      appName: 'TestApp',
      getStartedUrl: 'https://app.test/dashboard',
    })
    const html = await render(element)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('TestApp')
  })
})
