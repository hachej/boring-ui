// Example sketch for the planned M5 frontend extension points.
// This file captures intended usage; ChatPanel renderer override APIs are pending.

import type { CSSProperties } from 'react'

export const themedPanelStyle = {
  // Planned panel-level theming token:
  '--boring-chat-accent': 'hotpink',
} as CSSProperties

// Planned (not implemented yet):
// import { ChatPanel } from '@boring/agent'
//
// export function ExampleClient() {
//   return (
//     <div style={themedPanelStyle}>
//       {/* renderer override prop name is TBD until M5 API is finalized */}
//       {/* <ChatPanel sessionId="demo" ... /> */}
//     </div>
//   )
// }
