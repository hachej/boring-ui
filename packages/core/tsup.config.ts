import { defineConfig } from 'tsup'

const EXTERNALS = ['react', 'react-dom', /^@boring\//]

export default defineConfig([
  {
    entry: {
      'server/index': 'src/server/index.ts',
      'server/db/index': 'src/server/db/index.ts',
      'app/server/index': 'src/app/server/index.ts',
      'app/front/index': 'src/app/front/index.ts',
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
  },
])
