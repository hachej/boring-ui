import { createContext, createElement, useContext, type ReactNode } from "react"

export interface AppLeftOverlayChromeValue {
  headerInsetStart: boolean
  headerInsetEnd: boolean
}

const defaultValue: AppLeftOverlayChromeValue = {
  headerInsetStart: false,
  headerInsetEnd: false,
}

const AppLeftOverlayChromeContext = createContext<AppLeftOverlayChromeValue>(defaultValue)

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
