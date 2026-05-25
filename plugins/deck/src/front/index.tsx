import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import {
  DECK_LABEL,
  DECK_PANEL_ID,
  DECK_PATH_PREFIX,
  DECK_PLUGIN_ID,
  type CreateDeckPluginOptions,
} from "../shared"
import { DeckPane } from "./DeckPane"
import { StandaloneDeckRoute } from "./StandaloneDeckRoute"
import { createDeckSurfaceResolver, deckSurfaceResolver } from "./surfaceResolver"
import { validateDeckWidgets } from "./widgets"

export function createDeckPlugin(options: CreateDeckPluginOptions = {}): BoringFrontFactoryWithId {
  const pathPrefix = options.pathPrefix ?? DECK_PATH_PREFIX
  validateDeckWidgets(options.widgets ?? [])

  return definePlugin({
    id: DECK_PLUGIN_ID,
    label: DECK_LABEL,
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
      },
    ],
    surfaceResolvers: [createDeckSurfaceResolver(pathPrefix)],
  })
}

const deckPlugin = createDeckPlugin({ pathPrefix: DECK_PATH_PREFIX })

export default deckPlugin

export { DeckPane, StandaloneDeckRoute, createDeckSurfaceResolver, deckSurfaceResolver }
