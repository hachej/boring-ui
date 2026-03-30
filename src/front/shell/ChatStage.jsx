import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Sparkles } from 'lucide-react'
import ChatMessage from './ChatMessage'
import ChatComposer from './ChatComposer'
import './chat-stage.css'

/**
 * ChatStage - Main container component for the chat experience.
 *
 * Manages message list rendering, scroll behavior, empty state,
 * and composer integration. Designed to be connected to useChat + useChatTransport
 * by a parent component.
 *
 * Props:
 *   messages  - UIMessage[] from useChat
 *   input     - string, current composer input value
 *   onInputChange - (value: string) => void
 *   onSubmit  - () => void, send message
 *   onStop    - () => void, stop streaming
 *   status    - 'ready' | 'streaming' | 'submitted'
 *   disabled  - boolean
 */
export default function ChatStage({
  messages = [],
  input = '',
  onInputChange,
  onSubmit,
  onStop,
  status = 'ready',
  disabled = false,
}) {
  const scrollRef = useRef(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const isEmpty = messages.length === 0

  return (
    <div className="vc-stage">
      <div className="vc-stage-scroll" ref={scrollRef}>
        <div className="vc-stage-messages">
          {isEmpty && (
            <div className="vc-stage-empty">
              <Sparkles size={32} className="vc-stage-empty-icon" />
              <span className="vc-stage-empty-title">
                What can I help with?
              </span>
              <span className="vc-stage-empty-hint">
                Results appear on the Surface
              </span>
            </div>
          )}
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
        </div>
      </div>
      <ChatComposer
        value={input}
        onChange={onInputChange}
        onSubmit={onSubmit}
        onStop={onStop}
        status={status}
        disabled={disabled}
      />
    </div>
  )
}
