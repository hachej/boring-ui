import { resolve } from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const reactSingletonAliases = [
  { find: /^react$/, replacement: resolve(__dirname, "node_modules/react") },
  { find: /^react-dom$/, replacement: resolve(__dirname, "node_modules/react-dom") },
  { find: /^react-dom\/client$/, replacement: resolve(__dirname, "node_modules/react-dom/client.js") },
  { find: /^react\/jsx-runtime$/, replacement: resolve(__dirname, "node_modules/react/jsx-runtime.js") },
  { find: /^react\/jsx-dev-runtime$/, replacement: resolve(__dirname, "node_modules/react/jsx-dev-runtime.js") },
]

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: reactSingletonAliases,
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "public",
    emptyOutDir: true,
  },
})
