import type { PiExtensionFactory } from "@hachej/boring-agent/server"
import type { BoringPluginAssetManager } from "./manager"

export type BoringPiExtensionFactory = PiExtensionFactory

export interface CreateBoringPiExtensionOptions {
  manager: BoringPluginAssetManager
}

export function createBoringPiExtension({ manager }: CreateBoringPiExtensionOptions): BoringPiExtensionFactory {
  return (pi) => {
    pi.on("session_start", async () => {
      await manager.load()
    })

    pi.on("before_agent_start", async (event) => {
      const prompts = manager
        .list()
        .map((plugin) => plugin.pi?.systemPrompt?.trim())
        .filter((prompt): prompt is string => Boolean(prompt))
      if (prompts.length === 0) return
      return {
        systemPrompt: `${event.systemPrompt}\n\n# Loaded boring-ui plugin context\n\n${prompts.join("\n\n")}`,
      }
    })

    pi.registerCommand("boring.reload", {
      description: "Internal boring-ui reload hook. Prefer the chat /reload command in boring-ui.",
      handler: async (_args, ctx) => {
        const preflight = manager.preflight()
        if (!preflight.ok) {
          ctx.ui.notify(`boring.reload failed: ${preflight.errors.length} preflight error(s)`, "error")
          return
        }
        await manager.load()
        await ctx.reload()
        return
      },
    })
  }
}
