# Pi-v2 removal map — what Boring UI stops owning if pi v2 lands

Provenance: analysis by another agent, supplied by the owner 2026-08-26;
absorbed here verbatim in substance, with a **reconciliation banner** the
original lacked. Companion to [`pi-v2-alignment.md`](pi-v2-alignment.md)
(the adopt/track/rewrite decision analysis, verified against the pi dev
branch at `5507d76`).

> **Reconciliation banner — read before acting on any deletion row.**
> Verified findings and ratified rulings correct four of the map's claims:
>
> 1. **The D29 gateway contract survives.** The map's §14 ("backend session
>    routing, worker manager, session directory → Pi server host") targets
>    what is, in this repo, the ratified `AgentGateway` funnel (Decision 29:
>    one frozen seven-method contract, one construction path, every consumer
>    through it). The correct end state is the gateway **contract kept, its
>    implementation delegating** to pi services behind the seam — never
>    consumers talking to pi directly. Deleting the funnel would need a D29
>    amendment nobody has proposed.
> 2. **Session data stays host-owned.** "Pi owns transcript/session
>    authority" is acceptable only as *runtime* authority. Durable session
>    history is host-app user data (hard rule 9; D29: the Agent owns its
>    session **record**) and lives on the host's durable volume regardless
>    of which runtime writes it.
> 3. **The WAIT class is bigger than the map implies.** Verified today:
>    `Transcript` is a stub with no event producer, `RemoteEvents` is
>    deliberately non-durable, queue/resume/compaction throw
>    not-implemented, and the plugin/RPC layer is "design input, not a
>    normative contract". Areas 2, 6, 7 (partly), 10, 11, 12 are WAIT, not
>    REPLACE, until those slices are real.
> 4. **Multi-agent is not in this map at all.** Pi v2's multi-presentation
>    attach covers N viewers of ONE session; several agents projected as
>    one Job Thread — our core mechanic — is explicitly deferred upstream.
>    Nothing in the deletion areas touches the projection/relay/attribution
>    work, which proceeds under the premises program either way.
>
> With those four corrections, the map's principle is **adopted as our
> audit rule**: *code that exists only to reconstruct, mirror, route,
> synchronize, or persist Pi runtime state inside the UI is a deletion
> candidate once the corresponding pi-v2 slice is real.*

## The target ownership split (as corrected)

```
Boring UI owns                      Pi v2 owns (when its slices are real)
├─ rendering, layout, interaction   ├─ session runtime authority
├─ product UX + design system       ├─ transcript production
├─ UI-local state (drafts, prefs)   ├─ agent execution + recovery
├─ the D29 AgentGateway CONTRACT    ├─ model/provider state
├─ durable session STORAGE (rule 9) ├─ reconnect/hydration mechanics
└─ one thin platform seam           └─ plugin facet services
```

## The fifteen deletion areas (summary; classification per area)

| # | Area | Class today | Note |
|---|---|---|---|
| 1 | Session-state mirroring (custom stores, lifecycle reducers, attach/detach machines) | REPLACE-WITH-PI when `SessionDirectory`/`SessionManagement` are consumed through the gateway seam | keep only presentation selection state |
| 2 | Transcript synchronization (accumulators, merge/replay/reconciliation) | **WAIT** — their Transcript is a stub | biggest eventual win; keep all rendering |
| 3 | Agent runtime state mirrored in frontend | REPLACE-WITH-PI (consume projections, don't derive) | keep spinner/controls semantics |
| 4 | Chat command plumbing (prompt/abort wrappers) | REPLACE-WITH-PI (`Chat.prompt/requestAbort` are real today) | keep composer UX |
| 5 | Model/thinking-level state duplication | REPLACE-WITH-PI (`Models` is real today) | keep picker UI |
| 6 | Provider/auth plumbing in the front | **WAIT** (`Accounts` partial) | UI should never see secrets — already our rule |
| 7 | Custom RPC layer | PARTIAL-WAIT — their RPC is intra-process design-input; our external transport stays | |
| 8 | Reconnect/hydration infrastructure | REPLACE-WITH-PI eventually; steal attachment-state vocabulary now | keep status UX |
| 9 | Multi-window synchronization | REPLACE-WITH-PI (multi-presentation attach is proven) | multi-agent NOT covered |
| 10 | Extension-to-UI bridge | **WAIT** — plugin kernel is design-input; map to our plugins-across-hosts caveats | |
| 11 | Tool-execution sync | WAIT (transcript-dependent) | keep every renderer |
| 12 | Branch/navigation runtime logic | WAIT | keep visualization |
| 13 | Local persistence of pi runtime state | REPLACE-WITH-PI **within rule 9** — storage location stays host-owned | keep UI-local persistence |
| 14 | Server-side session routing glue | **corrected** — the gateway contract stays; its internals may delegate | keep accounts/billing/permissions/policy |
| 15 | Duplicate local/remote client architectures | collapse behind the seam | |

## The seam (the actionable now-work)

The map's best contribution, adoption-neutral and valuable even if we never
jump: one PRIVATE backend interface UNDER the D29 gateway, named
**`AgentHarnessBackend`** — replacing the earlier `PiPlatform` sketch —

```ts
interface AgentHarnessBackend {
  openSession; importSession; readSnapshot; watchEvents;
  submitPrompt; abortOperation; inspectOperation; closeSession
}
```

— implemented today by an adapter over our current gateway/0.80.7 path, and
someday by a pi-v2 adapter. UI components **never** depend on this seam —
they depend on the D29 gateway only; `AgentHarnessBackend` is the gateway's
private runtime adapter. It must NOT own accounts, credentials, payer,
workspace membership, model eligibility, provider secrets, billing, seat
identity, public pagination, or public receipts — those stay above it in
Boring. This is the concrete mechanism behind the alignment recommendation's
"align so nothing we build fights the pi-v2 shape", and it is tracked as its
own bead (see `pi-v2-alignment.md` §Recommendation).

## Migration sequence (adopted verbatim — it matches our ruling)

1. create the seam → 2. move current behavior behind adapters → 3. stop
leaking pi internals into components → 4. integrate stable pi-v2 slices
incrementally → 5. verify → 6. delete the old subsystem. Never: delete
first, depend on unstable dev internals, rewrite again.
