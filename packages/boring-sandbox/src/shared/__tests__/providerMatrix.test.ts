import { describe, expect, it } from "vitest";

import {
  MODE_TO_PROVIDER,
  PROVIDER_CAPABILITIES,
  PROVIDER_CAPABILITY_ERROR_CODES,
  PROVIDER_CONTRACT_VERSION,
} from "../index";

describe("provider capability matrix", () => {
  it("declares the fixed none provider row", () => {
    expect(PROVIDER_CAPABILITIES.none).toMatchObject({
      fs: "none",
      exec: false,
      realBash: false,
      realBinaries: false,
      watch: false,
      search: false,
      sourceOfTruth: "storage-primary",
      provisioningSupport: false,
      runtimeImage: false,
    });
  });

  it("declares the fixed readonly provider row", () => {
    expect(PROVIDER_CAPABILITIES.readonly).toMatchObject({
      fs: "readonly",
      exec: false,
      realBash: false,
      realBinaries: false,
      watch: true,
      search: true,
      sourceOfTruth: "storage-primary",
      provisioningSupport: false,
      runtimeImage: false,
    });
  });

  it("declares the fixed direct provider row", () => {
    expect(PROVIDER_CAPABILITIES.direct).toMatchObject({
      fs: "readwrite",
      exec: true,
      realBash: "unknown",
      realBinaries: "unknown",
      networkIsolation: "none",
      watch: true,
      search: true,
      sourceOfTruth: "storage-primary",
      provisioningSupport: true,
      runtimeImage: false,
    });
  });

  it("declares the fixed bwrap provider row", () => {
    expect(PROVIDER_CAPABILITIES.bwrap).toMatchObject({
      fs: "readwrite",
      exec: true,
      realBash: "unknown",
      realBinaries: "unknown",
      networkIsolation: "none",
      watch: true,
      search: true,
      sourceOfTruth: "storage-primary",
      provisioningSupport: true,
      runtimeImage: false,
    });
  });

  it("declares the fixed vercel-sandbox provider row", () => {
    expect(PROVIDER_CAPABILITIES["vercel-sandbox"]).toMatchObject({
      fs: "readwrite",
      exec: true,
      realBash: true,
      realBinaries: true,
      networkIsolation: "provider",
      watch: true,
      search: true,
      sourceOfTruth: "sandbox-primary",
      provisioningSupport: true,
      runtimeImage: "unknown",
    });
  });

  it("preserves mode id to provider id distinctions", () => {
    expect(MODE_TO_PROVIDER.local).toBe("bwrap");
    expect(MODE_TO_PROVIDER.direct).toBe("direct");
    expect(MODE_TO_PROVIDER.pure).toBe("none");
    expect(MODE_TO_PROVIDER.readonly).toBe("readonly");
  });

  it("keeps non-exec providers non-executable", () => {
    expect(PROVIDER_CAPABILITIES.none.exec).toBe(false);
    expect(PROVIDER_CAPABILITIES.readonly.exec).toBe(false);
  });

  it("leaves remote-worker worker-dependent fields unknown until the P5 handshake", () => {
    expect(PROVIDER_CAPABILITIES["remote-worker"]).toMatchObject({
      fs: "readwrite",
      exec: true,
      realBash: "unknown",
      realBinaries: "unknown",
      networkIsolation: "unknown",
      runtimeImage: "unknown",
      hardening: "unknown",
      filesystemPersistence: "unknown",
    });
  });

  it("uses one stable provider contract version and stable capability error codes", () => {
    for (const capabilities of Object.values(PROVIDER_CAPABILITIES)) {
      expect(capabilities.providerContractVersion).toBe(PROVIDER_CONTRACT_VERSION);
    }
    expect(Object.values(PROVIDER_CAPABILITY_ERROR_CODES)).toEqual([
      "SANDBOX_PROVIDER_UNSUPPORTED_REQUIREMENT",
      "SANDBOX_PROVIDER_UNSAFE_FALLBACK",
      "SANDBOX_PROVIDER_UNKNOWN_REQUIRED_CAPABILITY",
    ]);
  });
});
