import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import dts from "vite-plugin-dts"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"

interface PackageManifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
) as PackageManifest

const externalPackages = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
])

function isExternalPackage(id: string): boolean {
  for (const packageName of externalPackages) {
    if (id === packageName || id.startsWith(`${packageName}/`)) return true
  }
  return false
}

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
        testing: resolve(__dirname, "src/front/testing/index.ts"),
        "testing-e2e": resolve(__dirname, "src/front/testing/e2e.ts"),
        "ui-shadcn": resolve(__dirname, "src/front/components/ui/index.ts"),
        "app-front": resolve(__dirname, "src/app/front/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: isExternalPackage,
    },
  },
})
