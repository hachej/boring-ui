import type { CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'

import {
  ChatPanel,
  type ToolPart,
  type ToolRenderer,
} from '../../src/front'

function getReversed(output: unknown): string {
  const out = output as {
    details?: { reversed?: unknown }
    content?: Array<{ text?: unknown }>
  } | null

  const fromDetails = out?.details?.reversed
  if (typeof fromDetails === 'string') {
    return fromDetails
  }

  const firstText = out?.content?.[0]?.text
  return typeof firstText === 'string' ? firstText : ''
}

const reverseRenderer: ToolRenderer = (part: ToolPart) => {
  const reversed = getReversed(part.output)
  return (
    <div
      style={{
        padding: '0.5rem 0.75rem',
        border: '1px solid var(--boring-chat-tool-border, #e5e7eb)',
        background: 'var(--boring-chat-tool-header-bg, #f9fafb)',
        borderRadius: '0.375rem',
        fontFamily: 'var(--boring-chat-font-mono, monospace)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--boring-chat-tool-running, #3b82f6)',
          marginRight: '0.5rem',
        }}
      />
      Reversed: {reversed}
    </div>
  )
}

const themedPanelStyle = {
  '--boring-chat-tool-running': 'hotpink',
  '--boring-chat-tool-border': 'hotpink',
  '--boring-chat-tool-header-bg': '#fff0f8',
} as CSSProperties

function ExampleClient() {
  return (
    <div style={themedPanelStyle}>
      <ChatPanel
        sessionId="demo"
        toolRenderers={{ reverse: reverseRenderer }}
      />
    </div>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Missing #root element')
}

createRoot(rootElement).render(<ExampleClient />)
