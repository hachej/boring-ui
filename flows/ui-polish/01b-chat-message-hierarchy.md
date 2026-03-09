# UI Polish: Chat Message Bubbles & Visual Hierarchy

**Priority:** HIGH
**Component:** PI Agent chat messages
**Screenshots:** 19-agent-tool-use, 21-agent-file-read
**Source:** Gemini 3.1 Pro: "User and Agent messages bleed together"

## Problem
- No visual distinction between user messages and agent messages
- Messages bleed together with no background differentiation
- Hard to scan conversation flow
- "Send" button looks permanently disabled (gray on gray)

## Fix
1. **User messages**: Right-aligned with background
   ```css
   .chat-message-user {
     background-color: var(--color-bg-tertiary);
     border-radius: 12px 12px 4px 12px;
     padding: 12px 16px;
     margin-left: 24px;
     max-width: 85%;
     align-self: flex-end;
   }
   ```
2. **Agent messages**: Left-aligned, transparent background
   ```css
   .chat-message-agent {
     padding: 12px 0;
     max-width: 95%;
   }
   ```
3. **Send button**: Dynamic styling based on input state
   - Empty input: `opacity: 0.5; background: transparent;`
   - Has text: `background-color: var(--color-accent); color: white; border-radius: var(--radius-full);`
4. Add subtle timestamp between message groups

## Files to modify
- `src/front/providers/pi/nativeAdapter.jsx` or chat rendering
- `src/front/styles.css`

## Acceptance criteria
- Clear visual distinction between user and agent messages
- Send button clearly changes state when input has text
- Conversation is scannable at a glance
