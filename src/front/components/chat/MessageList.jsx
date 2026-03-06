import { ThreadPrimitive } from '@assistant-ui/react'
import { forwardRef } from 'react'
import { Sparkles, ArrowDown } from 'lucide-react'
import { ICON_SIZE_INLINE, ICON_STROKE_WIDTH } from '../../utils/iconTokens'

/**
 * MessageList - Scrollable container for messages
 * Extends ThreadPrimitive.Viewport with auto-scroll anchoring
 */

const MessageList = forwardRef(({ children, className = '', ...props }, ref) => {
  return (
    <ThreadPrimitive.Viewport
      ref={ref}
      className={`message-list ${className}`}
      autoScroll={true}
      {...props}
    >
      {children}
    </ThreadPrimitive.Viewport>
  )
})

MessageList.displayName = 'MessageList'

/**
 * EmptyState - Shown when thread has no messages
 */
export const EmptyState = ({ children }) => {
  return (
    <ThreadPrimitive.Empty className="message-list-empty">
      {children || (
        <>
          <div className="message-list-empty-icon">
            <Sparkles size={ICON_SIZE_INLINE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          </div>
          <div className="message-list-empty-title">Start a conversation</div>
          <div className="message-list-empty-subtitle">Type a message to begin</div>
        </>
      )}
    </ThreadPrimitive.Empty>
  )
}

/**
 * Messages - Renders the list of messages with provided components
 * Let assistant-ui handle scrolling and layout naturally
 */
export const Messages = ({ components }) => {
  return (
    <ThreadPrimitive.Messages
      components={components}
      className="message-list-messages"
    />
  )
}

/**
 * ScrollToBottom - Button to scroll viewport to bottom
 */
export const ScrollToBottom = ({ children }) => {
  return (
    <ThreadPrimitive.ScrollToBottom className="scroll-to-bottom">
      {children || (
        <>
          <ArrowDown size={ICON_SIZE_INLINE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          <span>Scroll to bottom</span>
        </>
      )}
    </ThreadPrimitive.ScrollToBottom>
  )
}

export default MessageList
