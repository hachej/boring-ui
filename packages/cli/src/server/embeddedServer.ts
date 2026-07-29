import { join } from "node:path"
import { registerStatic } from "./cli.js"
import { createLocalWorkspaceRegistry } from "./localWorkspaces.js"
import { createWorkspacesModeApp } from "./modeApps.js"
import type {
  EmbeddedBoringUiServer,
  EmbeddedBoringUiServerOptions,
} from "./embeddedServerTypes.js"
import { resolveBoringUiCliPackageRoot } from "./pluginDiscovery.js"

export type {
  EmbeddedBoringUiRequestCapability,
  EmbeddedBoringUiServer,
  EmbeddedBoringUiServerOptions,
} from "./embeddedServerTypes.js"

/**
 * Start the CLI's multi-workspace application for an embedding desktop host.
 * The caller owns the loopback capability and the returned server lifecycle.
 */
export async function startEmbeddedBoringUiServer(
  options: EmbeddedBoringUiServerOptions,
): Promise<EmbeddedBoringUiServer> {
  const registry = createLocalWorkspaceRegistry(options.registryPath)
  const app = await createWorkspacesModeApp({
    mode: options.mode ?? "direct",
    registryPath: options.registryPath,
    provisionWorkspace: options.provisionWorkspace,
    requestCapability: options.requestCapability,
  })

  try {
    await registerStatic(
      app,
      options.publicDir ?? join(resolveBoringUiCliPackageRoot(), "public"),
    )
    const origin = await app.listen({ host: "127.0.0.1", port: 0 })
    const initialWorkspace = (await registry.list()).find((workspace) => workspace.available)
    const initialUrl = initialWorkspace
      ? `${origin}/workspace/${encodeURIComponent(initialWorkspace.id)}`
      : origin
    let closePromise: Promise<void> | undefined

    return {
      origin,
      initialUrl,
      close() {
        closePromise ??= app.close()
        return closePromise
      },
    }
  } catch (error) {
    await app.close().catch(() => undefined)
    throw error
  }
}
