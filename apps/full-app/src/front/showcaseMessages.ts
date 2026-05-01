/**
 * Deterministic conversation fixture used by `?showcase=1`.
 */

export const SHOWCASE_SESSION_ID = '__showcase__'

const svgImage =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%23312e81"/><stop offset="1" stop-color="%230ea5e9"/></linearGradient></defs><rect width="240" height="160" fill="url(%23g)"/><text x="120" y="90" text-anchor="middle" font-family="Inter,system-ui" font-size="24" font-weight="700" fill="white">mockup.png</text></svg>',
  )

export const showcaseMessages = [
  {
    id: 'u0',
    role: 'user' as const,
    parts: [
      { type: 'file' as const, url: svgImage, mediaType: 'image/svg+xml', filename: 'mockup.svg' } as any,
      { type: 'text' as const, text: 'Can you take a look at this mockup and suggest improvements?' },
    ],
  },
  {
    id: 'a0',
    role: 'assistant' as const,
    parts: [
      {
        type: 'text' as const,
        text:
          'Got it — the gradient tile reads cleanly. A few quick calls: tighten the type tracking, drop the drop-shadow, and reserve an 8px safe area around the text so it breathes on small sizes.',
      },
    ],
  },
  {
    id: 'u1',
    role: 'user' as const,
    parts: [{ type: 'text' as const, text: 'Show me everything you can render.' }],
  },
  {
    id: 'a1',
    role: 'assistant' as const,
    parts: [
      {
        type: 'text' as const,
        text:
          'Here is a full tour. **Inline formatting:** bold, *italic*, `inline code`, and [a link](https://example.com).\n\n```ts\nexport function hello(name: string) {\n  return `Hello, ${name}`\n}\n```',
      },
    ],
  },
] as const

export function seedShowcase(sessionId = SHOWCASE_SESSION_ID) {
  try {
    localStorage.setItem(`boring-agent:messages:${sessionId}`, JSON.stringify(showcaseMessages))
  } catch {
    // noop
  }
}
