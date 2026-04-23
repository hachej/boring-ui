/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import {
  forwardRef,
  useCallback,
  useRef,
  useImperativeHandle,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from 'react'

export interface ComposerPrimitiveProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onSubmit'> {
  onSubmit?: (value: string) => void
  submitOnEnter?: boolean
}

export interface ComposerPrimitiveRef {
  focus(): void
  clear(): void
  element: HTMLTextAreaElement | null
}

export const ComposerPrimitive = forwardRef<ComposerPrimitiveRef, ComposerPrimitiveProps>(
  function ComposerPrimitive({ onSubmit, submitOnEnter = true, ...textareaProps }, ref) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useImperativeHandle(ref, () => ({
      focus() {
        textareaRef.current?.focus()
      },
      clear() {
        if (textareaRef.current) textareaRef.current.value = ''
      },
      get element() {
        return textareaRef.current
      },
    }))

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (
          submitOnEnter &&
          e.key === 'Enter' &&
          !e.shiftKey &&
          !e.nativeEvent.isComposing
        ) {
          e.preventDefault()
          const value = e.currentTarget.value.trim()
          if (value) onSubmit?.(value)
        }
        textareaProps.onKeyDown?.(e)
      },
      [submitOnEnter, onSubmit, textareaProps.onKeyDown],
    )

    return (
      <textarea
        {...textareaProps}
        ref={textareaRef}
        onKeyDown={handleKeyDown}
        style={{
          resize: 'none',
          fontFamily: 'var(--boring-chat-font-family, inherit)',
          fontSize: 'var(--boring-chat-font-size, 0.875rem)',
          ...textareaProps.style,
        }}
      />
    )
  },
)
