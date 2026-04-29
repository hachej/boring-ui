/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import { useCallback, useState } from 'react'

export interface CodeBlockProps {
  code: string
  language?: string
  filename?: string
  className?: string
  showLineNumbers?: boolean
  copyable?: boolean
}

export function CodeBlock({
  code,
  language,
  filename,
  className,
  showLineNumbers = false,
  copyable = true,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [code])

  const lines = code.split('\n')

  return (
    <div
      className={className}
      style={{
        background: 'var(--boring-chat-code-bg, #1e1e1e)',
        color: 'var(--boring-chat-code-fg, #d4d4d4)',
        borderRadius: 'var(--boring-chat-code-radius, 0.375rem)',
        fontFamily: 'var(--boring-chat-font-mono, monospace)',
        fontSize: '0.8125rem',
        lineHeight: 1.6,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {(filename || language) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.375rem 0.75rem',
            background: 'var(--boring-chat-code-header-bg, #2d2d2d)',
            borderBottom: '1px solid var(--boring-chat-code-border, #404040)',
            fontSize: '0.75rem',
          }}
        >
          <span style={{ opacity: 0.7 }}>{filename ?? language}</span>
          {copyable && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy code"
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0.125rem 0.375rem',
                fontSize: '0.75rem',
                opacity: 0.6,
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      )}
      <pre style={{ margin: 0, padding: '0.75rem', overflow: 'auto' }}>
        <code data-language={language}>
          {showLineNumbers
            ? lines.map((line, i) => (
                <span key={i} style={{ display: 'block' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: `${String(lines.length).length + 1}ch`,
                      textAlign: 'right',
                      marginRight: '1rem',
                      opacity: 0.4,
                      userSelect: 'none',
                    }}
                  >
                    {i + 1}
                  </span>
                  {line}
                </span>
              ))
            : code}
        </code>
      </pre>
      {copyable && !filename && !language && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code"
          style={{
            position: 'absolute',
            top: '0.5rem',
            right: '0.5rem',
            background: 'var(--boring-chat-code-copy-bg, rgba(255,255,255,0.1))',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
            fontSize: '0.75rem',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  )
}
