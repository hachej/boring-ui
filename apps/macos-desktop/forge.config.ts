import { resolve } from "node:path"
import type { ForgeConfig } from "@electron-forge/shared-types"
import { MakerDMG } from "@electron-forge/maker-dmg"
import { MakerZIP } from "@electron-forge/maker-zip"

function completeNotarizationConfig(): NonNullable<NonNullable<ForgeConfig["packagerConfig"]>["osxNotarize"]> | undefined {
  const appleApiKey = process.env.APPLE_API_KEY
  const appleApiKeyId = process.env.APPLE_API_KEY_ID
  const appleApiIssuer = process.env.APPLE_API_ISSUER
  const configured = [appleApiKey, appleApiKeyId, appleApiIssuer].filter(Boolean).length
  if (configured > 0 && configured < 3) {
    throw new Error("APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER must be set together")
  }
  return configured === 3
    ? { appleApiKey: appleApiKey!, appleApiKeyId: appleApiKeyId!, appleApiIssuer: appleApiIssuer! }
    : undefined
}

const signingIdentity = process.env.BORING_MAC_SIGN_IDENTITY
const notarization = completeNotarizationConfig()
if (notarization && !signingIdentity) {
  throw new Error("BORING_MAC_SIGN_IDENTITY is required when notarization is configured")
}
const entitlements = resolve(import.meta.dirname, "entitlements.plist")

const config: ForgeConfig = {
  packagerConfig: {
    name: "Boring UI",
    executableName: "boring-ui",
    appBundleId: "com.hachej.boring-ui",
    asar: false,
    ...(process.env.BORING_DESKTOP_SMOKE_BUILD === "1"
      ? {}
      : { ignore: [/^\/dist\/smoke-main(?:\.js|\.js\.map)$/] }),
    ...(signingIdentity
      ? {
          osxSign: {
            identity: signingIdentity,
            optionsForFile: () => ({ entitlements, hardenedRuntime: true }),
          },
        }
      : {}),
    ...(notarization ? { osxNotarize: notarization } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({ name: "Boring-UI" }, ["darwin"]),
    new MakerZIP({}, ["darwin"]),
  ],
}

export default config
