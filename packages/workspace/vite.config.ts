import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import dts from "vite-plugin-dts"
import { resolve } from "node:path"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dts({
      rollupTypes: true,
      tsconfigPath: resolve(__dirname, "tsconfig.front.json"),
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    // Don't wipe tsup's dist/server.{js,d.ts} + dist/shared.{js,d.ts}
    // outputs (tsup runs first in the build script).
    emptyOutDir: false,
    lib: {
      entry: {
        workspace: resolve(__dirname, "src/index.ts"),
        testing: resolve(__dirname, "src/testing/index.ts"),
        "ui-shadcn": resolve(__dirname, "src/front/components/ui/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
    },
  },
})
