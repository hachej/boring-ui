export const RUNSC_PREFLIGHT_ERROR_CODES = {
  invalidConfig: "RUNSC_PREFLIGHT_INVALID_CONFIG",
  commandFailed: "RUNSC_PREFLIGHT_COMMAND_FAILED",
  invalidOutput: "RUNSC_PREFLIGHT_INVALID_OUTPUT",
  structuralMismatch: "RUNSC_PREFLIGHT_STRUCTURAL_MISMATCH",
} as const;

export const RUNSC_REQUIRED_BLOCKED_CIDRS = [
  "10.0.0.0/8",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "fc00::/7",
  "fe80::/10",
] as const;

export type RunscPreflightErrorCode =
  (typeof RUNSC_PREFLIGHT_ERROR_CODES)[keyof typeof RUNSC_PREFLIGHT_ERROR_CODES];

export interface RunscStructuralObservations {
  runscVersionOutputValid: true;
  digestMarkerMatchesExpected: true;
  namespaceCommandSucceeded: true;
  nftTableReadable: true;
  configuredCidrTextPresent: true;
  cgroupControllersPresent: readonly ["cpu", "memory", "pids"];
  configuredLimitFilesMatchExpected: true;
}

/** Security properties that this structural preflight deliberately does not attest. */
export const RUNSC_UNPROVEN_SECURITY_FACTS = {
  systrapWorkload: "unknown",
  imageDigestBinding: "unknown",
  effectiveUid: "unknown",
  effectiveGid: "unknown",
  cgroupMembership: "unknown",
  resourceEnforcement: "unknown",
  networkIsolation: "unknown",
  metadataEgressDenied: "unknown",
  privateNetworkEgressDenied: "unknown",
  hostNetworkEgressDenied: "unknown",
  crossWorkspaceEgressDenied: "unknown",
  nftDropRulesEffective: "unknown",
  ociBundleUsed: "unknown",
  containerConfigurationUsed: "unknown",
  rootPathSafety: "unknown",
  hostRunnerEnforcement: "unknown",
} as const;

export type RunscUnprovenSecurityFacts = typeof RUNSC_UNPROVEN_SECURITY_FACTS;

export interface RunscPreflightErrorRecord {
  code: RunscPreflightErrorCode;
  message: string;
}

export type RunscPreflightResult =
  | {
      status: "observed";
      provider: "runsc";
      productionReady: false;
      observations: RunscStructuralObservations;
      unproven: RunscUnprovenSecurityFacts;
    }
  | {
      status: "failed";
      provider: "runsc";
      productionReady: false;
      error: RunscPreflightErrorRecord;
    };
