import { WORKSPACE_OPEN_PATH_SURFACE_KIND, type BoringFrontSurfaceResolverRegistration } from "@hachej/boring-workspace/plugin"
import { DECK_PANEL_ID, isDeckMarkdownPath, normalizeDeckPath } from "../shared"

function basename(path: string): string {
  const normalized = normalizeDeckPath(path)
  return normalized.split("/").pop() ?? path
}

export function createDeckSurfaceResolver(pathPrefix: string): BoringFrontSurfaceResolverRegistration {
  const normalizedPrefix = normalizeDeckPath(pathPrefix)

  return {
    id: "deck.open-path",
    kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
    source: "app",
    resolve: (request) => {
      if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return null

      const target = normalizeDeckPath(request.target)
      if (!isDeckMarkdownPath(target, normalizedPrefix)) return null

      return {
        component: DECK_PANEL_ID,
        title: basename(target),
        params: { path: target },
        score: 100,
      }
    },
  }
}

export const deckSurfaceResolver = createDeckSurfaceResolver("deck/")
