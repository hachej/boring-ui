import { createContext, createElement, useContext, type Context, type ReactNode } from "react"

export interface AppLeftOverlayChromeValue {
  headerInsetStart: boolean
  headerInsetEnd: boolean
}

const defaultValue: AppLeftOverlayChromeValue = {
  headerInsetStart: false,
  headerInsetEnd: false,
}

// The plugin API and app host ship as separate entry bundles. Both can contain
// this module, and two module-local React contexts do not communicate. Anchor
// the context identity on globalThis so dist plugins consume the source host's
// provider (and vice versa) instead of silently falling back to false insets.
const GLOBAL_CONTEXT_KEY = "__hachej_boring_workspace_app_left_overlay_chrome__" as const
type ContextRegistry = typeof globalThis & {
  [GLOBAL_CONTEXT_KEY]?: Context<AppLeftOverlayChromeValue>
}
const contextRegistry = globalThis as ContextRegistry
const AppLeftOverlayChromeContext = contextRegistry[GLOBAL_CONTEXT_KEY]
  ?? createContext<AppLeftOverlayChromeValue>(defaultValue)
contextRegistry[GLOBAL_CONTEXT_KEY] = AppLeftOverlayChromeContext

export function AppLeftOverlayChromeProvider({
  value,
  children,
}: {
  value: AppLeftOverlayChromeValue
  children?: ReactNode
}) {
  return createElement(AppLeftOverlayChromeContext.Provider, { value }, children)
}

export function useAppLeftOverlayChrome(): AppLeftOverlayChromeValue {
  return useContext(AppLeftOverlayChromeContext)
}
