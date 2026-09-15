import { defineConfig } from 'tsup'

const EXTERNALS = ['react', 'react-dom', /^@boring\//]

// Run only after tsup.config.ts. The main build owns the single dist clean;
// this independent Node-only boundary must never race it or erase declarations.
export default defineConfig({
  entry: { 'server/db/index': 'src/server/db/index.ts' },
  format: ['esm'],
  dts: true,
  splitting: false,
  clean: false,
  outDir: 'dist',
  target: 'es2022',
  external: EXTERNALS,
})
