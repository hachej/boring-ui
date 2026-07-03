"use client"

import { createElement, useMemo, type ReactNode } from "react"
import type { CapturedFrontPlugin } from "../../shared/plugins/frontFactory"
import type { AppLeftPaneAction } from "../../front/layout/plugin-tabs/AppLeftPane"

export type AppLeftOverlayId = string | null

export function pluginAppLeftActionIds(plugins: readonly CapturedFrontPlugin[]): ReadonlySet<string> {
  return new Set(plugins.flatMap((plugin) => plugin.registrations.appLeftActions.map((action) => action.id)))
}

export function usePluginAppLeftActions({
  plugins,
  setActiveOverlay,
}: {
  plugins: readonly CapturedFrontPlugin[]
  activeOverlay: AppLeftOverlayId
  setActiveOverlay: (next: AppLeftOverlayId | ((current: AppLeftOverlayId) => AppLeftOverlayId)) => void
}): AppLeftPaneAction[] {
  return useMemo(() => plugins
    .flatMap((plugin) => plugin.registrations.appLeftActions.map((action) => ({ plugin, action })))
    .sort((a, b) => (a.action.order ?? 0) - (b.action.order ?? 0)
      || (a.plugin.label ?? a.plugin.id).localeCompare(b.plugin.label ?? b.plugin.id)
      || a.action.label.localeCompare(b.action.label)
      || a.action.id.localeCompare(b.action.id))
    .map(({ action }) => {
      const Icon = action.icon
      const Trailing = action.trailing
      return {
        id: action.id,
        label: action.label,
        icon: Icon ? createElement(Icon, { className: "h-4 w-4" }) : null,
        trailing: Trailing ? createElement(Trailing) : undefined,
        emphasis: action.emphasis,
        onClick: () => {
          setActiveOverlay((current) => current === action.id ? null : action.id)
        },
      }
    }), [plugins, setActiveOverlay])
}

export function PluginAppLeftOverlayHost({
  plugins,
  activeOverlay,
  onClose,
  headerInsetStart,
  headerInsetEnd,
}: {
  plugins: readonly CapturedFrontPlugin[]
  activeOverlay: AppLeftOverlayId
  onClose: () => void
  headerInsetStart?: boolean
  headerInsetEnd?: boolean
}): ReactNode {
  if (!activeOverlay) return null
  const entry = plugins
    .flatMap((plugin) => plugin.registrations.appLeftActions)
    .find((action) => action.id === activeOverlay)
  if (!entry?.overlay) return null
  return createElement(entry.overlay, { onClose, headerInsetStart, headerInsetEnd })
}
