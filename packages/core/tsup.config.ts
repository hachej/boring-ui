import { defineConfig } from 'tsup'

const EXTERNALS = ['react', 'react-dom']

export default defineConfig([
  {
    entry: {
      'server/index': 'src/server/index.ts',
      'server/db/index': 'src/server/db/index.ts',
      'front/index': 'src/front/index.ts',
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
