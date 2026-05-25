import { WORKSPACE_OPEN_PATH_SURFACE_KIND, type BoringFrontSurfaceResolverRegistration } from "@hachej/boring-workspace/plugin"
import { DECK_PANEL_ID } from "../shared"

function normalizePrefix(pathPrefix: string): string {
  return pathPrefix.endsWith("/") ? pathPrefix : `${pathPrefix}/`
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  return normalized.split("/").pop() ?? path
}

export function createDeckSurfaceResolver(pathPrefix: string): BoringFrontSurfaceResolverRegistration {
  const normalizedPrefix = normalizePrefix(pathPrefix)

  return {
    id: "deck.open-path",
    kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
    source: "app",
    resolve: (request) => {
      if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return null
      if (!request.target.startsWith(normalizedPrefix)) return null
      if (!request.target.endsWith(".md")) return null
      return {
        component: DECK_PANEL_ID,
        title: basename(request.target),
        params: { path: request.target },
        score: 100,
      }
    },
  }
}

export const deckSurfaceResolver = createDeckSurfaceResolver("deck/")
