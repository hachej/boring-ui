/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import { useCallback, useState } from 'react'
import { Button } from '@hachej/boring-ui-kit
import { cn } from '../lib'

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
  const lineNumberWidth = `${String(lines.length).length + 1}ch`

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[var(--boring-agent-code-radius,0.375rem)] bg-[var(--boring-agent-code-bg,#1e1e1e)] font-[family-name:var(--boring-agent-font-mono,monospace)] text-[0.8125rem] leading-relaxed text-[var(--boring-agent-code-fg,#d4d4d4)]',
        className,
      )}
    >
      {(filename || language) && (
        <div className="flex items-center justify-between border-b border-[var(--boring-agent-code-border,#404040)] bg-[var(--boring-agent-code-header-bg,#2d2d2d)] px-3 py-1.5 text-xs">
          <span className="opacity-70">{filename ?? language}</span>
          {copyable && (
            <Button type="button" variant="ghost" size="xs" onClick={handleCopy} aria-label="Copy code" className="h-6 px-1.5 text-xs text-inherit opacity-60">
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
        </div>
      )}
      <pre className="m-0 overflow-auto p-3">
        <code data-language={language}>
          {showLineNumbers
            ? lines.map((line, i) => (
                <span key={i} className="block">
                  <span className="mr-4 inline-block select-none text-right opacity-40" style={{ width: lineNumberWidth }}>
                    {i + 1}
                  </span>
                  {line}
                </span>
              ))
            : code}
        </code>
      </pre>
      {copyable && !filename && !language && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={handleCopy}
          aria-label="Copy code"
          className="absolute right-2 top-2 h-7 bg-[var(--boring-agent-code-copy-bg,rgba(255,255,255,0.1))] px-2 text-xs text-inherit"
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      )}
    </div>
  )
}
