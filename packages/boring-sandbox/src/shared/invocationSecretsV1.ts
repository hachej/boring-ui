import { z } from "zod";

export const PROVIDER_CREDENTIAL_REF_VERSION_V1 =
  "boring.provider-credential-ref.v1" as const;

const credentialIdentifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

/**
 * Value-free 16f.1 credential reference. Classification and material are
 * resolved from the trusted host registry; neither is accepted from the wire.
 */
export const ProviderCredentialRefSchemaV1 = z
  .object({
    contractVersion: z.literal(PROVIDER_CREDENTIAL_REF_VERSION_V1),
    providerId: credentialIdentifier,
    executionId: z.string().min(1).max(256),
    bindingId: credentialIdentifier,
  })
  .strict();

export type ProviderCredentialRefWireV1 = z.infer<
  typeof ProviderCredentialRefSchemaV1
>;
