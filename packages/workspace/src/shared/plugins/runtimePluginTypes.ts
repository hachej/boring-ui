import type {
  BoringPackageBoringField,
  BoringPackagePiField,
} from "./manifest"

export type BoringPluginNativeFrontTargetTrust = "local-trusted-native"

/**
 * Host-owned runtime import target for a plugin front entry.
 *
 * Only the trusted native/browser-module case exists today. Future
 * target kinds (iframe/artifact/...) can extend the union without
 * rewriting list/event payload shapes.
 */
export interface BoringPluginNativeFrontTarget {
  kind: "native"
  entryUrl: string
  revision: number
  trust: BoringPluginNativeFrontTargetTrust
}

export type BoringPluginFrontTarget = BoringPluginNativeFrontTarget

export type BoringPluginEvent =
  | {
      type: "boring.plugin.load"
      id: string
      boring: BoringPackageBoringField
      version: string
      revision: number
      frontUrl?: string
      frontTarget?: BoringPluginFrontTarget
    }
  | { type: "boring.plugin.unload"; id: string; revision: number }
  | { type: "boring.plugin.error"; id: string; revision: number; message: string }

export interface BoringPluginListEntry {
  id: string
  boring: BoringPackageBoringField
  pi?: BoringPackagePiField
  version: string
  revision: number
  frontUrl?: string
  frontTarget?: BoringPluginFrontTarget
}
