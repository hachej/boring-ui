# Composer Slash Settings UX Spec

Status: draft from POC.

## Goal

Keep the composer compact and one-line by moving model/thinking controls into slash menus.

```text
┌──────────────────────────────────────────────┐
│ 📎  Ask anything...                      ↵   │
└──────────────────────────────────────────────┘
        /model: GPT 5.5   /thinking: medium
```

## Composer rules

- Attach button on the left.
- Text input in the center.
- Send/stop on the right.
- No persistent model picker button.
- No persistent thinking picker button.
- Status can be compact text below or near composer.

## Slash commands

```text
/model             → opens model picker
/model 1           → selects numbered model
/model provider:id → selects exact model id
/model gpt         → fuzzy/select by name

/thinking          → opens thinking picker
/thinking low      → set low
/thinking medium   → set medium
/thinking high     → set high
/thinking off      → disable
/think             → alias for /thinking
```

## Picker behavior

- Menus open in-chat, close on selection/escape.
- Rows must wrap or show full provider/model IDs; no hidden horizontal scroll.
- Selected row uses neutral selection with a small check; avoid loud accent fills.

## Defaults

- Thinking defaults to `medium` in the POC.
- Reasoning visibility can be on by default while the product learns user expectations.

## Visual rules

- Composer CTA should be calm and neutral in workspace shell.
- Accent color is for semantic state or focus, not large persistent buttons.
- The one-line composer should remain usable at split-pane widths.

## Success criteria

- User can discover settings by typing `/`.
- Composer remains visually quiet with one or multiple chat panes.
- Model/thinking state is visible but not dominant.
