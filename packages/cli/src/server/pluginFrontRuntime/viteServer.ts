import { extname, resolve as resolvePath } from "node:path"
import { readFile } from "node:fs/promises"
import react from "@vitejs/plugin-react"
import { ErrorCode } from "@hachej/boring-agent/shared"
import { createServer, type ViteDevServer } from "vite"
import { cjsDependencyToEsm, looksLikeCommonJs } from "./cjsInterop.js"
import { PluginFrontRuntimeError } from "./diagnostics.js"
import type { RuntimeHostLayout } from "./hostLayout.js"
import {
  isHostProvidedModule,
  isHostVirtualSingletonModule,
  isUnknownHostProvidedSubpath,
  packageNameFromBareSpecifier,
} from "./hostModules.js"
import { isNodeBuiltinSpecifier, validateSourceImports } from "./importValidation.js"
import {
  ensurePluginDependencyPath,
  parsePluginDependencyVirtualId,
  resolvePluginLocalBareImport,
  resolvePluginLocalRelativeDependencyImport,
} from "./pluginDependencies.js"
import { isRuntimeAssetPath, runtimeAssetModuleCode } from "./runtimeAssets.js"
import {
  buildRuntimeUrl,
  isBareImport,
  isRuntimePathImport,
  isUnsafeAbsoluteImport,
  parseRuntimeContext,
  stripCacheBustSearch,
} from "./runtimePaths.js"
import { runtimeSingletonModuleCode, sourceFromVirtualSingletonId, virtualSingletonId } from "./singletonModuleCode.js"
import { resolveImportSubpath } from "./sourceSnapshot.js"
import type { TrackedPluginRegistry } from "./trackedPlugins.js"

export interface RuntimeViteServerOptions {
  basePath: string
  layout: RuntimeHostLayout
  registry: TrackedPluginRegistry
}

/**
 * The Vite server that transforms plugin front modules.
 *
 * Its single plugin owns the whole module-graph policy: every specifier a
 * plugin module can name is either a runtime URL (plugin source), a virtual
 * singleton id (host-provided package), a virtual dependency id (plugin-local
 * node_modules) — or rejected.
 */
