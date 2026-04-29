import './app.css'
import { ChatPanel } from '@boring/agent/front'

export function App() {
  return (
    <main className="agent-app-root">
      <ChatPanel sessionId="default" />
    </main>
  )
}
