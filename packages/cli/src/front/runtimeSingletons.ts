import * as React from "react"
import * as ReactDom from "react-dom"
import * as ReactDomClient from "react-dom/client"
import * as ReactJsxRuntime from "react/jsx-runtime"
import * as WorkspaceEventsSingleton from "@hachej/boring-workspace/events"
import * as WorkspacePluginSingleton from "@hachej/boring-workspace/plugin"

declare global {
  var __BORING_RUNTIME_SINGLETONS__: Record<string, unknown> | undefined
}

export function installCliRuntimeSingletons(): void {
  globalThis.__BORING_RUNTIME_SINGLETONS__ = {
    ...globalThis.__BORING_RUNTIME_SINGLETONS__,
    react: React,
    "react-dom": ReactDom,
    "react-dom/client": ReactDomClient,
    "react/jsx-runtime": ReactJsxRuntime,
    "@hachej/boring-workspace/events": WorkspaceEventsSingleton,
    "@hachej/boring-workspace/plugin": WorkspacePluginSingleton,
  }

  if (import.meta.env.DEV) {
    void import("react/jsx-dev-runtime").then((runtime) => {
      globalThis.__BORING_RUNTIME_SINGLETONS__ = {
        ...globalThis.__BORING_RUNTIME_SINGLETONS__,
        "react/jsx-dev-runtime": runtime,
      }
    })
  }
}

interface WorkspaceRuntimeSingletonLoaders {
  loadWorkspace: () => Promise<typeof import("@hachej/boring-workspace")>
  loadReactJsxDevRuntime: () => Promise<typeof import("react/jsx-dev-runtime")>
}

const DEFAULT_WORKSPACE_RUNTIME_SINGLETON_LOADERS: WorkspaceRuntimeSingletonLoaders = {
  loadWorkspace: () => import("@hachej/boring-workspace"),
  loadReactJsxDevRuntime: () => import("react/jsx-dev-runtime"),
}

export async function loadWorkspaceRuntimeSingleton(
  loaders: WorkspaceRuntimeSingletonLoaders = DEFAULT_WORKSPACE_RUNTIME_SINGLETON_LOADERS,
): Promise<void> {
  const [workspace, reactJsxDevRuntime] = await Promise.all([
    loaders.loadWorkspace(),
    loaders.loadReactJsxDevRuntime(),
  ])
  globalThis.__BORING_RUNTIME_SINGLETONS__ = {
    ...globalThis.__BORING_RUNTIME_SINGLETONS__,
    "react/jsx-dev-runtime": reactJsxDevRuntime,
    "@hachej/boring-workspace": workspace,
  }
}
