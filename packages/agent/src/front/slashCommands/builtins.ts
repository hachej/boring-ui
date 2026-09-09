import type { SlashCommand } from './registry'

/** Longest reload report handed to the model; warnings past it are elided. */
const MAX_RELOAD_MODEL_MESSAGE = 2_000

/**
 * Frame the reload outcome as a short labelled report. The host message already
 * reads as a summary ("Extensions reloaded." / "Extension update failed: …"
 * plus a warnings block), so this only names the source and bounds the length.
 */
export function reloadResultForModel(message: string): string {
  const body = message.trim() || 'No result reported.'
  const bounded = body.length > MAX_RELOAD_MODEL_MESSAGE
    ? `${body.slice(0, MAX_RELOAD_MODEL_MESSAGE)}\n… (truncated)`
    : body
  return `/reload result:\n${bounded}`
}

export const builtinCommands: SlashCommand[] = [
  {
    name: 'reset',
    description: 'Delete current session and start fresh',
    handler(_, ctx) {
      if (!globalThis.confirm('Reset this session? All messages will be cleared.')) return
      ctx.resetSession()
      return 'Session reset.'
    },
  },
  {
    name: 'clear',
    description: 'Hide messages from display',
    handler(_, ctx) {
      ctx.clearMessages()
    },
  },
  {
    name: 'reload',
    description: 'Reload agent plugins',
    clickBehavior: 'execute',
    async handler(_, ctx) {
      // Use the banner status UX when the host has wired pluginUpdate;
      // otherwise fall back to printing the result inline in chat.
      const message = ctx.pluginUpdate ? await ctx.pluginUpdate.run() : await ctx.reloadAgentPlugins()
      // The banner and the local notice are browser-only. Reload changes the
      // agent's own tools/skills, so the outcome — including a failure — has to
      // reach the model's context too.
      return { message, modelMessage: reloadResultForModel(message) }
    },
  },
  {
    name: 'model',
    description: 'Open or set the composer model',
    handler(args, ctx) {
      const query = args.trim()
      if (query) return ctx.selectComposerModel?.(query)
      if (ctx.openModelPicker?.() === false) return { preserveDraft: true }
    },
  },
  {
    name: 'thinking',
    description: 'Open or set the thinking level',
    handler(args, ctx) {
      const query = args.trim()
      if (query) return ctx.selectComposerThinking?.(query)
      if (ctx.openThinkingPicker?.() === false) return { preserveDraft: true }
    },
  },
  {
    name: 'help',
    description: 'Show available commands',
    handler(_, ctx) {
      const cmds = ctx.listCommands()
      if (cmds.length === 0) return 'No commands available.'
      // Command results render as a plain-text notice (RuntimeNotices uses
      // `white-space: pre-wrap`, not Streamdown), so a GFM table would show as
      // raw pipes. A "\n"-joined list keeps each command on its own line.
      return [
        'Available commands:',
        ...cmds.map((c) => {
          const desc = (c.description ?? '').replace(/\s+/g, ' ').trim()
          return desc ? `/${c.name} — ${desc}` : `/${c.name}`
        }),
      ].join('\n')
    },
  },
]