export async function createRuntimeViteServer({ basePath, layout, registry }: RuntimeViteServerOptions): Promise<ViteDevServer> {
  return await createServer({
    appType: "custom",
    configFile: false,
    ...(process.env.BORING_PLUGIN_FRONT_VITE_CACHE_DIR
      ? { cacheDir: process.env.BORING_PLUGIN_FRONT_VITE_CACHE_DIR }
      : {}),
    logLevel: "silent",
    root: layout.repoRoot,
    // Skip the dep-optimisation entry scan. Without this, Vite crawls the
    // entire monorepo looking for import statements and hits files like
    // App.tsx that import `virtual:boring-front-plugins` — a module that
    // is not registered in this Vite server. That transform error corrupts
    // the dep-opt lock, causing any concurrently-starting Vite instance to
    // hang until the test timeout fires.
    //
    // noDiscovery disables the dep optimizer entirely. With discovery on, Vite
    // re-optimizes mid-session as plugin imports surface new deps; each pass
    // rewrites node_modules/.vite/deps and bumps the browserHash, invalidating
    // chunk URLs the browser already holds
    // (ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR) and stalling in-flight plugin
    // front transforms indefinitely. It also means transforming a plugin
    // module with bare imports (e.g. lucide-react) never triggers Vite's
    // esbuild pre-bundler, which would hang the request for tens of seconds.
    // The runtime host serves deps through its own proxy/singleton routes, so
    // pre-bundling buys nothing here.
    optimizeDeps: { entries: [], noDiscovery: true },
    plugins: [
      react(),
      {
        name: "boring-cli-plugin-front-runtime",
        async resolveId(source, importer) {
          if (isRuntimePathImport(source, basePath)) {
            return stripCacheBustSearch(source)
          }

          const dependencyContext = importer ? parsePluginDependencyVirtualId(importer) : null
          const importerContext = importer ? parseRuntimeContext(importer, basePath) : null
          const context = dependencyContext ?? importerContext
          if (!context) return null

          if (isNodeBuiltinSpecifier(source)) {
            throw new PluginFrontRuntimeError(
              ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
              400,
              "resolve",
              "Node built-in modules are not available in runtime plugin fronts",
              { source, importer },
            )
          }
          if (isUnsafeAbsoluteImport(source, basePath)) {
            throw new PluginFrontRuntimeError(
              ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
              400,
              "resolve",
              "plugin runtime import bypasses the host runtime URL space",
              { source, importer },
            )
          }
          if (isBareImport(source)) {
            if (isHostVirtualSingletonModule(source)) return virtualSingletonId(source)
            if (isHostProvidedModule(source)) return source
            if (isUnknownHostProvidedSubpath(source)) {
              throw new PluginFrontRuntimeError(
                ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
                400,
                "resolve",
                "runtime plugin import targets an unsupported host-provided package subpath",
                { source, importer, packageName: packageNameFromBareSpecifier(source) },
              )
            }
            const tracked = registry.requireRevision(context.workspaceId, context.pluginId, context.revision)
            const importerFile = dependencyContext?.resolvedPath ?? resolvePath(tracked.rootDir, "package.json")
            return await resolvePluginLocalBareImport(tracked, source, importer, importerFile)
          }
          if (!source.startsWith(".") && !source.startsWith("..")) return null

          const tracked = registry.requireRevision(context.workspaceId, context.pluginId, context.revision)
          if (dependencyContext) {
            return await resolvePluginLocalRelativeDependencyImport(tracked, source, dependencyContext)
          }
          const importedSubpath = await resolveImportSubpath(tracked, importerContext!.subpath, source)
          const url = buildRuntimeUrl(basePath, tracked.workspaceId, tracked.pluginId, importerContext!.revision, importedSubpath)
          return isRuntimeAssetPath(importedSubpath) ? `${url}?module` : url
        },
        async load(id) {
          const singletonSource = sourceFromVirtualSingletonId(id)
          if (singletonSource) return runtimeSingletonModuleCode(singletonSource) ?? null

          const dependencyContext = parsePluginDependencyVirtualId(id)
          if (dependencyContext) {
            const tracked = registry.requireRevision(dependencyContext.workspaceId, dependencyContext.pluginId, dependencyContext.revision)
            const resolvedPath = await ensurePluginDependencyPath(tracked, dependencyContext.resolvedPath, id, dependencyContext.resolvedPath)
            if (isRuntimeAssetPath(resolvedPath)) {
              return runtimeAssetModuleCode(resolvedPath, await readFile(resolvedPath))
            }
            const sourceText = await readFile(resolvedPath, "utf8")
            const extension = extname(resolvedPath).toLowerCase()
            const isCommonJs = extension === ".cjs" || (extension !== ".mjs" && looksLikeCommonJs(sourceText))
            if (isCommonJs) {
              const interop = await cjsDependencyToEsm(sourceText, resolvedPath)
              // Validate the rewritten ESM: the original module's require()
              // targets are now hoisted imports, so they pass through the same
              // unsafe-specifier gate as any other dependency import.
              validateSourceImports(interop, resolvedPath, basePath)
              return interop
            }
            validateSourceImports(sourceText, resolvedPath, basePath)
            return sourceText
          }

          const context = parseRuntimeContext(id, basePath)
          if (!context) return null
          const tracked = registry.requireRevision(context.workspaceId, context.pluginId, context.revision)
          const snapshotBytes = tracked.sourceSnapshot.get(context.subpath)
          if (snapshotBytes === undefined) {
            throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "validate", "plugin runtime file was not captured in this revision", {
              workspaceId: context.workspaceId,
              pluginId: context.pluginId,
              requestedRevision: context.revision,
              path: context.subpath,
            })
          }
          if (isRuntimeAssetPath(context.subpath)) {
            return runtimeAssetModuleCode(context.subpath, snapshotBytes)
          }
          const sourceText = Buffer.from(snapshotBytes).toString("utf8")
          validateSourceImports(sourceText, context.subpath, basePath)
          return sourceText
        },
      },
    ],
    resolve: {
      alias: layout.singletonResolve.alias,
      dedupe: [...layout.singletonResolve.dedupe],
    },
    server: {
      middlewareMode: true,
      hmr: false,
      // Runtime plugin modules are served from immutable revision snapshots
      // plus explicit plugin-local dependency virtual ids. Watching the whole
      // monorepo is useless here and can exhaust CI file-watch limits.
      watch: null,
    },
  })
}
