import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { ErrorCode } from "@hachej/boring-agent/shared"
import type { ViteDevServer } from "vite"
import { PluginFrontRuntimeError, toApiError } from "./diagnostics.js"
import type { MintedSupportPaths } from "./mintedSupportPaths.js"
import { normalizeSearch } from "./runtimePaths.js"
import { runtimeSingletonModuleCodeFor } from "./singletonModuleCode.js"
import type { PluginFrontRuntimeResponse, PluginFrontRuntimeServeRequest } from "./types.js"
import {
  assertNoUnsafeFsSupportReference,
  isHostNodeModuleFsSpecifier,
  rewriteViteSupportUrls,
  VITE_PROXYABLE_PATH_RE,
} from "./viteSupportUrls.js"

const JAVASCRIPT_CONTENT_TYPE = "application/javascript; charset=utf-8"

export interface RuntimeRouteDependencies {
  basePath: string
  vite: ViteDevServer
  minted: MintedSupportPaths
  hostNodeModulesRoots: readonly string[]
  serve: (request: PluginFrontRuntimeServeRequest) => Promise<PluginFrontRuntimeResponse>
  close: () => Promise<void>
}

function searchFromRawUrl(url: string | undefined): string {
  return url?.includes("?") ? url.slice(url.indexOf("?")) : ""
}

function pathFromRawUrl(url: string | undefined, fallback: string): string {
  return url?.split("?")[0] ?? fallback
}

type ForwardableRequest = { raw: NodeJS.ReadableStream & { url?: string } }
type ForwardableReply = {
  raw: NodeJS.WritableStream & { statusCode?: number; setHeader?: (name: string, value: string) => void; end: (chunk?: unknown) => void; writableEnded?: boolean }
  hijack: () => void
}

/** Hands the request to Vite's own middleware stack for anything the routes below do not transform themselves. */
async function forwardToVite(vite: ViteDevServer, request: ForwardableRequest, reply: ForwardableReply): Promise<void> {
  reply.hijack()
  await new Promise<void>((resolve, reject) => {
    vite.middlewares(request.raw as never, reply.raw as never, (error: unknown) => {
      if (error) reject(error)
      else resolve()
    })
  })
  if (!reply.raw.writableEnded) {
    reply.raw.statusCode = 404
    reply.raw.end()
  }
}

export async function registerRuntimeRoutes(app: FastifyInstance, deps: RuntimeRouteDependencies): Promise<void> {
  const { basePath, vite, minted, hostNodeModulesRoots } = deps

  const sendApiError = (reply: FastifyReply, error: PluginFrontRuntimeError) => {
    const apiError = toApiError(error)
    return reply.code(apiError.statusCode).send(apiError.body)
  }

  /**
   * Support routes are capability-gated: a `__vite/*` path is only serveable
   * once a validated plugin module's transform output minted it.
   */
  const requireMintedPath = (request: FastifyRequest, fallbackPath: string, subject: "support" | "singleton"): string | PluginFrontRuntimeError => {
    const mintedPath = pathFromRawUrl(request.raw.url, fallbackPath)
    if (minted.has(mintedPath)) return mintedPath
    return new PluginFrontRuntimeError(
      ErrorCode.enum.PATH_NOT_FOUND,
      404,
      "validate",
      `vite ${subject} path was not minted by a validated runtime module`,
      { targetPath: mintedPath },
    )
  }

  app.get(`${basePath}/:workspaceId/:pluginId/:revision/*`, async (request, reply) => {
    const params = request.params as { workspaceId: string; pluginId: string; revision: string; "*": string }
    try {
      const response = await deps.serve({
        workspaceId: params.workspaceId,
        pluginId: params.pluginId,
        revision: params.revision,
        subpath: params["*"],
        search: searchFromRawUrl(request.raw.url),
      })
      return reply.type(response.contentType).send(response.body)
    } catch (error) {
      const apiError = toApiError(error)
      return reply.code(apiError.statusCode).send(apiError.body)
    }
  })

  app.get(`${basePath}/__vite/client`, async (request, reply) => {
    const mintedPath = requireMintedPath(request, `${basePath}/__vite/client`, "support")
    if (mintedPath instanceof PluginFrontRuntimeError) return sendApiError(reply, mintedPath)

    const transformed = await vite.transformRequest("/@vite/client")
    if (transformed?.code) {
      const rewritten = rewriteViteSupportUrls(transformed.code, basePath, { hostNodeModulesRoots })
      minted.record("__vite:client", rewritten.mintedPaths)
      return reply.type(JAVASCRIPT_CONTENT_TYPE).send(rewritten.code)
    }
    request.raw.url = "/@vite/client"
    await forwardToVite(vite, request, reply)
  })

  app.get(`${basePath}/__vite/env`, async (request, reply) => {
    request.raw.url = "/@vite/env"
    await forwardToVite(vite, request, reply)
  })

  app.get(`${basePath}/__vite/singleton/*`, async (request, reply) => {
    const { "*": encodedSource } = request.params as { "*": string }
    const mintedPath = requireMintedPath(request, `${basePath}/__vite/singleton/${encodedSource}`, "singleton")
    if (mintedPath instanceof PluginFrontRuntimeError) return sendApiError(reply, mintedPath)

    const source = decodeURIComponent(encodedSource)
    const code = runtimeSingletonModuleCodeFor(source)
    if (!code) {
      return sendApiError(reply, new PluginFrontRuntimeError(
        ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
        400,
        "validate",
        "unsupported runtime singleton path",
        { source },
      ))
    }
    return reply.type(JAVASCRIPT_CONTENT_TYPE).send(code)
  })

  app.get(`${basePath}/__vite/proxy/*`, async (request, reply) => {
    const { "*": encodedTarget } = request.params as { "*": string }
    const mintedPath = requireMintedPath(request, `${basePath}/__vite/proxy/${encodedTarget}`, "support")
    if (mintedPath instanceof PluginFrontRuntimeError) return sendApiError(reply, mintedPath)

    const targetPath = `/${decodeURIComponent(encodedTarget)}`
    const isHostNodeModuleFsTarget = isHostNodeModuleFsSpecifier(targetPath, hostNodeModulesRoots)
    if (!VITE_PROXYABLE_PATH_RE.test(targetPath) && !isHostNodeModuleFsTarget) {
      return sendApiError(reply, new PluginFrontRuntimeError(
        ErrorCode.enum.PLUGIN_RUNTIME_UNSAFE_IMPORT,
        400,
        "validate",
        "unsupported Vite support path",
        { targetPath },
      ))
    }

    const viteTargetPath = targetPath.startsWith("/@id/__x00__") ? `\0${targetPath.slice("/@id/__x00__".length)}` : targetPath
    const transformed = await vite.transformRequest(`${viteTargetPath}${normalizeSearch(searchFromRawUrl(request.raw.url))}`)
    if (transformed?.code) {
      const rewritten = rewriteViteSupportUrls(transformed.code, basePath, { hostNodeModulesRoots, allowHostNodeModulesFs: isHostNodeModuleFsTarget })
      assertNoUnsafeFsSupportReference(rewritten.code, { targetPath })
      minted.record(`support:${mintedPath}`, rewritten.mintedPaths)
      return reply.type(JAVASCRIPT_CONTENT_TYPE).send(rewritten.code)
    }

    request.raw.url = targetPath
    await forwardToVite(vite, request, reply)
  })

  app.addHook("onClose", async () => {
    await deps.close()
  })
}
