import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const EXTERNALS = ['react', 'react-dom', /^@boring\//]

// Hand-authored CSS entrypoints that tsup doesn't bundle: they're consumed via
// package `exports` (theme.css, styles.css) and `@import`, not imported from TS.
// Copy them into dist preserving the src tree so relative @imports resolve
// (e.g. styles.css -> ./chatFirst/chatFirstPublicShell.css). This is the single
// source of truth for every build path — `pnpm build` and the Docker image's
// `tsup --no-dts` step alike — so a new shipped stylesheet is added in one place.
const CSS_ASSETS = [
  'front/theme.css',
  'app/front/styles.css',
  'app/front/chatFirst/chatFirstPublicShell.css',
  'app/front/publicLaunchPages.css',
]

export default defineConfig([
  {
    entry: {
      'server/index': 'src/server/index.ts',
      'server/db/index': 'src/server/db/index.ts',
      'app/server/index': 'src/app/server/index.ts',
      'app/front/index': 'src/app/front/index.ts',
      'app/vite/index': 'src/app/vite/index.ts',
      'front/index': 'src/front/index.ts',
      'front/top-bar-slot': 'src/front/components/TopBarSlot.tsx',
      'shared/index': 'src/shared/index.ts',
    },
    format: ['esm'],
    dts: true,
    splitting: true,
    clean: true,
    outDir: 'dist',
    target: 'es2022',
    external: EXTERNALS,
    // esbuild otherwise falls back to the CLASSIC jsx transform (which
    // requires `React` in scope) unless it can auto-detect "jsx": "react-jsx"
    // from tsconfig.json. That auto-detection is implicit and cwd/tooling
    // dependent (it silently breaks if tsconfig.json isn't resolvable from
    // wherever esbuild is invoked, e.g. a Docker build context) — mail
    // templates like VerifyEmail.tsx/Welcome.tsx are authored for the
    // automatic runtime and import no React, so a classic-transform build
    // crashes at SSR with "React is not defined" (#1438). Set it explicitly
    // so the build doesn't depend on tsconfig resolution succeeding.
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
    async onSuccess() {
      for (const rel of CSS_ASSETS) {
        const dest = `dist/${rel}`
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(`src/${rel}`, dest)
      }
    },
  },
])
