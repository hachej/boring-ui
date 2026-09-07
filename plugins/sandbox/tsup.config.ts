import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'server/index': 'src/server/index.ts' },
  format: ['esm'],
  dts: true,
  splitting: false,
  clean: true,
  outDir: 'dist',
  target: 'es2022',
  external: [/^@hachej\/boring-/, 'fastify'],
})
