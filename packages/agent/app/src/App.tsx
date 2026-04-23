import './app.css'
import { ChatPanel } from '../../src/front/ChatPanel'

export function App() {
  return (
    <main className="agent-app-root">
      <ChatPanel sessionId="default" />
    </main>
  )
}
