import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { createBoringAppViteAliases } from "@hachej/boring-core/app/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: createBoringAppViteAliases({ appRoot: __dirname }),
  build: {
    outDir: "public",
    emptyOutDir: true,
  },
})
