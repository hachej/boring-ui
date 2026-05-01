import micromatch from "micromatch"
import type {
  SurfaceOpenRequest,
  SurfacePanelResolution,
  SurfaceResolverConfig,
} from "../../shared/types/surface"
import { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../shared/types/surface"
import {
  CODE_EDITOR_PANEL_ID,
  CSV_VIEWER_PANEL_ID,
  EMPTY_FILE_PANEL_ID,
  FILESYSTEM_SURFACE_RESOLVER_ID,
  MARKDOWN_EDITOR_PANEL_ID,
} from "./constants"

interface FilesystemSurfaceHandler {
  component: string
  patterns?: string[]
  fallback?: boolean
}

const handlers: FilesystemSurfaceHandler[] = [
  {
    component: CODE_EDITOR_PANEL_ID,
    patterns: [
      "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx",
      "**/*.py", "**/*.rs", "**/*.go",
      "**/*.json", "**/*.yml", "**/*.yaml",
      "**/*.toml", "**/*.css", "**/*.html", "**/*.svg",
      "**/*.sh", "**/*.sql", "**/*.graphql",
    ],
  },
  {
    component: CSV_VIEWER_PANEL_ID,
    patterns: ["**/*.csv", "**/*.tsv", "**/*.data"],
  },
  {
    component: MARKDOWN_EDITOR_PANEL_ID,
    patterns: ["**/*.md", "**/*.mdx"],
  },
  {
    component: EMPTY_FILE_PANEL_ID,
    fallback: true,
  },
]

export function patternSpecificity(pattern: string): number {
  const segmentCount = pattern.split("/").filter(Boolean).length
  const nonWildcardChars = pattern.replace(/[*?!]/g, "").length
  return segmentCount * 10 + nonWildcardChars
}

function titleFromPath(path: string): string {
  return path.split("/").pop() ?? path
}

function matchFilesystemPath(path: string): FilesystemSurfaceHandler | undefined {
  let best: FilesystemSurfaceHandler | undefined
  let bestScore = -1

  for (const handler of handlers) {
    for (const pattern of handler.patterns ?? []) {
      if (!micromatch.isMatch(path, pattern, { matchBase: false, dot: true })) continue
      const score = patternSpecificity(pattern)
      if (score >= bestScore) {
        best = handler
        bestScore = score
      }
    }
  }

  return best ?? handlers.find((handler) => handler.fallback)
}

export const filesystemSurfaceResolver: SurfaceResolverConfig = {
  id: FILESYSTEM_SURFACE_RESOLVER_ID,
  source: "builtin",
  resolve(request: SurfaceOpenRequest): SurfacePanelResolution | undefined {
    if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return undefined
    const path = request.target
    const handler = matchFilesystemPath(path)
    if (!handler) return undefined
    return {
      id: `file:${path}`,
      component: handler.component,
      title: titleFromPath(path),
      params: { path },
      score: handler.fallback ? -1 : 0,
    }
  },
}

export const filesystemSurfaceHandlers = handlers
