import React, { useCallback, useRef } from 'react'
import { Send, Square } from 'lucide-react'

/**
 * ChatComposer - Pill-shaped input with keyboard hints and send/stop controls.
 *
 * Props:
 *   value     - string, current input text
 *   onChange  - (value: string) => void
 *   onSubmit  - () => void, called on Enter (without Shift)
 *   onStop    - () => void, called when Stop button clicked
 *   status    - 'ready' | 'streaming' | 'submitted'
 *   disabled  - boolean
 */
export default function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  status,
  disabled,
}) {
  const textareaRef = useRef(null)

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (value.trim() && !disabled) {
          onSubmit()
        }
      }
    },
    [value, disabled, onSubmit]
  )

  const handleChange = useCallback(
    (e) => {
      onChange(e.target.value)
    },
    [onChange]
  )

  const isStreaming = status === 'streaming'
  const canSend = value.trim().length > 0 && !disabled && !isStreaming

  return (
    <div className="vc-composer-wrap">
      <div className="vc-composer">
        <textarea
          ref={textareaRef}
          role="textbox"
          className="vc-composer-input"
          placeholder="Ask a question..."
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
        />
        <div className="vc-composer-hints">
          <kbd className="vc-kbd">&#8984;</kbd>
          <kbd className="vc-kbd">K</kbd>
        </div>
        {isStreaming ? (
          <button
            className="vc-composer-stop"
            data-testid="chat-stop-btn"
            onClick={onStop}
            type="button"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            className="vc-composer-send"
            data-testid="chat-send-btn"
            onClick={canSend ? onSubmit : undefined}
            disabled={!canSend}
            type="button"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
