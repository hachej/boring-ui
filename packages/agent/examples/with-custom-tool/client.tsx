import './app.css'
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
    <div className="reverse-tool-card">
      <span className="reverse-tool-dot" />
      Reversed: {reversed}
    </div>
  )
}

function ExampleClient() {
  return (
    <div className="with-custom-tool-theme">
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
