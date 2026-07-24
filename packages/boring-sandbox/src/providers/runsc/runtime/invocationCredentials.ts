import type {
  AuthorizedWorkspaceCredentialScopeV1,
  CredentialConsumerBindingId,
  CredentialConsumerBindingRegistryV1,
  CredentialFieldDefinitionV1,
  ProviderDefinitionV1,
  ProviderId,
  ProviderRegistryV1,
  SandboxCredentialPayloadResolverV1,
  SandboxCredentialSecretPayloadLeaseV1,
  SandboxCredentialSecretPayloadV1,
} from "@hachej/boring-agent/shared";

import {
  REMOTE_WORKER_ERROR_CODES_V1,
  type RemoteWorkerCredentialReferenceV1,
} from "../../../shared/remoteWorkerProtocolV1";

import { runscRuntimeError } from "./errors";
import type { ResolvedInvocationCredentialFieldV1 } from "./invocationEnvelope";

const ALLOWED_SANDBOX_CREDENTIAL_CONSUMERS = new Set([
  "first-party-tool",
  "plugin-server",
  "mcp-server",
  "tenant-custom-tool",
]);

// Runtime mirror of the 16f.1 credential contract. Sandbox may depend on its
// types, but the package invariant forbids an agent value dependency.
export const RUNSC_SANDBOX_CREDENTIAL_LIMITS_V1 = Object.freeze({
  maxExecutionIdLength: 256,
  maxFields: 16,
  maxMetadataBytes: 16_384,
  maxTotalBytes: 65_536,
});

export interface ResolvedRunscInvocationCredentialsV1 {
  readonly fields: readonly ResolvedInvocationCredentialFieldV1[];
  readonly leases: readonly SandboxCredentialSecretPayloadLeaseV1[];
}

export interface RunscInvocationCredentialResolverV1 {
  readonly contractVersion: "boring.runsc-invocation-credential-resolver.v1";
  resolve(
    input: RunscInvocationCredentialResolutionInputV1,
  ): Promise<ResolvedRunscInvocationCredentialsV1>;
}

export interface RunscInvocationCredentialResolutionInputV1 {
  readonly workspaceId: string;
  readonly sandboxId: string;
  readonly invocationId: string;
  readonly references: readonly RemoteWorkerCredentialReferenceV1[];
  readonly credentialScope: AuthorizedWorkspaceCredentialScopeV1;
  readonly nowMs: number;
}

export interface RunscInvocationCredentialResolverOptionsV1 {
  readonly bindings: CredentialConsumerBindingRegistryV1;
  readonly providers: ProviderRegistryV1;
  readonly payloadResolver: SandboxCredentialPayloadResolverV1;
}

function trustedBindingId(value: string): CredentialConsumerBindingId {
  return value as CredentialConsumerBindingId;
}

function trustedProviderId(value: string): ProviderId {
  return value as ProviderId;
}

function providerCredentialFields(
  provider: ProviderDefinitionV1,
): readonly CredentialFieldDefinitionV1[] {
  if (provider.credential.type === "api-key") {
    return provider.credential.fields;
  }
  if (
    provider.credential.type === "oauth2-authorization-code" &&
    provider.credential.tokenCustody === "local-vault"
  ) {
    return [
      provider.credential.refreshTokenField,
      provider.credential.resolvedAccessTokenField,
    ];
  }
  return [];
}

function metadataBytes(input: {
  workspaceId: string;
  sandboxId: string;
  invocationId: string;
  references: readonly RemoteWorkerCredentialReferenceV1[];
}): number {
  return new TextEncoder().encode(
    JSON.stringify({
      workspaceId: input.workspaceId,
      sandboxId: input.sandboxId,
      invocationId: input.invocationId,
      references: input.references,
    }),
  ).byteLength;
}

export function runscCredentialPayloadMetadataBytesV1(
  payload: SandboxCredentialSecretPayloadV1,
): number {
  return new TextEncoder().encode(
    JSON.stringify({
      contractVersion: payload.contractVersion,
      workspaceId: payload.workspaceId,
      sandboxId: payload.sandboxId,
      executionId: payload.executionId,
      deliveryAttemptId: payload.deliveryAttemptId,
      bindingId: payload.bindingId,
      credentialVersion: payload.credentialVersion,
      expiresAt: payload.expiresAt,
      fields: payload.fields.map((field) => ({
        fieldId: field.fieldId,
        byteLength: field.value.byteLength,
      })),
    }),
  ).byteLength;
}

