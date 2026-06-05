import type { SlashCommand } from './registry'

export const builtinCommands: SlashCommand[] = [
  {
    name: 'clear',
    description: 'Hide messages from display',
    clickBehavior: 'insert',
    handler(_, ctx) {
      ctx.clearMessages()
    },
  },
  {
    name: 'reset',
    description: 'Delete current session and start fresh',
    clickBehavior: 'insert',
    handler(_, ctx) {
      if (!globalThis.confirm('Reset this session? All messages will be cleared.')) return
      ctx.resetSession()
      return 'Session reset.'
    },
  },
  {
    name: 'reload',
    description: 'Reload agent plugins',
    clickBehavior: 'execute',
    handler(_, ctx) {
      // Use the banner status UX when the host has wired pluginUpdate;
      // otherwise fall back to printing the result inline in chat.
      if (ctx.pluginUpdate) return ctx.pluginUpdate.run()
      return ctx.reloadAgentPlugins()
    },
  },
  {
    name: 'help',
    description: 'Show available commands',
    clickBehavior: 'insert',
    handler(_, ctx) {
      const cmds = ctx.listCommands()
      if (cmds.length === 0) return 'No commands available.'
      return cmds.map((c) => `/${c.name} — ${c.description}`).join('\n')
    },
  },
]
