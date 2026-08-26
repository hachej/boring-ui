import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The mobile shell pads itself with `env(safe-area-inset-*)`. Those values are
 * all reported as `0px` unless the host document opts in with
 * `viewport-fit=cover`, so a host that ships the default viewport meta silently
 * disables every inset in the shell. This guards the hosts against that
 * regression, which is otherwise invisible on desktop and in jsdom.
 *
 * The same hosts must also opt into `interactive-widget=resizes-content`:
 * Android Chrome >= 108 otherwise keeps the layout viewport at full height
 * when the software keyboard opens, putting the composer underneath it.
 */
function repoRoot(): string {
  let dir = dirname(new URL(import.meta.url).pathname)
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir
    dir = dirname(dir)
  }
  throw new Error("could not locate the repo root from the test file")
}

const HOSTS = [
  "apps/full-app/index.html",
  "apps/workspace-playground/index.html",
  "apps/agent-playground/index.html",
  "packages/cli/index.html",
]

describe("host viewport meta", () => {
  const root = repoRoot()

  it.each(HOSTS)("%s opts into viewport-fit=cover so safe-area insets resolve", (host) => {
    const html = readFileSync(join(root, host), "utf8")
    const meta = html.match(/<meta\s+name="viewport"[^>]*>/)

    expect(meta, `${host} declares no viewport meta`).not.toBeNull()
    expect(meta?.[0]).toContain("viewport-fit=cover")
  })

  it.each(HOSTS)("%s opts into interactive-widget=resizes-content so the keyboard shrinks the layout viewport", (host) => {
    const html = readFileSync(join(root, host), "utf8")
    const meta = html.match(/<meta\s+name="viewport"[^>]*>/)

    expect(meta, `${host} declares no viewport meta`).not.toBeNull()
    expect(meta?.[0]).toContain("interactive-widget=resizes-content")
  })
})
