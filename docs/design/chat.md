# Chat kit: components, props and tokens (style v1)

Each chat component is styled only by tokens. A child app restyles chat by changing the theme
tokens listed here, not by editing the blocks. Locale comes from the `locale` prop or the
`chat.locale` context value (`'en' | 'fr'`, see `registry/pi-chat/locale.ts`); tool names are
human labels from `labels.toolName` (raw ids are never shown).

## Tokens read by chat

| Token | Read by | Use |
|---|---|---|
| `--chat-text-body` (defaults `--text-body`, 0.75rem) | `.pi-chat` root (`registry.json`) | body size (12px) |
| `--chat-text-title` (defaults `--text-title`, 0.875rem) | chat titles | title size (14px) |
| `--chat-composer-radius` (`calc(var(--radius) + 4px)`) | composer input group | composer corner |
| `--card` | composer surface | flat surface over `--background` |
| `--background` | transcript canvas | page |
| `--muted` / `bg-muted` | user bubble, tool step detail, code and argument blocks | muted surface |
| `--muted-foreground` | secondary text, timestamps | secondary |
| `--foreground` | primary text | primary |
| `--destructive` | errors (`Alert` destructive) | error |
| `--ring` | composer `:focus-within` hairline only | focus |
| `--border` | markdown rules | hairline |

No literal colours, radii or shadows live in chat blocks (see `docs/design/chat-audit.md`).

## Components

Paths are under `registry/`. "Props" lists the main props; see each file for the full type.

| Component | File | Props (main) | Tokens read |
|---|---|---|---|
| `PiChat` | `pi-chat/pi-chat.tsx` | `controller`, `locale`, `labels`, `session`, `natural`, `renderNotice` | `--background`, `--muted-foreground`, `--destructive` |
| `Composer` | `pi-chat/composer.tsx` | `value`, `onSend`, `placeholder`, `disabled`, `attachments`, `slash` | `--card`, `--ring`, `--chat-composer-radius` |
| `RowView` / `TranscriptChunk` | `pi-chat/message.tsx` | `row`, `context` | `--muted` (user bubble), `--muted-foreground` |
| `MessageText` | `pi-chat/message.tsx` | `text`, `align`, `variant`, `header`, `footer` | `--muted`, `--foreground` |
| `ActivityBlock` | `pi-chat/activity.tsx` | `steps`, `state`, `streaming`, `developer`, `onOpenImage` | `--muted-foreground` |
| `ToolCard` | `pi-chat/tool.tsx` | `entry`, `onOpenImage`, `details` | `--muted`, `--destructive` |
| `Markdown` | `pi-chat-markdown/markdown.tsx` | `text`, `commandMentions`, `renderMention`, `onCopy`, `streaming` | `--muted`, `--border` |
| `ChatNotices` / `ChatConnectionNotice` / `ChatStatusLine` | `pi-chat/notice.tsx` | `state`, `error`, `onReconnect`, `compact`, `natural` | `--muted-foreground`, `--destructive` |
| `ConversationList` / `ConversationHistory` | `pi-chat/history.tsx` | `conversations`, `onPicked`, `searchMode`, `placement` | `--muted-foreground`, `--destructive` |
| `MessageQueue` | `pi-chat/queue.tsx` | `items`, `sending`, `withdraw`, `actions` | `--muted-foreground` |
| `EmptyState` | `pi-chat/empty-state.tsx` | `title`, `description`, `avatar`, `suggestions`, `onSelect` | (inherits `.pi-chat`) |
| `ImageViewer` | `pi-chat/image-viewer.tsx` | `images`, `index`, `onIndexChange`, `onClose`, `labels` | (inherits) |
| `ApprovalCard` | `pi-chat-approval/approval-card.tsx` | `call`, `result`, `summary`, `decision`, `live` | `--muted-foreground`, `--destructive` |
| `QuestionCard` | `pi-chat-question/question-card.tsx` | `call`, `result`, `answer`, `live` | (inherits) |
| `RunCard` | `pi-chat-subagent/run-card.tsx` | `run`, `fetchRun`, `pollMs`, `renderText` | `--destructive` |
| `SubagentCard` | `pi-chat-subagent/subagent-card.tsx` | `details`, `onOpen`, `now` | (inherits) |
| `VoiceInput` / `VoiceMessageButton` | `pi-chat-voice/*.tsx` | `controller`, `transcribe`, `maxMs`, `primary` | `--primary` (recording) |
| `ModelEffortPicker` | `pi-chat-pickers/pickers.tsx` | `model`, `effort`, `onModel`, `onEffort`, `busy` | (inherits) |
| `MentionPicker` / `SlashPicker` | `pi-chat-mentions/`, `pi-chat-slash/` | `query`, `items`, `onSelect`, `onDismiss` | `--muted-foreground` |
| `CameraSheet` | `pi-chat-attachments/camera-sheet.tsx` | `onCapture`, `onClose` | (inherits) |
| `SharedChat` / `SharedTimeline` | `shared-chat/*.tsx` | `participantLabels`, `presence`, `steps`, `controller`, `paging` | `--muted-foreground`, `--info` (author colour) |
| `AgentWorkspace` | `pi-app/agent-workspace.tsx` | `layout`, `title`, `controller`, `chat` (incl. `locale`), `labels` | (shell tokens) |
| `ArtifactWorkspace` | `pi-workspace/workspace.tsx` | `chat`, `open`, `panel`, `onClose` | `--ring` (resize handle) |
| `PlacedAgentWorkspace` | `placed-agent/placed-agent-workspace.tsx` | `chat`, `title` | (shell tokens) |
| `FeedbackBar` / `FeedbackCard` | `feedback/*.tsx` | `session`, `view`, `onShowFeedback` | `--muted-foreground` |

## Locale and tool labels

- `chatTextFor(locale)` returns the English or French strings (`registry/pi-chat/labels.ts`, `labels-fr.ts`).
- `labels.toolName(id)` maps a tool id to a human name. Known ids (for example `bash`, `read`, `grep`) have
  fixed names; unknown ids use `humanToolName` (underscores, dashes and dots become spaces, then sentence case).
  `piece_save` shows as "Piece save". The raw id stays in `data-tool` for tests.
- The French map is `labels-fr.ts`. Its fallback is the same humaniser, so no raw id reaches the UI in either locale.
