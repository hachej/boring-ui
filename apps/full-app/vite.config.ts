import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createBoringAppViteAliases } from '@boring/core/app/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: createBoringAppViteAliases({ repoRoot: resolve(__dirname, '../..') }),
  },
  build: {
    outDir: 'dist/front',
    emptyOutDir: true,
  },
})
