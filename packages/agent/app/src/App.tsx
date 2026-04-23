import { ChatPanel } from '../../src/front/ChatPanel'

export function App() {
  return (
    <main style={{ height: '100vh' }}>
      <ChatPanel sessionId="default" />
    </main>
  )
}
