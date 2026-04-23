# Chat UI Theming Contract

All `@boring/agent` chat primitives read CSS custom properties scoped to
`[data-boring-chat]`. The default dark theme ships in `styles/theme.css`.

## Overriding

Set any `--boring-chat-*` variable on a parent element to override within
that subtree. The attribute selector gives embedders specificity control:

```css
/* global override */
[data-boring-chat] {
  --boring-chat-accent: hotpink;
}

/* per-panel override */
.my-panel [data-boring-chat] {
  --boring-chat-accent: #00c2ff;
  --boring-chat-bg: #1a1a2e;
}
```

## Token Reference

| Token | Default | Purpose |
|---|---|---|
| `--boring-chat-bg` | `#0b1220` | Panel background |
| `--boring-chat-fg` | `#e5e7eb` | Primary text |
| `--boring-chat-muted` | `#94a3b8` | Secondary/muted text |
| `--boring-chat-accent` | `#3b82f6` | Links, active states, streaming indicators |
| `--boring-chat-border` | `#334155` | Borders, dividers |
| `--boring-chat-error` | `#ef4444` | Error states |
| `--boring-chat-success` | `#4ade80` | Success states |
| `--boring-chat-surface` | `#0f172a` | Elevated surfaces (headers, dropdowns) |
| `--boring-chat-font-family` | system stack | Base font family |
| `--boring-chat-font-mono` | monospace stack | Code/terminal font |
| `--boring-chat-font-size` | `0.875rem` | Base font size |

Component-specific tokens (messages, reasoning, tools, terminal, code,
diff, composer, dropdown) follow the `--boring-chat-{component}-{prop}`
pattern. See `styles/theme.css` for the full list.

## Scope

The `data-boring-chat` attribute is set on the `<ChatPanel>` root div.
Multiple chat instances on the same page each get their own scope.
