# UI Polish: Agent Tool Call Rendering (CRITICAL)

**Priority:** HIGH (CRITICAL)
**Component:** PI Agent chat - tool use display
**Screenshots:** 21-agent-file-read, 22-agent-tool-blocks
**Source:** Gemini 3.1 Pro: "Exposing raw XML to the user is a massive UX failure"

## Problem
When the PI Agent uses tools (read_file, write_file, list_files, bash), the raw XML tool call output is shown directly to the user (e.g., `<write_file><path>hello.py</path><content>...</content></write_file>`). This:
- Breaks the illusion of an intelligent agent
- Forces cognitive load to parse machine-to-machine communication
- Looks broken/unfinished to any user

## Fix
1. Intercept tool call XML in the chat message renderer
2. Parse tool calls and render as **Tool Call UI Cards**:
   - `list_files` -> Icon + "Listed files in `/path`" + collapsible output
   - `read_file` -> Icon + "Read `filename`" + collapsible code block
   - `write_file` -> Icon + "Wrote `filename`" + green checkmark + collapsible diff
   - `bash` -> Icon + "Ran command" + collapsible terminal output
3. Card styling:
   ```css
   .tool-call-card {
     border: 1px solid var(--color-border);
     border-radius: var(--radius-sm);
     padding: 8px 12px;
     background: var(--color-bg-secondary);
     margin: 8px 0;
     font-size: var(--text-sm);
   }
   .tool-call-card .tool-icon { color: var(--color-text-tertiary); }
   .tool-call-card .tool-status-success { color: var(--color-success); }
   ```
4. Hide raw XML entirely — never show it to users

## Files to modify
- `src/front/providers/pi/nativeAdapter.jsx` (message rendering/transform)
- `src/front/styles.css` (tool card styles)
- Possibly create `src/front/providers/pi/ToolCallCard.jsx`

## Acceptance criteria
- No raw XML visible in agent chat
- Each tool call renders as a clean card with icon, description, and status
- Tool output is collapsible (expanded by default for small outputs)
- Matches the design system (borders, colors, spacing)
