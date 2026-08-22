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
    modulePreload: {
      resolveDependencies(_filename, dependencies, context) {
        if (context.hostType !== "html") return dependencies
        return dependencies.filter((dependency) => /(?:rolldown-runtime|vendor-react|vendor-dockview|jsx-runtime|jsx-dev-runtime)-/.test(dependency))
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("react-dom") || id.includes("react-router") || /[/\\]react[/\\]/.test(id)) return "vendor-react"
          if (id.includes("dockview")) return "vendor-dockview"
          if (id.includes("recharts") || id.includes("victory-vendor")) return "vendor-recharts"
          if (id.includes("@codemirror/")) return "vendor-codemirror"
          if (id.includes("@tiptap/") || id.includes("lowlight")) return "vendor-tiptap"
        },
      },
    },
  },
})
