import { expectTypeOf, test } from "vitest";
import type { ProviderCredentialRefV1 } from "@hachej/boring-agent/shared";
import type { ProviderCredentialRefWireV1 } from "../invocationSecretsV1";
import { PROVIDER_CREDENTIAL_REF_VERSION_V1 } from "../invocationSecretsV1";

// Drift guard (#1198): the sandbox wire schema re-declares the agent's
// ProviderCredentialRefV1 shape as a local zod schema because the
// sandbox -> agent edge is types-only (zod values cannot cross it). Nothing
// else ties the two together, so if the agent contract evolves the wire
// schema would drift silently on a security contract. These assertions fail
// `tsc --noEmit` (and vitest typecheck) if either shape changes.
test("wire credential ref stays in lockstep with the agent contract", () => {
  // Agent -> wire: every trusted-factory ref must parse as a wire ref
  // (branded ids widen to their plain-string wire encoding).
  expectTypeOf<ProviderCredentialRefV1>().toExtend<ProviderCredentialRefWireV1>();

  // Wire -> agent: the wire shape must be exactly the agent contract with
  // its id brands erased. Raw wire values are deliberately NOT assignable to
  // ProviderCredentialRefV1 — brands are re-applied by the trusted host
  // registry, never accepted from the wire.
  expectTypeOf<ProviderCredentialRefWireV1>().toEqualTypeOf<{
    contractVersion: ProviderCredentialRefV1["contractVersion"];
    providerId: string;
    executionId: ProviderCredentialRefV1["executionId"];
    bindingId: string;
  }>();
  expectTypeOf<ProviderCredentialRefV1["providerId"]>().toExtend<string>();
  expectTypeOf<ProviderCredentialRefV1["bindingId"]>().toExtend<string>();

  // Version literal must match the agent contract exactly.
  expectTypeOf(
    PROVIDER_CREDENTIAL_REF_VERSION_V1,
  ).toEqualTypeOf<ProviderCredentialRefV1["contractVersion"]>();
});
