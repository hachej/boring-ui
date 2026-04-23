# Component Pattern Audit: default + primitives + hook

Every user-facing UI piece must ship as a trio:

1. **Default** — batteries-included, drop-in component
2. **Primitives** — composition building blocks for custom layouts
3. **Hook** — headless logic for fully custom rendering

This document records the audit status of each piece. Run at M5 gate.

---

## @boring/agent/ui-shadcn (primary consumer surface)

| Piece | Default | Primitives | Hook | Status |
|---|---|---|---|---|
| ChatPanel | `<ChatPanel />` | Conversation, Message, PromptInput, Reasoning, CodeBlock | `useAgentChat` | PASS |
| Message | `<Message />` | MessageContent, MessageActions, MessageToolbar, MessageBranch* | -- | GAP: no hook |
| Reasoning | `<Reasoning />` | ReasoningTrigger, ReasoningContent | `useReasoning` | PASS |
| CodeBlock | `<CodeBlock />` | CodeBlockContainer, CodeBlockHeader, CodeBlockContent, CodeBlockCopyButton | -- | GAP: no hook |
| PromptInput | `<PromptInput />` | PromptInputTextarea, PromptInputHeader, PromptInputFooter, PromptInputTools | `usePromptInputController`, `usePromptInputAttachments` | PASS |
| Conversation | `<Conversation />` | ConversationContent, ConversationEmptyState, ConversationScrollButton | -- | GAP: no hook |
| SessionToolbar | `<SessionToolbar />` | reuses shadcn Dropdown | `useSessions` | PASS |
| SlashCommands | built into Composer | `parseSlashCommand`, `createCommandRegistry` | -- | GAP: no standalone hook |
| ModelPicker / ThinkingToggle | inputs to `useAgentChat` | reuses shadcn Select | part of `useAgentChat` | PASS (by design) |

### Gaps to close before M5

- **Message**: add `useMessage()` or `useMessageBranching()` hook
- **CodeBlock**: add `useCodeBlock()` hook (language detection, copy state)
- **Conversation**: add `useConversation()` hook (scroll position, empty state)
- **SlashCommands**: add `useSlashCommands()` hook (register, filter, execute)

---

## @boring/agent (base, unstyled)

| Piece | Default | Primitives | Hook | Status |
|---|---|---|---|---|
| ChatPanel | `<ChatPanel />` | -- | `useAgentChat` | GAP: primitives not re-exported from base |
| Message | -- | `<Message />` (primitive only) | -- | GAP: no default, no hook |
| CodeBlock | -- | `<CodeBlock />` (primitive only) | -- | GAP: no default, no hook |
| Reasoning | -- | `<Reasoning />` (primitive only) | -- | GAP: no default, no hook |
| Terminal | -- | `<Terminal />` (primitive only) | -- | GAP: no default, no hook |
| Tool | -- | `<Tool />` (primitive only) | -- | GAP: no default, no hook |
| Composer | `<Composer />` | `<ComposerPrimitive />` | -- | GAP: no hook |

### Notes

The base package exports only `ChatPanel`, `SessionToolbar`, `useSessions`, and slash-command utilities from `front/index.ts`. Primitives (Message, CodeBlock, Reasoning, Terminal, Tool) exist in `front/primitives/` but are **not re-exported** from the public barrel. Users must use `@boring/agent/ui-shadcn` for the full primitive set.

**Decision needed**: either re-export primitives from the base package, or document that `ui-shadcn` is the canonical consumer entrypoint and base is internal-only.

---

## @boring/workspace

| Piece | Default | Primitives | Hook | Status |
|---|---|---|---|---|
| DockviewShell | `<DockviewShell />` | -- | `useDockviewApi` | GAP: no primitives |
| IdeLayout | `<IdeLayout />` / `buildIdeLayout` | -- | `useRegistry`, `useDockviewApi` | GAP: no primitives |
| ChatLayout | `<ChatLayout />` / `buildChatLayout` | -- | `useRegistry`, `useDockviewApi` | GAP: no primitives |
| CodeEditor | `<CodeEditor />` | -- | -- | GAP: no primitives, no hook |
| CodeEditorPane | `<CodeEditorPane />` | -- | `useFileContent`, `useEditorLifecycle` | GAP: no primitives |
| FileTree | `<FileTree />` | -- | -- | GAP: no primitives, no hook |
| FileTreePane | `<FileTreePane />` | -- | internal context only | GAP: no primitives, no public hook |
| MarkdownEditor | `<MarkdownEditor />` | -- | -- | GAP: no primitives, no hook |
| MarkdownEditorPane | `<MarkdownEditorPane />` | -- | `useFileContent`, `useEditorLifecycle` | GAP: no primitives |
| DataCatalog | `<DataCatalog />` | -- | -- | GAP: no primitives, no hook |
| SessionList | `<SessionList />` | -- | -- | GAP: no primitives, no hook |
| CommandPalette | `<CommandPalette />` | -- | `useCommandRegistry` | GAP: no primitives |

### Workspace data hooks (headless, no component pairing)

These hooks are standalone and don't correspond to specific components:

- File I/O: `useFileContent`, `useFileData`, `useFileList`, `useStat`, `useFileSearch`, `useFileWrite`, `useCreateDir`, `useMoveFile`, `useDeleteFile`
- Store: `useActiveFile`, `useActivePanel`, `useSidebarState`, `useOpenPanels`, `useDirtyFiles`, `useThemePreference`, `useResetLayout`
- UI: `useViewportBreakpoint`, `useResponsiveSidebarCollapse`, `useArtifactRouting`, `useKeyboardShortcuts`

### Gaps to close before M5

Workspace components are mostly monolithic defaults with no composition API. Priority gaps:

1. **CodeEditor**: extract `useCodeEditor()` hook (content, language, onChange, cursor)
2. **FileTree**: extract `useFileTree()` hook (selection, expansion, rename state)
3. **MarkdownEditor**: extract `useMarkdownEditor()` hook (content, format, toolbar state)
4. **DataCatalog**: extract `useDataCatalog()` hook (schema, filtering, selection)
5. **SessionList**: extract `useSessionList()` hook (sessions, active, create/delete)

Primitive tiers for workspace editors are lower priority — the pane wrappers serve as the composition layer within the dockview system.

---

## Summary

| Package | Total pieces | Full 3-tier | Partial | Missing tiers |
|---|---|---|---|---|
| @boring/agent/ui-shadcn | 9 | 4 | 5 | 0 |
| @boring/agent (base) | 7 | 0 | 3 | 4 |
| @boring/workspace | 12 | 0 | 4 | 8 |

**Overall: 4/28 pieces fully pass the 3-tier audit.**

The ui-shadcn package is closest to compliance. Workspace has the most work remaining but benefits from its rich standalone hook library. Base agent package needs a decision on whether primitives should be re-exported or left to ui-shadcn.

---

## M5 Gate Checklist

Before milestone 5 sign-off, verify:

- [ ] Every GAP row above is either resolved or has a tracked bead
- [ ] Base package export decision documented (re-export primitives or mark internal)
- [ ] Workspace editor hooks extracted (CodeEditor, FileTree, MarkdownEditor minimum)
- [ ] Missing hooks added to ui-shadcn (Message, CodeBlock, Conversation, SlashCommands)
- [ ] This document updated with final audit results

Audit date: 2026-04-23
