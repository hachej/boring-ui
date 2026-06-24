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
    async onSuccess() {
      for (const rel of CSS_ASSETS) {
        const dest = `dist/${rel}`
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(`src/${rel}`, dest)
      }
    },
  },
])
