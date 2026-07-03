import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import {
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
  SHAREPOINT_ERROR_CODES,
  type CreateOfficePreviewUrlResult,
  type IntegrationAuthState,
  type OfficeEditRequest,
  type OfficeEditResult,
  type ResolveDriveItemInput,
  type SharePointDocumentRef,
  type SharePointProvider,
  type SharePointProviderContext,
} from "../shared"
import { loadArcadeSharePointRuntimeConfig, requireArcadeSharePointRuntimeConfig, type ArcadeSharePointRuntimeConfigInput } from "./arcadeConfig"
import { ArcadeJsToolRuntime } from "./arcadeRuntime"
import { sharePointRoutes } from "./routes"
import { ArcadeSharePointProvider, SharePointProviderError } from "./sharePointProvider"

export interface SharePointServerPluginOptions {
  provider?: SharePointProvider
  arcadeConfig?: ArcadeSharePointRuntimeConfigInput
  getContext?: (request: FastifyRequest) => SharePointProviderContext | Promise<SharePointProviderContext>
}

export function createSharePointServerPlugin(options: SharePointServerPluginOptions = {}): WorkspaceServerPlugin {
  const provider = options.provider ?? createProviderFromConfig(options.arcadeConfig)
  const routes: FastifyPluginAsync = async (app) => {
    await app.register(sharePointRoutes, { provider, getContext: options.getContext })
  }

  return defineServerPlugin({
    id: BORING_SHAREPOINT_PLUGIN_ID,
    label: BORING_SHAREPOINT_PLUGIN_LABEL,
    systemPrompt:
      "SharePoint / Microsoft 365 integration is installed. It can resolve SharePoint-hosted Excel and PowerPoint documents into cloud refs; preview and Office edits are not enabled yet.",
    routes,
  })
}

function createProviderFromConfig(configInput?: ArcadeSharePointRuntimeConfigInput): SharePointProvider {
  const loaded = configInput ?? loadArcadeSharePointRuntimeConfig()
  try {
    const config = requireArcadeSharePointRuntimeConfig(loaded)
    return new ArcadeSharePointProvider({ runtime: new ArcadeJsToolRuntime(config) })
  } catch (error) {
    return new UnconfiguredSharePointProvider(error instanceof Error ? error.message : "SharePoint Arcade runtime is not configured")
  }
}

class UnconfiguredSharePointProvider implements SharePointProvider {
  constructor(private readonly message: string) {}

  async getStatus(): Promise<IntegrationAuthState> {
    return { status: "failed", code: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE, message: this.message }
  }

  async authorize(): Promise<IntegrationAuthState> {
    return { status: "failed", code: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE, message: this.message }
  }

  async resolveDriveItem(_input: ResolveDriveItemInput): Promise<SharePointDocumentRef> {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE, this.message, 503)
  }

  async createOfficePreviewUrl(): Promise<CreateOfficePreviewUrlResult> {
    throw new SharePointProviderError(SHAREPOINT_ERROR_CODES.PREVIEW_UNAVAILABLE, "SharePoint Office preview URLs are not implemented yet", 501)
  }

  async editOfficeDocument(_ref: SharePointDocumentRef, _request: OfficeEditRequest): Promise<OfficeEditResult> {
    return { status: "failed", code: SHAREPOINT_ERROR_CODES.PROVIDER_UNAVAILABLE, message: "SharePoint Office edits are not implemented yet" }
  }
}
