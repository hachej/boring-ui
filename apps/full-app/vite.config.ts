import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createBoringAppViteAliases } from '@hachej/boring-core/app/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: createBoringAppViteAliases({ appRoot: __dirname }),
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
