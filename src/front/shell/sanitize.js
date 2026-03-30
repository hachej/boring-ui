import DOMPurify from 'dompurify'

/**
 * Sanitize markdown/HTML content from agent messages.
 * Strips scripts, event handlers, and javascript: URIs while
 * preserving safe formatting tags used in rendered markdown.
 */
export function sanitizeMarkdown(html) {
  if (!html || typeof html !== 'string') return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li',
      'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span',
      'img', 'hr', 'del', 'sup', 'sub',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt'],
    ALLOW_DATA_ATTR: false,
  })
}

/**
 * Sanitize tool stdout/stderr output for safe display.
 * Tool output is plaintext, so we escape ALL HTML entities
 * rather than selectively allowing tags.
 */
export function sanitizeToolOutput(text) {
  if (text == null) return ''
  const str = String(text)
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;') // H-4: prevent single-quote attr breakout
}
