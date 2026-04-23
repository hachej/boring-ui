import './app.css'
import { createRoot } from 'react-dom/client'
import {
  ChatPanel,
  type ToolPart,
  type ToolRenderer,
} from '../../src/front-shadcn'

const reverseRenderer: ToolRenderer = (part: ToolPart) => {
  const out = part.output as { details?: { reversed?: unknown }; content?: Array<{ text?: unknown }> } | null
  const reversed = typeof out?.details?.reversed === 'string'
    ? out.details.reversed
    : typeof out?.content?.[0]?.text === 'string'
      ? out.content[0].text
      : ''
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card p-3 font-mono text-sm">
      <span className="inline-block h-2 w-2 rounded-full bg-primary" />
      Reversed: {reversed}
    </div>
  )
}

function App() {
  return (
    <div className="dark h-screen bg-background text-foreground">
      <ChatPanel
        sessionId="demo"
        toolRenderers={{ reverse: reverseRenderer }}
      />
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')
createRoot(root).render(<App />)
