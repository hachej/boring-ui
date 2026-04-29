/**
 * Deterministic conversation fixture used by `?showcase=1`.
 *
 * Renders one hand-crafted thread covering every message variant + tool
 * state + markdown pattern so we can iterate visual design without an LLM
 * in the loop. Hydrated into ChatPanel via localStorage; useAgentChat
 * picks it up on mount because the cache key matches the showcase
 * session id.
 *
 * Ported from the original agent shadcn showcase fixture.
 */

export const SHOWCASE_SESSION_ID = "__showcase__"

const svgImage =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%23312e81"/><stop offset="1" stop-color="%230ea5e9"/></linearGradient></defs><rect width="240" height="160" fill="url(%23g)"/><text x="120" y="90" text-anchor="middle" font-family="Inter,system-ui" font-size="24" font-weight="700" fill="white">mockup.png</text></svg>',
  )

export const showcaseMessages = [
  {
    id: "u0",
    role: "user" as const,
    parts: [
      { type: "file" as const, url: svgImage, mediaType: "image/svg+xml", filename: "mockup.svg" } as any,
      { type: "text" as const, text: "Can you take a look at this mockup and suggest improvements?" },
    ],
  },
  {
    id: "a0",
    role: "assistant" as const,
    parts: [
      {
        type: "text" as const,
        text:
          "Got it — the gradient tile reads cleanly. A few quick calls: tighten the type tracking, drop the drop-shadow, and reserve an 8px safe area around the text so it breathes on small sizes.",
      },
    ],
  },
  {
    id: "u0a",
    role: "user" as const,
    parts: [
      {
        type: "file" as const,
        url: "data:text/plain;base64," + btoa("# Project notes\n\n- Ship shadcn ChatPanel\n- Wire attachments + artifacts\n- Reach 9/10\n"),
        mediaType: "text/plain",
        filename: "notes.md",
      } as any,
      {
        type: "file" as const,
        url: "data:text/plain;base64," + btoa("id,name,status\n1,ChatPanel,shipped\n2,Tool primitive,shipped\n3,Artifact,shipped\n"),
        mediaType: "text/csv",
        filename: "status.csv",
      } as any,
      {
        type: "file" as const,
        url: "data:application/json;base64," + btoa('{"model":"sonnet","temperature":0.2,"tools":["bash","read","write","edit"]}'),
        mediaType: "application/json",
        filename: "config.json",
      } as any,
      { type: "text" as const, text: "Three files — cross-reference the notes against the status and config, please." },
    ],
  },
  {
    id: "a0a",
    role: "assistant" as const,
    parts: [
      {
        type: "text" as const,
        text:
          "All three line up. `notes.md` calls for the ChatPanel, Artifact, and Attachments work; `status.csv` shows all three as shipped; and `config.json` lists the four tools the Agent pane uses. Nothing drifts between files.",
      },
    ],
  },
  {
    id: "u0b",
    role: "user" as const,
    parts: [
      {
        type: "file" as const,
        url: "data:text/plain;base64," + btoa("function greet(name){return `Hello, ${name}!`}\n"),
        mediaType: "text/javascript",
        filename: "greet.js",
      } as any,
    ],
  },
  {
    id: "a0b",
    role: "assistant" as const,
    parts: [
      {
        type: "text" as const,
        text: "Received `greet.js` — what would you like me to do with it? (refactor, add tests, document, port to TypeScript, …)",
      },
    ],
  },
  {
    id: "u1",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Show me everything you can render." }],
  },
  {
    id: "a1",
    role: "assistant" as const,
    parts: [
      {
        type: "text" as const,
        text:
          "Here is a full tour of the renderers, covering each tool state and the common markdown patterns.\n\n" +
          "**Inline formatting:** bold, *italic*, `inline code`, ~~strike~~, and [a link](https://example.com).\n\n" +
          "### Numbered list\n" +
          "1. First option\n" +
          "2. Second option with a long explanation that should wrap cleanly inside the prose block without breaking the baseline grid.\n" +
          "3. Third option\n\n" +
          "### Block quote\n" +
          "> Design is not just what it looks like and feels like. Design is how it works.\n\n" +
          "### Code block",
      },
      {
        type: "text" as const,
        text:
          "```ts\n" +
          "// A typed, syntax-highlighted example.\n" +
          "interface User {\n" +
          "  id: string\n" +
          "  email: string\n" +
          "  createdAt: Date\n" +
          "}\n\n" +
          "export async function loadUser(id: string): Promise<User | null> {\n" +
          "  const res = await fetch(`/api/users/${id}`)\n" +
          "  if (!res.ok) return null\n" +
          "  return (await res.json()) as User\n" +
          "}\n" +
          "```",
      },
    ],
  },
  {
    id: "u2",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Call the bash tool." }],
  },
  {
    id: "a2",
    role: "assistant" as const,
    parts: [
      {
        type: "dynamic-tool" as const,
        toolName: "bash",
        toolCallId: "tc-bash-1",
        state: "output-available" as const,
        input: { command: "ls -la /etc | head -6", description: "List /etc entries" },
        output: {
          stdout: [
            "total 1024",
            "drwxr-xr-x 164 root root 12288 Apr 23 18:42 .",
            "drwxr-xr-x  25 root root  4096 Mar 14 09:10 ..",
            "drwxr-xr-x   3 root root  4096 Feb 03 11:01 X11",
            "-rw-r--r--   1 root root  3028 Jan 18 14:22 adduser.conf",
            "drwxr-xr-x   2 root root  4096 Apr 01 08:55 apparmor",
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        },
      } as any,
    ],
  },
  {
    id: "a3",
    role: "assistant" as const,
    parts: [
      {
        type: "dynamic-tool" as const,
        toolName: "bash",
        toolCallId: "tc-bash-2",
        state: "output-error" as const,
        input: { command: "cat /does/not/exist", description: "Read missing file" },
        output: { stdout: "", stderr: "cat: /does/not/exist: No such file or directory", exitCode: 1 },
      } as any,
    ],
  },
  {
    id: "u3",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Now read, write, edit, and a custom tool." }],
  },
  {
    id: "a4",
    role: "assistant" as const,
    parts: [
      {
        type: "dynamic-tool" as const,
        toolName: "read",
        toolCallId: "tc-read-1",
        state: "output-available" as const,
        input: { path: "greeter.ts" },
        output: { text: "export function greet(name: string): string {\n  return `Hello, ${name}!`\n}\n" },
      } as any,
      {
        type: "dynamic-tool" as const,
        toolName: "write",
        toolCallId: "tc-write-1",
        state: "output-available" as const,
        input: { path: "greeter.ts", content: "export function greet(name: string): string {\n  return `Hi, ${name}.`\n}\n" },
        output: { written: 74 },
      } as any,
      {
        type: "dynamic-tool" as const,
        toolName: "edit",
        toolCallId: "tc-edit-1",
        state: "output-available" as const,
        input: {
          path: "greeter.ts",
          oldString: "return `Hi, ${name}.`",
          newString: "return `Hi, ${name}! Welcome aboard.`",
        },
        output: { replaced: 1 },
      } as any,
    ],
  },
  {
    id: "a5",
    role: "assistant" as const,
    parts: [
      {
        type: "dynamic-tool" as const,
        toolName: "bash",
        toolCallId: "tc-bash-3",
        state: "input-available" as const,
        input: { command: "pnpm test", description: "Run the test suite" },
      } as any,
    ],
  },
  {
    id: "a6",
    role: "assistant" as const,
    parts: [
      {
        type: "text" as const,
        text: "That wraps up the tour. Every state (running, error, complete) and every tool type is in this view.",
      },
    ],
  },
] as const

/**
 * Pre-seed the cache that ChatPanel's `useAgentChat` reads on hydration.
 * Call once on mount in showcase mode; ChatPanel then renders the fixture
 * with no network round-trip.
 */
export function seedShowcase() {
  try {
    localStorage.setItem(`boring-agent:messages:${SHOWCASE_SESSION_ID}`, JSON.stringify(showcaseMessages))
  } catch {
    /* noop — quota or disabled storage */
  }
}
