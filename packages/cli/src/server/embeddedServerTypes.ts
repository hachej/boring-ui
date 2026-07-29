export interface EmbeddedBoringUiRequestCapability {
  headerName: string
  token: string
}

export interface EmbeddedBoringUiServerOptions {
  requestCapability: EmbeddedBoringUiRequestCapability
  publicDir?: string
  registryPath?: string
  mode?: "direct" | "local"
  provisionWorkspace?: boolean
}

export interface EmbeddedBoringUiServer {
  origin: string
  initialUrl: string
  close(): Promise<void>
}

export declare function startEmbeddedBoringUiServer(
  options: EmbeddedBoringUiServerOptions,
): Promise<EmbeddedBoringUiServer>
