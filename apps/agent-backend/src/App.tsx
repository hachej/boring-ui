import './app.css'
import '@boring/agent/ui-shadcn/styles.css'
import { ChatPanel } from '@boring/agent/ui-shadcn'

export function App() {
  return (
    <main className="h-screen">
      <ChatPanel sessionId="default" />
    </main>
  )
}
