import {
  WorkspaceFilesProvider,
  useHasWorkspaceFilesProvider,
  type PluginProviderProps,
} from "@hachej/boring-workspace"
import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import {
  DECK_LABEL,
  DECK_PANEL_ID,
  DECK_PATH_PREFIX,
  DECK_PLUGIN_ID,
  normalizeDeckPath,
  type CreateDeckPluginOptions,
} from "../shared"
import { DeckPane } from "./DeckPane"
import { StandaloneDeckRoute } from "./StandaloneDeckRoute"
import { createDeckSurfaceResolver, deckSurfaceResolver } from "./surfaceResolver"
import { validateDeckWidgets } from "./widgets"

function DeckFilesProvider({
  apiBaseUrl,
  authHeaders,
  onAuthError,
  apiTimeout,
  children,
}: PluginProviderProps) {
  const hasWorkspaceFilesProvider = useHasWorkspaceFilesProvider()

  if (hasWorkspaceFilesProvider) {
    return <>{children}</>
  }

  return (
    <WorkspaceFilesProvider
      apiBaseUrl={apiBaseUrl}
      authHeaders={authHeaders}
      onAuthError={onAuthError}
      timeout={apiTimeout}
    >
      {children}
    </WorkspaceFilesProvider>
  )
}

export function createDeckPlugin(options: CreateDeckPluginOptions = {}): BoringFrontFactoryWithId {
  const pathPrefix = normalizeDeckPath(options.pathPrefix ?? DECK_PATH_PREFIX)
  validateDeckWidgets(options.widgets ?? [])

  return definePlugin({
    id: DECK_PLUGIN_ID,
    label: DECK_LABEL,
    providers: [
      {
        id: "deck-files",
        component: DeckFilesProvider,
      },
    ],
    panels: [
      {
        id: DECK_PANEL_ID,
        label: DECK_LABEL,
        component: (props) => (
          <DeckPane
            {...props}
            pathPrefix={pathPrefix}
            theme={options.theme}
            widgets={options.widgets}
            onError={options.onError}
          />
        ),
        placement: "center",
        source: "app",
        supportsFullPage: true,
      },
    ],
    surfaceResolvers: [createDeckSurfaceResolver(pathPrefix)],
  })
}

const deckPlugin = createDeckPlugin({ pathPrefix: DECK_PATH_PREFIX })

export default deckPlugin

export { DeckPane, StandaloneDeckRoute, createDeckSurfaceResolver, deckSurfaceResolver }
