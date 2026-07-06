import type { ProviderCapabilities } from "./capability";

export const PROVIDER_CONTRACT_VERSION = "boring-sandbox.provider.v1";

export type SandboxProviderId =
  | "none"
  | "readonly"
  | "direct"
  | "bwrap"
  | "vercel-sandbox"
  | "remote-worker";

export type RuntimeModeId =
  | "pure"
  | "readonly"
  | "direct"
  | "local"
  | "vercel-sandbox"
  | "remote-worker";

export const PROVIDER_CAPABILITIES = {
  none: {
    fs: "none",
    exec: false,
    realBash: false,
    realBinaries: false,
    watch: false,
    search: false,
    sourceOfTruth: "storage-primary",
    provisioningSupport: false,
    providerContractVersion: PROVIDER_CONTRACT_VERSION,
    runtimeImage: false,
    hardening: "none",
    filesystemPersistence: "none",
  },
  readonly: {
    fs: "readonly",
    exec: false,
    realBash: false,
    realBinaries: false,
    watch: true,
    search: true,
    sourceOfTruth: "storage-primary",
    provisioningSupport: false,
    providerContractVersion: PROVIDER_CONTRACT_VERSION,
    runtimeImage: false,
    hardening: "none",
    filesystemPersistence: "durable",
  },
  direct: {
    fs: "readwrite",
    exec: true,
    realBash: "unknown",
    realBinaries: "unknown",
    networkIsolation: "none",
    watch: true,
    search: true,
    sourceOfTruth: "storage-primary",
    provisioningSupport: true,
    providerContractVersion: PROVIDER_CONTRACT_VERSION,
    runtimeImage: false,
    hardening: "none",
    filesystemPersistence: "durable",
  },
  bwrap: {
    fs: "readwrite",
    exec: true,
    realBash: "unknown",
    realBinaries: "unknown",
    networkIsolation: "none",
    watch: true,
    search: true,
    sourceOfTruth: "storage-primary",
    provisioningSupport: true,
    providerContractVersion: PROVIDER_CONTRACT_VERSION,
    runtimeImage: false,
    hardening: "process",
    filesystemPersistence: "durable",
  },
  "vercel-sandbox": {
    fs: "readwrite",
    exec: true,
    realBash: true,
    realBinaries: true,
    networkIsolation: "provider",
    watch: true,
    search: true,
    sourceOfTruth: "sandbox-primary",
    provisioningSupport: true,
    providerContractVersion: PROVIDER_CONTRACT_VERSION,
    runtimeImage: "unknown",
    hardening: "provider",
    filesystemPersistence: "provider",
  },
  "remote-worker": {
    fs: "readwrite",
    exec: true,
    realBash: "unknown",
    realBinaries: "unknown",
    networkIsolation: "unknown",
    watch: true,
    search: true,
    sourceOfTruth: "sandbox-primary",
    provisioningSupport: false,
    providerContractVersion: PROVIDER_CONTRACT_VERSION,
    runtimeImage: "unknown",
    hardening: "unknown",
    filesystemPersistence: "unknown",
  },
} as const satisfies Record<SandboxProviderId, ProviderCapabilities>;

export const MODE_TO_PROVIDER = {
  pure: "none",
  readonly: "readonly",
  direct: "direct",
  local: "bwrap",
  "vercel-sandbox": "vercel-sandbox",
  "remote-worker": "remote-worker",
} as const satisfies Record<RuntimeModeId, SandboxProviderId>;

export type ProviderCapabilityMatrix = typeof PROVIDER_CAPABILITIES;
export type RuntimeModeProviderMap = typeof MODE_TO_PROVIDER;
