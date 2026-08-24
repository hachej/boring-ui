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

export async function loadWorkspaceRuntimeSingleton(): Promise<void> {
  const workspace = await import("@hachej/boring-workspace")
  globalThis.__BORING_RUNTIME_SINGLETONS__ = {
    ...globalThis.__BORING_RUNTIME_SINGLETONS__,
    "@hachej/boring-workspace": workspace,
  }
}
