import type { SlashCommand } from './registry'

export const builtinCommands: SlashCommand[] = [
  {
    name: 'clear',
    description: 'Hide messages from display',
    handler(_, ctx) {
      ctx.clearMessages()
    },
  },
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
    name: 'model',
    description: 'Swap active model (sonnet, haiku, opus)',
    handler(args, ctx) {
      const model = args.trim()
      if (!model) return 'Usage: /model <sonnet|haiku|opus>'
      if (!ctx.setModel(model)) return `Unknown model "${model}". Available: sonnet, haiku, opus`
      return `Model set to ${model}.`
    },
  },
  {
    name: 'reload',
    description: 'Reload agent plugins',
    handler(_, ctx) {
      return ctx.reloadAgentPlugins()
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
  {
    name: 'cost',
    description: 'Show per-session token/cost estimates',
    handler() {
      return 'Coming soon.'
    },
  },
]
