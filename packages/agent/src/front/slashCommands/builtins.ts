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
]
