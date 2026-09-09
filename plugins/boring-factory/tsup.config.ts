import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'server/index': 'src/server/index.ts',
    'server/sandbox/index': 'src/server/sandbox/index.ts',
    'shared/index': 'src/shared/index.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: false,
  clean: true,
  outDir: 'dist',
  platform: 'node',
  external: ['fastify', '@vercel/sandbox', /^@hachej\//],
  target: 'es2022',
})
