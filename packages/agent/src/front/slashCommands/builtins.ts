import type { SlashCommand } from './registry'

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
    name: 'reload',
    description: 'Reload agent plugins',
    handler(_, ctx) {
      // Use the banner status UX when the host has wired pluginUpdate;
      // otherwise fall back to printing the result inline in chat.
      if (ctx.pluginUpdate) return ctx.pluginUpdate.run()
      return ctx.reloadAgentPlugins()
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
    name: 'think',
    description: 'Alias for /thinking',
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
      return cmds.map((c) => `/${c.name} — ${c.description}`).join('\n')
    },
  },
]
