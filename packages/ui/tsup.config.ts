import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  splitting: false,
  clean: true,
  outDir: 'dist',
  target: 'es2022',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
})
