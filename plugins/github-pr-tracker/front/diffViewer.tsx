import React from "react"
import { PatchDiff } from "@pierre/diffs/react"
import type { FileDiffOptions } from "@pierre/diffs"
import type { DiffFile } from "./types"

export type DiffLayout = "unified" | "split"

const diffMetrics = {
  hunkLineCount: 80,
  lineHeight: 20,
  diffHeaderHeight: 44,
  hunkSeparatorHeight: 34,
  spacing: 8,
}

const diffUnsafeCss = `
:host {
  --diffs-font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --diffs-font-size: 12px;
  --diffs-line-height: 20px;
}
[data-diffs-header] { display: none; }
`

function colorMode(): "light" | "dark" {
  if (typeof window === "undefined") return "dark"
  const root = document.documentElement
  const explicit = root.classList.contains("dark") || root.dataset.theme === "dark"
  if (explicit) return "dark"
  const scheme = getComputedStyle(root).colorScheme.toLowerCase()
  if (scheme.includes("light") && !scheme.includes("dark")) return "light"
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

export function DiffViewer({ file, prUrl, layout = "unified" }: { file: DiffFile; prUrl?: string; layout?: DiffLayout }) {
  const [themeType, setThemeType] = React.useState<"light" | "dark">(() => colorMode())

  React.useEffect(() => {
    const update = () => setThemeType(colorMode())
    const media = window.matchMedia?.("(prefers-color-scheme: light)")
    media?.addEventListener?.("change", update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] })
    return () => {
      media?.removeEventListener?.("change", update)
      observer.disconnect()
    }
  }, [])

  if (!file.patch) {
    return (
      <div className="space-y-1 p-6 text-center text-xs text-muted-foreground">
        <p>No patch text for this file — GitHub omits it for binary or very large diffs.</p>
        {prUrl && (
          <a className="inline-block text-foreground hover:underline" href={`${prUrl}/files`} target="_blank" rel="noreferrer">
            View on GitHub ↗
          </a>
        )}
      </div>
    )
  }

  const options: FileDiffOptions<undefined> = {
    diffStyle: layout,
    hunkSeparators: "line-info-basic",
    lineDiffType: "word",
    overflow: "wrap",
    theme: { light: "pierre-light", dark: "pierre-dark" },
    themeType,
    unsafeCSS: diffUnsafeCss,
  }

  return (
    <div className="github-pr-tracker-diff min-w-0 text-xs">
      <PatchDiff
        key={`${file.path}:${layout}:${themeType}`}
        patch={file.patch}
        options={options}
        metrics={diffMetrics}
        disableWorkerPool
      />
    </div>
  )
}
