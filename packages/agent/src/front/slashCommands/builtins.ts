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
    name: 'clear',
    description: 'Hide messages from display',
    handler(_, ctx) {
      ctx.clearMessages()
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
    name: 'help',
    description: 'Show available commands',
    handler(_, ctx) {
      const cmds = ctx.listCommands()
      if (cmds.length === 0) return 'No commands available.'
      // Render as a GFM table. The chat renders assistant messages through
      // Streamdown (GFM), so a plain "\n"-joined list would collapse into one
      // run-on line; a table keeps each command on its own row.
      const escape = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
      return [
        '| Command | Description |',
        '| --- | --- |',
        ...cmds.map((c) => `| \`/${c.name}\` | ${escape(c.description ?? '')} |`),
      ].join('\n')
    },
  },
]
