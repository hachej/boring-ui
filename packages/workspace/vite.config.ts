import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import dts from "vite-plugin-dts"
import { resolve } from "node:path"

export default defineConfig({
  plugins: [react(), tailwindcss(), dts({ rollupTypes: true })],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    lib: {
      entry: {
        workspace: resolve(__dirname, "src/index.ts"),
        testing: resolve(__dirname, "src/testing/index.ts"),
        "ui-shadcn": resolve(__dirname, "src/components/ui/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
    },
  },
})
