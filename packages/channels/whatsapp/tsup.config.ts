import { defineConfig } from 'tsup'
export default defineConfig({ entry: { index: 'src/index.ts' }, format: ['esm'], dts: true, splitting: false, clean: true, target: 'es2022' })
