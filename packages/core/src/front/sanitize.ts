import DOMPurify from 'isomorphic-dompurify'

export function sanitizeMarkdown(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 'a', 'code', 'pre',
      'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span', 'div', 'sup', 'sub', 'del', 'ins', 'details', 'summary',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  })
}

export function sanitizeToolOutput(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: ['span', 'code', 'pre', 'br', 'strong', 'em'],
    ALLOWED_ATTR: ['class'],
    ALLOW_DATA_ATTR: false,
  })
}
