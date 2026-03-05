import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import Editor from 'react-simple-code-editor'
import { Highlight, themes } from 'prism-react-renderer'

// Parse frontmatter from markdown content
export function parseFrontmatter(content) {
  if (!content) return { frontmatter: '', body: content || '' }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { frontmatter: '', body: content }

  return {
    frontmatter: match[1],
    body: content.slice(match[0].length)
  }
}

// Reconstruct content from frontmatter and body
export function reconstructContent(frontmatter, body) {
  if (!frontmatter || frontmatter.trim() === '') {
    return body
  }
  return `---\n${frontmatter}\n---\n${body}`
}

export default function FrontmatterEditor({
  frontmatter,
  onChange,
  isCollapsed,
  onToggleCollapse,
  isDiffMode = false,
  originalFrontmatter = null,
}) {
  const [localValue, setLocalValue] = useState(frontmatter || '')
  const [hasError, setHasError] = useState(false)
  const debounceRef = useRef(null)

  // Check if frontmatter has changed from original
  const hasChanges = isDiffMode && originalFrontmatter !== null && originalFrontmatter !== frontmatter

  // Sync from parent when frontmatter changes externally
  useEffect(() => {
    setLocalValue(frontmatter || '')
  }, [frontmatter])

  // Basic YAML validation
  const validateYaml = useCallback((value) => {
    if (!value.trim()) return true
    // Basic check: look for common YAML issues
    const lines = value.split('\n')
    for (const line of lines) {
      // Check for tabs (YAML shouldn't use tabs)
      if (line.includes('\t')) return false
      // Check for inconsistent indentation (very basic)
      if (line.match(/^\s+[^\s:]+:\s*$/) && !line.match(/^(\s{2})+/)) {
        // Indented line should use 2-space increments
      }
    }
    return true
  }, [])

  const handleChange = useCallback((newValue) => {
    setLocalValue(newValue)

    const isValid = validateYaml(newValue)
    setHasError(!isValid)

    // Debounce the onChange callback
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      onChange?.(newValue)
    }, 300)
  }, [onChange, validateYaml])

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  // Highlight function for YAML
  const highlightCode = useCallback(
    (code) => (
      <Highlight theme={themes.vsDark} code={code} language="yaml">
        {({ tokens, getLineProps, getTokenProps }) => (
          <>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })} style={{ display: 'table-row' }}>
                <span className="frontmatter-line-number">{i + 1}</span>
                <span style={{ display: 'table-cell' }}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
              </div>
            ))}
          </>
        )}
      </Highlight>
    ),
    []
  )

  // Render highlighted YAML for read-only display (original side in diff)
  const renderHighlightedYaml = useCallback((code) => (
    <Highlight theme={themes.vsDark} code={code || ''} language="yaml">
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className="frontmatter-diff-pre">
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })} style={{ display: 'table-row' }}>
              <span className="frontmatter-line-number">{i + 1}</span>
              <span style={{ display: 'table-cell' }}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </span>
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  ), [])

  const hasFrontmatter = frontmatter && frontmatter.trim() !== ''
  const hasOriginalFrontmatter = originalFrontmatter && originalFrontmatter.trim() !== ''

  return (
    <div className={`frontmatter-editor ${isCollapsed ? 'collapsed' : ''} ${hasError ? 'has-error' : ''}`}>
      <div className="frontmatter-header" onClick={onToggleCollapse}>
        <button type="button" className="frontmatter-toggle" aria-label={isCollapsed ? 'Expand' : 'Collapse'}>
          <ChevronDown
            size={12}
            style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform var(--transition-fast)' }}
          />
        </button>
        <span className="frontmatter-label">Metadata</span>
        {hasFrontmatter && (
          <span className="frontmatter-badge">YAML</span>
        )}
        {hasChanges && (
          <span className="frontmatter-changed-badge">Changed</span>
        )}
        {hasError && (
          <span className="frontmatter-error-badge">Invalid</span>
        )}
        {!hasFrontmatter && !isCollapsed && (
          <span className="frontmatter-hint">Add title, date, tags...</span>
        )}
      </div>

      {!isCollapsed && (
        <div className="frontmatter-content">
          {/* Side-by-side diff view when in diff mode */}
          {isDiffMode && originalFrontmatter !== null ? (
            <div className="frontmatter-diff-container">
              <div className="frontmatter-diff-side frontmatter-diff-original">
                <div className="frontmatter-diff-label">Original</div>
                <div className="frontmatter-diff-content">
                  {hasOriginalFrontmatter ? (
                    renderHighlightedYaml(originalFrontmatter)
                  ) : (
                    <div className="frontmatter-diff-empty">No metadata</div>
                  )}
                </div>
              </div>
              <div className="frontmatter-diff-side frontmatter-diff-current">
                <div className="frontmatter-diff-label">Current{hasChanges ? ' (modified)' : ''}</div>
                <div className="frontmatter-diff-content">
                  <div className="frontmatter-editor-wrapper">
                    {!localValue && (
                      <div className="frontmatter-placeholder">
                        title: My Document{'\n'}
                        date: 2024-01-01{'\n'}
                        tags: [tag1, tag2]
                      </div>
                    )}
                    <Editor
                      value={localValue}
                      onValueChange={handleChange}
                      highlight={highlightCode}
                      padding={12}
                      className="frontmatter-input"
                      textareaClassName="frontmatter-textarea"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        lineHeight: 1.5,
                        backgroundColor: 'var(--color-pre-bg)',
                        color: 'var(--color-pre-text)',
                        minHeight: '60px',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Normal single editor view */
            <div className="frontmatter-editor-wrapper">
              {!localValue && (
                <div className="frontmatter-placeholder">
                  title: My Document{'\n'}
                  date: 2024-01-01{'\n'}
                  tags: [tag1, tag2]
                </div>
              )}
              <Editor
                value={localValue}
                onValueChange={handleChange}
                highlight={highlightCode}
                padding={12}
                className="frontmatter-input"
                textareaClassName="frontmatter-textarea"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  lineHeight: 1.5,
                  backgroundColor: 'var(--color-pre-bg)',
                  color: 'var(--color-pre-text)',
                  minHeight: '60px',
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
