# Fictional opt-in draft recovery host

Run `npm run build`, then `CHROMIUM=/path/to/chromium node examples/draft-recovery/journey.mjs`.
The script serves a throwaway fictional host, drives the four public viewers, and writes raw evidence to `.cache/evidence/draft-recovery-browser/`.

The browser explicitly injects the host IndexedDB adapter into concrete controller `drafts` options. The library does not choose storage. The fictional account's persisted session epoch survives page reload; logout aborts the current UI capability, transactionally revokes that epoch and purges its payloads, and a subsequent login creates a new epoch. BroadcastChannel only notifies other tabs; the IndexedDB transaction is the mutation fence. The host must supply real authentication, account routing, encryption policy and provider incarnation namespace in an application.

Each writer has a separate row and monotonic sequence. Durable deletion floors span saved-base changes, stop delayed old writes from recreating acknowledged drafts, and preserve newer versions and other writers. Listings are bounded, expose truncation and omit expired records. A storage acknowledgement establishes recovery persistence only. Explicit Restore edits locally; normal conditional Save/Keep publishes through the existing SQLite resource provider and returns its checked receipt. No native save attempt is reconstructed from stored content.

The journey checks actual IndexedDB conformance, all four explicit restores across reload, Unicode/BOM, native canvas document restoration, layout restoration without Pin authority, saved V1 versus later V2 typing, changed saved revision, two tab writers, exact discard and delayed writes crossing durable logout. Inline fictional tldraw assets do not qualify fonts, licensing or vendor isolation. No paid model, real clinical content or production account is involved. Successful IndexedDB callbacks and reloads do not establish hard-crash durability or secure deletion.

Local environments that refuse socket listen or Chromium sandbox operations cannot execute the browser stages; the script reports that failure instead of skipping assertions. Public-output structural DOM tests and actual SQLite reopen tests are separate evidence.
