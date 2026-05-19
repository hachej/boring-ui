import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

export interface ScaffoldPluginOptions {
  /** Plugin id — must be kebab-case, used as folder name + npm package name. */
  name: string
  /** Workspace root the .pi/extensions/<name>/ folder is created under. */
  workspaceRoot: string
}

export interface ScaffoldPluginResult {
  pluginDir: string
  filesCreated: string[]
}

const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export function scaffoldPlugin(opts: ScaffoldPluginOptions): ScaffoldPluginResult {
  if (!KEBAB_RE.test(opts.name)) {
    throw new Error(
      `invalid plugin name "${opts.name}" — must be kebab-case (e.g. "my-plugin")`,
    )
  }
  const workspaceRoot = resolve(opts.workspaceRoot)
  const pluginDir = join(workspaceRoot, ".pi", "extensions", opts.name)
  if (existsSync(pluginDir)) {
    throw new Error(`plugin already exists at ${pluginDir}`)
  }

  const filesCreated: string[] = []
  const write = (relPath: string, contents: string) => {
    const target = join(pluginDir, relPath)
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, contents, "utf8")
    filesCreated.push(target)
  }

  const label = labelFromName(opts.name)
  write("package.json", packageJsonTemplate(opts.name, label))
  write("front/index.tsx", frontTemplate(opts.name, label))

  return { pluginDir, filesCreated }
}

function labelFromName(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function packageJsonTemplate(name: string, label: string): string {
  return `${JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      boring: {
        label,
        front: "front/index.tsx",
        server: false,
      },
      pi: {
        systemPrompt: `${label} plugin — describe what it does so the agent knows when to use it.`,
      },
    },
    null,
    2,
  )}\n`
}

function frontTemplate(name: string, label: string): string {
  const panelId = `${name}.panel`
  const commandId = `${name}.open`
  const tabId = `${name}.tab`
  return `import React from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"

function ${pascalCase(name)}Pane() {
  return <div style={{ padding: 16 }}>${label} — edit front/index.tsx and run /reload.</div>
}

export default definePlugin(
  ${JSON.stringify(name)},
  (api) => {
    api.registerPanel({
      id: ${JSON.stringify(panelId)},
      label: ${JSON.stringify(label)},
      component: ${pascalCase(name)}Pane,
    })
    api.registerPanelCommand({
      id: ${JSON.stringify(commandId)},
      title: ${JSON.stringify(`Open ${label}`)},
      panelId: ${JSON.stringify(panelId)},
    })
    api.registerLeftTab({
      id: ${JSON.stringify(tabId)},
      title: ${JSON.stringify(label)},
      panelId: ${JSON.stringify(panelId)},
    })
  },
  { label: ${JSON.stringify(label)} },
)
`
}

function pascalCase(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}
