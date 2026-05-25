import { WORKSPACE_OPEN_PATH_SURFACE_KIND, type BoringFrontSurfaceResolverRegistration } from "@hachej/boring-workspace/plugin"

export function createDeckSurfaceResolver(pathPrefix: string): BoringFrontSurfaceResolverRegistration {
  const normalizedPrefix = pathPrefix.endsWith("/") ? pathPrefix : `${pathPrefix}/`

  return {
    id: "deck.open-path",
    kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
    source: "app",
    resolve: (request) => {
      if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return null
      if (!request.target.startsWith(normalizedPrefix)) return null
      if (!request.target.endsWith(".md")) return null
      return null
    },
  }
}

export const deckSurfaceResolver = createDeckSurfaceResolver("deck/")
