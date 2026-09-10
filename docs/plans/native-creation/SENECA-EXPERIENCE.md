# The Seneca bot experience — UX target (2026-09-09)

> Owner direction, 2026-09-09: Grok Bot's interface is the bar for simplicity —
> a list of bots, a chat, a bot page, a group room, a bot's screen — and "no
> thinking trace is displayed at all in the chat". Seneca reaches it with the
> canvas and Views Boring already has. This section records the target, maps
> every element to our nouns and beads, and names the open choices. It
> decides nothing that RECONCILIATION does not; where it proposes, it says so.

## Principles

1. **One chat, no trace.** The transcript shows posts, short progress lines
   ("Checking whether canvas is available for me."), and cards. Reasoning,
   tool calls and internal steps never appear in the transcript; they live in a
   "show work" drawer behind an explicit click, with the seat attribution the
   ledger requires. Ambient presence is the default.
2. **Cards, not files.** A bot never answers with a source file. A result is a
   View card (record, table, chart, dashboard) rendered inline, and the same
   card opens full-size in the canvas pane beside the chat. This is the one
   place we beat the reference: their chat authors canvases it cannot render.
3. **A bot is a product you can share.** The bot page reads Instructions ·
   Memories · Skills · Routines · Integrations, with an author and an Import
   button. Import is an installation in the importer's own scope.
4. **Rooms are jobs with several named authors.** A group room is one job
   with the user and several bots, each visibly named, mentions to address one
   of them. Private chats stay private.
5. **The bot has a computer, later.** A persistent screen pane the user can
   watch and take over for logins is the bot-computer spike, not this epic.

## Surfaces

```text
┌ Bots ─────────┐ ┌ Chat: Prototype Builder ────────────────┐ ┌ Canvas ───────┐
│ Prototype B.  │ │ you:  make me a docs page                │ │ [View card,   │
│ New Bot       │ │ bot:  Building the overview…   (progress)│ │  full size]   │
│ Overheard     │ │ bot:  ┌ Docs overview ───────┐  (card)  │ │               │
│ + room        │ │       │ sections · toc · …   │          │ │  Routines     │
│ Marketplace   │ │       └──────────────────────┘          │ │  Bot's screen │
└───────────────┘ │ [decision card: approve / change]        │ └───────────────┘
                  └──────────────────────────────────────────┘
```

Left: bots and rooms (the roster, `ambient` presence in each chat). Middle:
the chat. Right: the canvas pane — a Dockview workbench area that shows the
selected card at full size, the bot's routines, and later the bot's screen.
The Meridian operator shell (Search · Inbox · Work · Agents · Library) stays
the flagship for operators; a Seneca user sees bots and chats.

## Mapping to our nouns

| Reference element | Our noun | Status |
|---|---|---|
| Bot | agent package (instructions, skills, knowledge, digest) inside a product release | built (package); release: bead `nc-1`, `nc-a` |
| Chat with a bot | Session, bound to a Thread when it is about a job | Session built; Thread identity: `nc-t` |
| Progress lines, no trace | transcript = posts + progress + cards; traces in a drawer | rule below; partly built (chat UI) |
| Card in chat | View card = ViewRef rendered inline (record, table, chart, dashboard) | bead `nc-v` |
| Canvas pane | Dockview workbench area hosting the selected View full-size; generated UI in an isolated frame | built (panes); `nc-v`, `nc-5` |
| Decision card | Approval / ask_user card in the chat and the Inbox, never a chat message | built (ask_user); restart-safe pause open |
| Bot page: Instructions · Skills · Integrations | package instructions, skills, MCP grants + tools | built |
| Bot page: Routines | automations bound to the installation | built (automations, supervise); package field open |
| Bot page: Memories | per-installation memory as inspectable files in the runtime's durable volume | **open** — AgentState is a reserved noun; promotion needs a ruling |
| Import Bot | installation for a separate consumer (personal scope) | beads `nc-2`, `nc-3` |
| Marketplace | private catalog now; public marketplace deferred by ruling | Library entry `nc-l`; public: deferred |
| Group room | multi-author Thread: one composer, named agents, addressed posts | ruled (§9b); fixture only; needs `nc-t`, seat attribution, addressed-posts tier 1 |
| Bot DMs another bot outside the room | agent-initiated message to another agent | **excluded** today (no loopback, §7/§9); an owner ruling if wanted |
| Bot's screen | product runtime in `remote` mode + browser broker + take-control | spike, not in the epic |

## Rules this target adds to the Experience layer (proposed)

- **Transcript purity.** A chat message is a post by a named author. Progress
  lines are ephemeral and collapse when the turn ends. Tool calls, thinking,
  retries and delegation are visible only in the show-work drawer, attributed
  by seat.
- **Cards carry references, not content.** A card is a ViewRef; the chat
  renders it with the built-in renderer for its kind; the canvas opens the same
  reference. A generated component renders in the isolated frame under the
  same reference.
- **A chat is about at most one job at a time.** The job (Thread) stays
  invisible as a word; the user sees "what this chat is working on" as the
  canvas title and can switch jobs from the chat header. Rooms are jobs.
- **Decisions are cards.** A pending decision is one card in the chat and one
  Inbox item; answering either settles both.

## The Thread question

The reference has no visible job noun: a bot is a chat, background work shows
up as bot messages, and routines are listed on the bot page. Our ruling keeps
Thread as the durable job root underneath. Recommendation, not a ruling:
**keep Thread invisible in Seneca**. A bot chat is a Session; when the bot
starts real work, the host binds the Session to a Thread and the canvas shows
that job; a room is a Thread with several Sessions. "Jobs" appear as a list
in the canvas pane and as cards in the chat, never as a navigation noun. This
needs no new ruling; it is an Experience choice over §9a. What is open is
whether a bot may hold several concurrent jobs per chat (recommend no for the
first product).

## Relationship to the expert-software building-block direction

The later [building-block synthesis](EXPERT-SOFTWARE-BUILDING-BLOCKS.md)
clarifies that this bot Experience and Clinic are distinct products over shared
substrate. The bot is the conversational front door; substantial work may be
performed by bounded remote agents, and creator agents are one remote-agent
class. Clinic retains its domain-native workflow while using the same governed
operations, work, artifacts and controlled software-change path. That synthesis
also proposes a curated shadcn-based presentation constraint and records the
open decisions for the owner grill; it is working direction, not a ratified
amendment.

## What this changes in the epic

Nothing in the bead graph; it fixes the target for three beads: `nc-v`
(cards + canvas rendering of the same ViewRef), `nc-l` (Seneca's Library is
the bot list and the marketplace tab, not the operator Library), `nc-7` (the
acceptance script drives the bot chat, not a workbench). Two follow-up
proposals for the owner: promote per-installation memory (AgentState) as
inspectable files; add `routines` to the package manifest beside the
Cursor-compatible keys.
