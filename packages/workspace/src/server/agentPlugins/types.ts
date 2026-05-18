import type {
  BoringPackageBoringField,
  BoringPackagePiField,
} from "../../shared/plugins/manifest"

export interface BoringServerPluginManifest {
  id: string
  rootDir: string
  version: string
  boring: BoringPackageBoringField
  pi?: BoringPackagePiField
  frontPath?: string
  frontUrl?: string
  serverPath?: string
  extensionPaths?: string[]
  skillPaths?: string[]
}

export type BoringPluginEvent =
  | {
      type: "boring.plugin.load"
      id: string
      boring: BoringPackageBoringField
      version: string
      revision: number
      frontUrl?: string
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
}
