"use client"

import { createElement, useMemo, type ReactNode } from "react"
import type { CapturedFrontPlugin } from "../../shared/plugins/frontFactory"
import type { AppLeftPaneAction } from "../../front/layout/plugin-tabs/AppLeftPane"
import { AppLeftOverlayChromeProvider } from "../../front/layout/plugin-tabs/AppLeftOverlayChromeContext"
import { PluginErrorBoundary } from "../../front/plugin/PluginErrorBoundary"

export type AppLeftOverlayId = string | null

export function pluginAppLeftActionIds(plugins: readonly CapturedFrontPlugin[]): ReadonlySet<string> {
  return new Set(plugins.flatMap((plugin) => plugin.registrations.appLeftActions.map((action) => action.id)))
}

export function assertUniqueAppLeftActionIds(actions: readonly AppLeftPaneAction[]): void {
  const owners = new Map<string, string>()
  for (const action of actions) {
    const previous = owners.get(action.id)
    if (previous) {
      throw new Error(`duplicate app-left action id "${action.id}" registered by ${previous} and ${action.label}`)
    }
    owners.set(action.id, action.label)
  }
}

export function usePluginAppLeftActions({
  plugins,
  activeOverlay,
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
    .map(({ plugin, action }) => {
      const Icon = action.icon
      const Trailing = action.trailing
      return {
        id: action.id,
        label: action.label,
        icon: Icon ? createElement(
          PluginErrorBoundary,
          { pluginId: plugin.id, contributionKind: "app-left-action", contributionId: `${action.id}:icon` },
          createElement(Icon, { className: "h-4 w-4" }),
        ) : null,
        trailing: Trailing ? createElement(
          PluginErrorBoundary,
          { pluginId: plugin.id, contributionKind: "app-left-action", contributionId: `${action.id}:trailing` },
          createElement(Trailing),
        ) : undefined,
        emphasis: action.emphasis,
        active: activeOverlay === action.id,
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
  params,
}: {
  plugins: readonly CapturedFrontPlugin[]
  activeOverlay: AppLeftOverlayId
  onClose: () => void
  headerInsetStart?: boolean
  headerInsetEnd?: boolean
  params?: Readonly<Record<string, string>>
}): ReactNode {
  if (!activeOverlay) return null
  const entry = plugins
    .flatMap((plugin) => plugin.registrations.appLeftActions.map((action) => ({ plugin, action })))
    .find(({ action }) => action.id === activeOverlay)
  if (!entry?.action.overlay) return null
  return createElement(
    AppLeftOverlayChromeProvider,
    { value: { headerInsetStart: Boolean(headerInsetStart), headerInsetEnd: Boolean(headerInsetEnd) } },
    createElement(
      PluginErrorBoundary,
      { pluginId: entry.plugin.id, contributionKind: "app-left-action", contributionId: entry.action.id },
      createElement(entry.action.overlay, { onClose, params }),
    ),
  )
}
