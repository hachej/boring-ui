import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {
  BORING_REACT_VITE_DEDUPE,
  createBoringAppViteAliases,
  createBoringReactViteAliases,
} from '@hachej/boring-core/app/vite'

const useLocalPackages = process.env.BORING_USE_LOCAL_PACKAGES === '1'
const reactAliases = createBoringReactViteAliases({ appRoot: __dirname })
const localPackageAliases = createBoringAppViteAliases({ repoRoot: resolve(__dirname, '../..') })

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: useLocalPackages ? [...reactAliases, ...localPackageAliases] : reactAliases,
    dedupe: [...BORING_REACT_VITE_DEDUPE],
  },
  build: {
    outDir: 'dist/front',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("recharts") || id.includes("victory-vendor")) return "vendor-recharts"
          if (id.includes("@codemirror/")) return "vendor-codemirror"
          if (id.includes("@tiptap/") || id.includes("lowlight")) return "vendor-tiptap"
        },
      },
    },
  },
})