export function createRunscInvocationCredentialResolverV1(
  options: RunscInvocationCredentialResolverOptionsV1,
): RunscInvocationCredentialResolverV1 {
  return Object.freeze({
    contractVersion: "boring.runsc-invocation-credential-resolver.v1" as const,
    async resolve(
      input: RunscInvocationCredentialResolutionInputV1,
    ): Promise<ResolvedRunscInvocationCredentialsV1> {
      const fieldCount = input.references.reduce(
        (count, reference) => count + reference.fields.length,
        0,
      );
      if (
        input.invocationId.trim().length === 0 ||
        input.invocationId.length >
          RUNSC_SANDBOX_CREDENTIAL_LIMITS_V1.maxExecutionIdLength ||
        fieldCount > RUNSC_SANDBOX_CREDENTIAL_LIMITS_V1.maxFields ||
        metadataBytes(input) >
          RUNSC_SANDBOX_CREDENTIAL_LIMITS_V1.maxMetadataBytes
      ) {
        throw runscRuntimeError(
          REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
          "remote-worker credential reference was rejected",
        );
      }

      const leases: SandboxCredentialSecretPayloadLeaseV1[] = [];
      const fields: ResolvedInvocationCredentialFieldV1[] = [];
      let totalSecretBytes = 0;
      try {
        for (const reference of input.references) {
          if (reference.ref.executionId !== input.invocationId) {
            throw new Error("credential execution mismatch");
          }
          const binding = options.bindings.require(
            trustedBindingId(reference.ref.bindingId),
          );
          const provider = options.providers.require(
            trustedProviderId(reference.ref.providerId),
          );
          if (
            binding.id !== reference.ref.bindingId ||
            binding.providerId !== reference.ref.providerId ||
            provider.id !== reference.ref.providerId ||
            provider.category === "llm" ||
            binding.consumer.trust !== "untrusted" ||
            !ALLOWED_SANDBOX_CREDENTIAL_CONSUMERS.has(binding.consumer.kind) ||
            binding.delivery !== "sandbox-pipe" ||
            binding.sandbox?.credentialChannel !== "fd-3"
          ) {
            throw new Error("credential binding rejected");
          }
          const requestedFieldIds = new Set(
            reference.fields.map((field) => field.fieldId),
          );
          const allowedFieldIds = new Set<string>(binding.allowedFieldIds);
          if (
            requestedFieldIds.size !== reference.fields.length ||
            [...requestedFieldIds].some(
              (fieldId) => !allowedFieldIds.has(fieldId),
            )
          ) {
            throw new Error("credential field rejected");
          }

          const trustedRef = Object.freeze({
            contractVersion: "boring.provider-credential-ref.v1" as const,
            providerId: binding.providerId,
            executionId: input.invocationId,
            bindingId: binding.id,
          });
          const lease = await options.payloadResolver.resolveForDelivery(
            input.credentialScope,
            {
              contractVersion: "boring.sandbox-credential-delivery.v1",
              workspaceId: input.workspaceId,
              sandboxId: input.sandboxId,
              executionId: input.invocationId,
              deliveryAttemptId: reference.deliveryAttemptId,
              ref: trustedRef,
            },
          );
          leases.push(lease);
          const payload = lease.payload;
          if (
            payload.contractVersion !==
              "boring.sandbox-credential-secret-payload.v1" ||
            runscCredentialPayloadMetadataBytesV1(payload) >
              RUNSC_SANDBOX_CREDENTIAL_LIMITS_V1.maxMetadataBytes ||
            payload.workspaceId !== input.workspaceId ||
            payload.sandboxId !== input.sandboxId ||
            payload.executionId !== input.invocationId ||
            payload.deliveryAttemptId !== reference.deliveryAttemptId ||
            payload.bindingId !== binding.id ||
            !Number.isSafeInteger(payload.credentialVersion) ||
            payload.credentialVersion <= 0 ||
            !Number.isFinite(Date.parse(payload.expiresAt)) ||
            Date.parse(payload.expiresAt) <= input.nowMs
          ) {
            throw new Error("credential payload scope rejected");
          }
          if (
            payload.fields.length >
              RUNSC_SANDBOX_CREDENTIAL_LIMITS_V1.maxFields ||
            payload.fields.length !== requestedFieldIds.size
          ) {
            throw new Error("credential payload fields rejected");
          }
          const providerFields = new Map(
            providerCredentialFields(provider).map((field) => [
              field.id,
              field,
            ]),
          );
          const payloadFields = new Map<string, Uint8Array>(
            payload.fields.map((field) => [field.fieldId, field.value]),
          );
          if (payloadFields.size !== payload.fields.length) {
            throw new Error("credential payload fields rejected");
          }
          for (const payloadField of payload.fields) {
            const definition = providerFields.get(payloadField.fieldId);
            if (
              !requestedFieldIds.has(payloadField.fieldId) ||
              !(payloadField.value instanceof Uint8Array) ||
              !definition ||
              payloadField.value.byteLength > definition.maxBytes ||
              payloadField.value.byteLength < (definition.minBytes ?? 0)
            ) {
              throw new Error("credential payload field rejected");
            }
            totalSecretBytes += payloadField.value.byteLength;
            if (
              totalSecretBytes >
              RUNSC_SANDBOX_CREDENTIAL_LIMITS_V1.maxTotalBytes
            ) {
              throw new Error("credential payload exceeds aggregate bound");
            }
          }
          for (const requested of reference.fields) {
            const value = payloadFields.get(requested.fieldId);
            if (!(value instanceof Uint8Array)) {
              throw new Error("credential payload field missing");
            }
            fields.push({
              bindingId: binding.id,
              fieldId: requested.fieldId,
              name: requested.name,
              value,
            });
          }
        }
        return { fields, leases };
      } catch (error) {
        for (const lease of leases) {
          try {
            lease.dispose();
          } catch {
            // Resolver errors stay on the trusted side of the boundary.
          }
        }
        throw runscRuntimeError(
          REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
          "remote-worker credential reference was rejected",
          error,
        );
      }
    },
  });
}
