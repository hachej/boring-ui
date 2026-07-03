import { z } from "zod"
import { defineServerPlugin, defineTrustedDomainBridgeHandler, type WorkspaceBridgeHandler, type WorkspaceBridgeHandlerContribution, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { validateGeneratedPaneSpec, type GeneratedPaneDiagnostic } from "../shared"

export const GENERATED_PANE_VALIDATE_OP = "generated-pane.v1.validate"

export interface GeneratedPaneValidateInput {
  spec?: unknown
}

export interface GeneratedPaneValidateOutput {
  ok: boolean
  diagnostics: GeneratedPaneDiagnostic[]
}

function contribution<TInput, TOutput>(entry: ReturnType<typeof defineTrustedDomainBridgeHandler<TInput, TOutput>>): WorkspaceBridgeHandlerContribution {
  return {
    definition: entry.definition,
    handler: entry.handler as WorkspaceBridgeHandler,
  }
}

function assertValidateInput(input: unknown): asserts input is GeneratedPaneValidateInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("generated-pane validation input must be an object")
  if (!("spec" in input)) throw new Error("generated-pane validation requires spec")
}

export function createGeneratedPaneServerPlugin(): WorkspaceServerPlugin {
  const validateGeneratedPane = defineTrustedDomainBridgeHandler<GeneratedPaneValidateInput, GeneratedPaneValidateOutput>({
    op: GENERATED_PANE_VALIDATE_OP,
    version: 1,
    owner: "generated-pane",
    callerClassesAllowed: ["browser", "runtime", "server"],
    requiredCapabilities: ["generated-pane:validate"],
    inputSchema: z.object({ spec: z.unknown() }),
    outputSchema: { type: "object" },
    maxInputBytes: 2 * 1024 * 1024,
    maxOutputBytes: 512 * 1024,
    timeoutMs: 10_000,
    idempotencyPolicy: "none",
    handler: async ({ input }) => {
      assertValidateInput(input)
      const result = validateGeneratedPaneSpec(input.spec)
      return { ok: result.diagnostics.every((item) => item.severity !== "error"), diagnostics: result.diagnostics }
    },
  })

  return defineServerPlugin({
    id: "generated-pane",
    label: "Generated Pane",
    workspaceBridgeHandlers: [contribution(validateGeneratedPane)],
    systemPrompt: "Use generated-pane.v1.validate through WorkspaceBridge for base generated pane specs. Profile-specific panes must use their owning plugin validate op.",
  })
}

export default function defaultGeneratedPaneServerPlugin(): WorkspaceServerPlugin {
  return createGeneratedPaneServerPlugin()
}
