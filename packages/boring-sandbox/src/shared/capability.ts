export type ProviderFilesystemCapability = "none" | "readonly" | "readwrite";
export type ProviderNetworkIsolation = "none" | "process" | "container" | "microvm" | "provider";
export type ProviderSourceOfTruth = "sandbox-primary" | "storage-primary";
export type ProviderHardening = "none" | "process" | "container" | "microvm" | "provider";
export type ProviderFilesystemPersistence = "none" | "ephemeral" | "session" | "durable" | "provider";
export type ReportedProviderCapability<T> = T | "unknown";

export interface ProviderRuntimeImage {
  /** Operator-readable image ref, for example registry.example/runtime-node:2026-07. */
  ref: string;
  /** Digest is the execution identity and is required by non-dev image users. */
  digest: string;
}

export interface ProviderRuntimeSpec {
  image?: ProviderRuntimeImage;
}

export interface ProviderCapabilities {
  fs: ProviderFilesystemCapability;
  exec: boolean;
  realBash?: ReportedProviderCapability<boolean>;
  realBinaries?: ReportedProviderCapability<boolean>;
  networkIsolation?: ReportedProviderCapability<ProviderNetworkIsolation>;
  watch: boolean;
  search: boolean;
  sourceOfTruth: ProviderSourceOfTruth;
  provisioningSupport: boolean;
  providerContractVersion: string;
  runtimeImage: ReportedProviderCapability<boolean>;
  hardening?: ReportedProviderCapability<ProviderHardening>;
  filesystemPersistence?: ReportedProviderCapability<ProviderFilesystemPersistence>;
}

export const PROVIDER_CAPABILITY_ERROR_CODES = {
  unsupportedRequirement: "SANDBOX_PROVIDER_UNSUPPORTED_REQUIREMENT",
  unsafeFallback: "SANDBOX_PROVIDER_UNSAFE_FALLBACK",
  unknownRequiredCapability: "SANDBOX_PROVIDER_UNKNOWN_REQUIRED_CAPABILITY",
} as const;

export type ProviderCapabilityErrorCode =
  (typeof PROVIDER_CAPABILITY_ERROR_CODES)[keyof typeof PROVIDER_CAPABILITY_ERROR_CODES];

