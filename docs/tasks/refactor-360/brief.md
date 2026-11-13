# 360 refactor plan: from the factory we have to self-updating apps

Draft for Julien's review, 13 November 2026. This pull request only adds this file so it can be read on a phone. **Do not merge.** Nothing here has been built in this repository.

How to read the evidence tags: **ran** = executed in a local spike on 13 November; **source** = read in the library's code; **docs** = documentation only, not yet run by us.

## 1. In short

**Factory = services + one agent per app + models.**

- An app is a set of **Alchemy Domain models** and their screens. One model definition produces its own MCP server, agent tools, HTTP interface, live updates and fast tests.
- **One pi-durable agent per app** is both product manager and assistant. It talks to the expert, uses the app through the model's MCP server, and updates the app by editing the models.
- **Studio** is the union of every app's MCP server.
- **Alchemy** deploys the same app to Cloudflare, to a machine of ours, or to AWS.
- We reuse upstream blocks wherever one exists, and keep only what is ours by nature: the sandbox, the rules about who may do what, the product manager's craft, the neutral tester, the screens.

**Method:** build the new beside the old, one app at a time. Every phase ends with something a person can use and a deletion. No phase starts before the previous one's exit test passes.

**Verdict of an independent hard review of this plan (section 9): do not go as first written; go on a rebuilt Phase 0 only, and decide Phase 1 on its numbers.** Phase 0 below is the rebuilt one.

## 2. The design in layers

| Layer | What | By |
|---|---|---|
| The expert | Says what they need, in their words, to their app | |
| One agent per app | Refines the need, operates the app, edits the models, checks, applies. Reaches the app only through its MCP server | pi-durable |
| The app | Domain models: commands, events, records, views, policies. A plugin is one model plus its screen | Alchemy Domain on Effect |
| Capabilities | Sign-in, files, e-mail, a language model, OCR, billing: typed needs a model declares and the platform supplies | Alchemy's shape, our enforcement |
| Infrastructure | The same model on Cloudflare, on Docker on one machine, or on AWS | Alchemy |

The agent and the app meet only at the MCP server. No agent code in the app, no Effect in the agent, so either supplier can be replaced without touching the other.

## 3. The loop: how the expert updates the app

1. The expert asks the agent for a change. The agent asks back only what is theirs to decide, one question at a time.
2. The agent edits the model's source, following a short skill on writing models.
3. Check: the type check and the model's given/when/then tests. Measured: 1.4 s and 0.12 s (**ran**).
4. Trial: the new model is loaded beside the live one and stored data is replayed through it. A model that cannot read old data is refused here (to build).
5. The expert sees a plain-words description of the behaviour change and says yes.
6. Apply. In our sandbox on Cloudflare this is a pointer switch: 0.26 s to 0.5 s measured (**ran**, local runtime). On other hosts it is an Alchemy deploy.
7. The app's MCP server now lists the new tool. The agent picks it up at its next step, in the same conversation.
8. A neutral tester agent, which never saw the change, walks the app. Every apply is a commit, so the code can be rolled back.

**First real run of the whole loop (ran, once):** asked "I want to set a target weight per exercise and see how far I am from it", the agent read the model, rewrote it with a new command and view, wrote five tests, passed the check first time, applied in 508 ms, saw the two new tools appear, used one, and asked the expert which targets to set. 66 seconds, 8 tool calls, no help. Our own code for it: 36 lines for the bridge from the MCP server to the agent, 70 lines for the four update tools, a 69-line skill. This is one run on a small example, and the agent judged its own tests; a real rate on hard features is what Phase 0 measures.

### Three levels of change, cheapest first

The agent does not only change the app. It can also change itself, and most requests should stop at the first level that satisfies them.

| Level | What changes | Who is affected | Cost and control |
|---|---|---|---|
| 1. Memory | What the agent remembers about this person: preferences, vocabulary, standing instructions | That person only | Instant. No approval |
| 2. The agent's own skills and tools | A skill ("when I upload a bank statement, do this"), or a tool of its own: a small script that combines several of the app's operations, calls an outside service the person connected, or computes something | That person, or everyone using the app's agent if the owner shares it | Instant, no change to the app. The tool runs in the agent's own sandbox and can do only what the agent could already do. The person approves it once |
| 3. The app's models and screens | A new command, a new record type, a new screen | Every user of the app, and every outside agent | Check, replay of data, trial load, the expert's approval, the neutral tester |

Level 2 is what this repository's self-evolution feature already does (an `.agent/` folder of instructions, skills and tools, a `reload` tool, an approval), so it is carried over, not invented.

### One lifecycle, two authors

The in-app agent (product manager and assistant in one) edits the app directly: it has read, write, check and apply on the app's models and screens. This reverses our earlier rule that the product manager never builds.

The same lifecycle is shared with the factory behind it. There is one source (the app's own repository), one check and one apply, and two kinds of author:

| Author | Where it works | What it takes on |
|---|---|---|
| The app's own agent | Inside the app, in conversation with the expert | Small changes the expert asks for: a field, a command, a view, a screen, wording. Additive only |
| The factory (a worker of ours, or Julien from his own tools) | From outside, on the same repository | What the app's agent may not or cannot do: a change in the shape of existing data, a new capability (network, a secret, payments, a role), a large feature, a change that failed twice |

Rules that make it one lifecycle and not two:

- **The same apply function for both.** A worker does not get a separate pipeline; it runs the same check, the same replay of data, the same trial load. This is P3's rule ("editing is done by anyone with file access; an agent gets the same as a tool") and what our pilot did: the button a person presses and the tool the agent calls were one function.
- **Applies are serialised**, and each one is a commit, so the history shows who changed what, the agent or the factory.
- **The app's agent hands over, it does not get stuck.** When a request is beyond its limits it writes a card for the factory with the expert's words, what it tried and why it stopped, and tells the expert so.
- **The app's agent is told when the factory changed the app**, with a plain-words summary, so it can tell the expert and use what is new.
- **The expert's approval and the neutral tester apply to both authors.**

### Why the app is reached through MCP, and what that rule does not say

The rule is narrower than "the agent only uses MCP":

- **Anything that reads or writes the app's data goes through the app's published interface.** For an agent that interface is the MCP server the model generates. This gives one door with one set of rules: the app's own agent, a person's outside assistant and Studio all pass the same checks, and there is no second path to keep safe.
- **The agent's own tools live with the agent**, not in the app, and run in its sandbox. When one of them needs the app's data it calls the app's operations through the same door, so the rules still hold.
- **Agent-written code never runs in the agent's own process**, where the model credential lives. App code runs in the app's sandbox; the agent's own tools run in a script sandbox whose only power is calling tools.

Open point: when the agent and the app run in the same place, the generated toolkit can be called directly without the MCP hop. That is an optimisation of the same interface, to take only if the hop is measurably slow.

## 4. Blocks we reuse instead of writing

| Block | From | Replaces of ours | Checked |
|---|---|---|---|
| MCP server generated from a model | Alchemy Domain | Operation-to-tool wrappers, tool list generation, per-app tool forwarding | ran |
| Agent toolkit from a model | Alchemy Domain | Hand-written chat tools | ran |
| Given/when/then tests, static model check | Alchemy Domain | Per-app test scaffolding | ran |
| HTTP interface with OpenAPI, typed client, command line, live push | Alchemy Domain | The template's server framework and operations registry | source |
| Timers, retries, exactly-once commands, sagas | Alchemy Domain | Our scheduling and waiting wrappers | source |
| External systems as typed capabilities | Alchemy Domain | The shape of our capability object (enforcement stays ours) | ran |
| Effect Cluster: durable entities, workflows, scheduled jobs | Effect, through Alchemy | The host for our own machine and AWS; the engine for long multi-step work; scheduled jobs per app | docs |
| Sign-in per app: e-mail, Google, GitHub, Microsoft, any OIDC provider; users stored with the app; tables migrated at deploy | Better Auth, through Alchemy | Per-app role storage and admission in a central service (see section 5) | source |
| Stripe as code: products, prices, usage meters, webhooks, checkout | Alchemy | A price list set up by hand; part of our billing code | source |
| File storage with direct uploads, e-mail send and receive, queues, scheduled jobs, workflows, rate limiting, model bindings, vector search | Alchemy on Cloudflare | Thin services and adapters of ours, one by one | source |
| Stacks, stages, state, secrets, plan and apply from code | Alchemy | Hand-written deploy configuration and scripts | docs |
| Local emulators, tests without cloud credentials | Alchemy | Parts of our conformance harness | docs |
| The agent harness: durable conversations, tasks, documents, in-place tool swap | pi-durable 1.5.2 | Most of this repository's agent library | ran |
| MCP client with sign-in for outside servers | pi-mcp | Part of our connections service | source |
| Sandboxed scripts whose only power is calling tools | pi-codemode | Already used | in use |
| Screens as pure functions, bound to the model | Foldkit, through Alchemy's binding | To be decided (section 6) | source |
| **This repository's UI kit**: the app shell, the chat, 155 components, the design rules and their checks | Ours (boring-ui) | Nothing: it is the block we keep and reuse for how every app looks and for the agent's chat. Section 6 says how plugin screens use it | in use |
| Self-evolution of the agent: its own instructions, skills and tools, with reload and approval | Ours (boring-ui, on pi-durable) | Nothing: it becomes level 2 of the loop (section 3) | in use in the kit, not yet in apps |

Not provided by Alchemy: WhatsApp, OCR, OAuth for MCP clients, loading changed code into a running app, migration of stored data when a model's shape changes.

## 5. Sign-in: one per app, with an optional bridge

Julien's direction (13 November): sign-in should be decentralized, one per app, so that an app deployed anywhere needs nothing from a central service.

Findings (**source**):

- **Our own account service already runs on Better Auth**, the same library Alchemy wraps, including its OAuth provider. So per-app sign-in is the same library packaged per app, not a move to something new.
- Alchemy's part is thin: it generates and keeps the signing secret, migrates the tables at deploy, and gives a typed session to the model through middleware. Everything else is plain Better Auth.
- Out of the box: e-mail and password, Google, GitHub, Microsoft, a generic OIDC provider, nine database choices.
- Configuration of Better Auth (not documented by Alchemy): e-mail codes, invitations, organizations and roles, API keys, passkeys, rate limits, account deletion.
- **Our own rules stay our code in every case**: invitation-only sign-up, outside members confined to one space, a role change taking effect within a minute, short-lived tokens for the app's agent, linking a messaging account by one-use code. Nothing is impossible; nothing beyond the provider sign-ins is truly out of the box.
- The Domain library itself has **hooks only**: an identity carried with each call, and middleware. Tools take a raw record id; nothing checks ownership automatically; no separation between tenants is built in.

What per-app sign-in costs: one account across apps, central revocation, and Studio under one identity. Alchemy ships no OAuth for MCP clients; its MCP server only passes the caller's cookie or header along.

**The bridge (proposal):** every app is self-contained, and "sign in with our account" is one optional OIDC provider among others. Connected apps and Studio use it; disconnected apps leave it out. Alchemy's own example tests exactly this path against a mock provider, and no user is migrated.

## 6. Screens: our React kit and Foldkit

Foldkit (**source**) is an Elm-style framework on Effect: a screen is a pure function of a model, with messages and no hooks, tested without a browser. Alchemy's binding derives the commands, queries and live updates from the Domain model. It ships skills for coding agents.

- For: a screen becomes as writable and checkable by an agent as the model is, which makes the whole app self-updating and not only its logic.
- Against: one maintainer, not yet at version 1, breaking changes in minor releases. React components cannot run inside Foldkit, so this repository's kit (about 12,000 lines in the UI package, 155 components) cannot be reused inside it. The reverse works: a Foldkit screen can be embedded inside a React page.

A hands-on run (section 19) confirmed both sides: the type checker caught a stale Foldkit screen, and the screen itself was an unstyled page of 171 lines for a two-field form.

**Proposal:** this kit is the default for everything a person sees: the shell, the chat, and plugin screens. A plugin screen is a React component built from the kit's components on the model's typed client, so it gets our look and our design checks, and the type checker still catches a screen that is out of date with its model. What is missing is a small binding from a Domain model to React (read a view, send a command, follow live updates); Alchemy ships one only for Foldkit, so that binding is ours to write, once. Foldkit stays a side trial on one screen, for the case where pure screens prove much more reliable for the agent to write.

## 7. Deploy wherever we need

| Target | The app's models run on | The agent runs on | Notes |
|---|---|---|---|
| Cloudflare | Our sandbox (apply in a fraction of a second, isolated per app) | A Durable Object that sleeps and wakes | Near free per app. Loaded code cannot set its own timers; the supervisor drives them |
| A machine of ours | Effect Cluster on Docker with one Postgres | A Node process with a database file | Postgres is a single point of failure; fine for development and small use |
| AWS | Effect Cluster on containers with a managed Postgres | A container | The path for the one app we run on AWS, with no second runtime of ours |

What moves between targets unchanged: the models, their tests, the agent's instructions and skills, the capability contracts. What differs: one host setting and the stack file. Only the Cloudflare sandbox has been run by us (**ran**, local runtime); the other two are **docs**.

## 8. The map: every area, from today to the target

| Area | Today | Target | Verdict |
|---|---|---|---|
| App code | A copy of the template per app; repositories that drift | A folder of models and screens per app, in the app's own repository; every apply is a commit | Replace |
| App data | SQL databases with hand-written migrations | Events and views per model in the app's own database; table-like data (ledgers) in SQL tables through projections | Replace, with a one-time import per app |
| Runtime | A host loading one bundle per commit; three runtimes sharing code by copy | A small supervisor loading the app's models as isolated code; elsewhere, Alchemy's hosts | Shrink |
| Build and apply | A one-second build, then a container build; trunk, previews, a verifier pool, a ship gate | The one-second build; apply = check, replay data, trial load, switch | Shrink; keep the fast build and signing |
| The agent | An assistant per app plus separate hosted product manager, judge, triage, builder, router, and per-app masters | One agent per app with read, write, check, apply; the judge as a tool | Replace; the texts are carried over |
| Who may do what | Capabilities handed per request and revoked; read-only data for agents; spaces; outside members | The same rules, enforced by the supervisor outside any code the agent can edit | Keep |
| Sign-in | One central account service and directory | Per app, with the optional bridge (section 5) | Shrink |
| The MCP door and Studio | A gateway with a hand-kept tool list | Sign-in in front of the union of every app's own MCP server | Shrink |
| Platform services | Model gateway, files, e-mail, billing, outbound allow-list, connections | The same jobs as typed capabilities; upstream blocks where they do the same job | Keep, thin |
| Screens and chat | This kit; a chat transport of ours; interface blocks synced into every app | The kit for the shell and chat; plugin screens on the model's typed client, Foldkit on trial | Shrink |
| This repository's agent library | About 16,000 lines wrapping pi-durable | About 3,000: the credit fence, skills loading, conversation titles, what pi-durable lacks | Delete most |
| Requests and tasks | A task store with states, questions, receipts | For an app: the conversation and the commit log. A small card list for platform work only | Shrink |
| Quality | Checks in containers, gates, per-feature acceptance lines | Checks inside apply; a watch with automatic rollback; one neutral tester; an eval per app with a number | Replace; keep the watch and the tester |
| Infrastructure | Hand-written deploy configuration, no staging | Alchemy stacks for the services that survive, with a staging stage | Replace |
| Phone app, messaging | A native shell; a messaging channel into Studio | Unchanged | Keep |

## 9. The hard review, and what it changed

An independent reviewer attacked the first version of this plan against the code and the real apps. Findings, most damaging first:

1. **The storage in the spike cannot hold a real accounting app.** It keeps each view as one growing value. Real ledgers are wide tables with sorting, search and matching in SQL. *Change:* such data goes into SQL tables through Domain's projections, and Phase 0 loads real-size data to measure it.
2. **The check on who may do what sat inside the code the agent rewrites**, and the spike's apply asked nobody. An agent that reads a client's document and can also rewrite the app is an injection path. *Change:* identity and rights are enforced by the supervisor, outside editable code; the write and apply tools are withheld in any turn that has read untrusted content; the expert approves a plain-words description; the platform rules this amends are listed.
3. **The evidence was one run on a small example, and it judged itself.** *Change:* Phase 0 ports one hard slice of each real app, with tests written from acceptance lines by a different agent before the build.
4. **The deletion arithmetic did not reach the first target.** The deletions add up to about 72,000 of about 194,000 lines (some figures include tests); the services we keep are about 58,000 on their own. The earlier "under 60,000 remaining" is withdrawn. *Change:* a table of every duty of today's host with where it lands, before Phase 1.
5. **Erasing a person and undoing a change do not fit an append-only log.** *Change:* erasure is designed and tested in Phase 0; rollback restores code, and data is fixed forward.
6. **Six weeks of machinery before any user value repeats an old mistake.** *Change:* an optional one-week trial on today's platform (Phase 0-B).
7. **The supplier cost is more than "pin the versions".** About a day a week; a contract test on the library internals our host touches; stop at the first break.
8. **The tester was underspecified.** *Change:* its script is written before the build; one real agent turn as an ordinary person, before and after; cost per change is measured.
9. **Missing entirely:** backups and restore of the apps' data, many people in one object, the phone app on the new interface, monthly cost per app, an agent breaking an app at night, the data rules of the app on AWS, outside members.

## 10. Phases

### Phase 0, rebuilt. Prove it on the hard parts

About two weeks. No production change, except the optional trial 0-B.

- **0-A.** One hard slice of each real app as Domain models, through our sandbox host, on real Cloudflare with a throwaway app. For the accounting app: one real-size ledger import, the entries table with its sorting and search, bank matching, and an erasure. For the coaching app: a training session with its offline queue and its timer on the server clock, and one person's full history. Tests written from acceptance lines by a different agent before the build.
- **0-B (needs a yes).** A one-week trial on today's platform: the coaching app's existing assistant adds a record kind, a tool and a card behind a flag, shipped the normal way. It measures ask-to-live now, with no new machinery.
- **0-C.** The loop's success rate on those slices: ten requested changes, judged by tests the agent did not write.
- **0-D.** The boundary: rights enforced by the supervisor; an approval step in apply; write and apply withheld after reading untrusted content. Tested from the refused side.
- **0-E.** Effect Cluster and elsewhere: the same model on Docker with one Postgres; one saga and one scheduled job on it; then the same through the Cluster's Durable Object pool on Cloudflare, to decide whether long work and schedules in the sandbox go through Cluster or through our supervisor. One throwaway Alchemy stack. The cause of a view lag of up to 10 seconds seen in the spike.
- **0-F.** Sign-in and screens: one app with its own Better Auth and the optional bridge; one plugin screen in Foldkit embedded in the React shell.
- **0-G.** On paper: every duty of today's host and where it lands; the platform rules this plan amends; backups and restore; cost per app.
- In flight and needed either way: this repository's move to pi-durable 1.5.2.

**Exit test:** both hard slices work with real-size data on real Cloudflare; at least 8 of 10 changes pass tests the agent did not write; a second person cannot reach the first one's data even with rewritten app code; erasure works. Phase 1 and its estimate are rewritten from these numbers.

### Phase 1. The kernel

Built beside everything; touches nothing live.

- The base (about 200 lines), the supervisor and the sandbox host (about 150 lines exist from the spikes).
- Apply as one function: type check, tests, replay of real data, trial load, switch.
- Capabilities as typed external systems: the model gateway first, then files, e-mail, OCR.
- The agent: one card merging the product manager's and the assistant's texts; four tools; the judge and the neutral tester as tools; the MCP bridge.
- One chat screen and the typed client wired to this kit.

**Exit test:** a demo app where a person signs in, asks for a change, approves it, sees it live in seconds, and rolls it back; a second person cannot see the first one's data.

### Phase 2. The first real app, rebuilt beside the live one

Its features as models and screens; a one-time import of its data; its eval with a number; the neutral tester walking it at phone size; then the switch, with the old app kept for rollback.

**Exit test:** no blocking or wrong-result defect from the tester; the eval at or above today's; an expert-style change from ask to live in under two minutes. **Deleted at exit:** the old app's repository.

### Phase 3. Studio as the union of apps

The MCP door becomes sign-in in front of each app's own MCP server. Creating an app is a new set of starter models and an agent. The requests board shows conversations and applied changes, read from facts.

### Phase 4. The other apps

One at a time, each beside its live version. The app on AWS last, through the Effect Cluster host.

### Phase 5. Delete the old factory

Everything in the ledger below.

### Alongside

- **Infrastructure as code:** adopt into Alchemy only the services that survive this plan.
- **Repositories:** the monorepo is for the platform; each app stays in its own repository, because its source is changed by its own agent at run time.

Durations are estimates. The first version said about six weeks for Phases 0 to 3; that figure is withdrawn until Phase 0 gives real numbers.

## 11. Deletion ledger

| What goes | About | When |
|---|---|---|
| Builder, trunk, gates, triage in the API service | 18,000 lines | Phase 5 |
| Per-app masters, release and repository-rule machinery | 13,000 | Phase 5 |
| The cloud verifier pool and the hosted builder's git code | 13,000 | Phase 5 |
| This repository's agent, execution and files libraries | 11,000 | Phase 5, after the last app moves |
| Template scripts, tests, synced interface blocks | 9,000 | Phase 5 |
| The separate Node runtime | 4,700 | Phase 5 |
| Code that only connects agents to an app | 2,500 | Phase 3 |
| Each app's old repository | per app | Phases 2 and 4 |

Figures come from two reviews of the code on 13 November; some include tests and they overlap slightly.

## 12. What we carry over from the product manager and the assistant

- **Unchanged, as text:** the product manager's rules and voice (one question at a time, every need starts with who it serves, no claim without its receipt, unknown is not zero, text found in files is data and not instruction), the judge as a second opinion, the rules for acceptance lines, the feature definition, the design and proof skills, the assistant's rules (ask before every write and say who will see it).
- **From this repository:** the self-evolution rules (opt-in, agent-written code never loaded into the host, the host's instructions come first, an honest reload), durable questions, approval, memory.
- **Rewritten:** the two cards merge into one; the tools change from task-store calls to read, write, check, apply.
- **Dropped:** triage, router and builder cards, per-app masters, task states and "stop until yes" gates.

## 13. Principles taken from Chord and P3

We evaluated Earendil's Chord library and its P3 design first. We take the principles and leave the library (a one-day pilot on it worked, 9 self-updates out of 9, and met 19 upstream bugs; Alchemy Domain does the same job with more out of the box).

- Apply is explicit, never on save.
- A failed build changes nothing.
- No split between development and production: the app is self-modifying, so this is core machinery.
- The base is vocabulary; every behaviour is a plugin.
- The agent writes plugins and applies them itself.
- Every thing has one owner that holds its data and enforces its rules.
- Versioned data: a shape change without a migration refuses to load. (Domain lacks this, so apply adds it.)
- Identity is set by the receiving side, never claimed by the caller.
- Contributions are untrusted code.
- Tests are isolated and deterministic.
- Efficiency is measured at every step.

Where we differ on purpose: P3 has no apply gate and trusts whoever is on the server. We isolate each app and keep one approval by the expert.

## 14. Risks, in order

1. **Changing the shape of stored data.** Domain has no versioning or migration for a record's stored state or its events. Adding an optional field, a command or a view is safe; changing existing state broke reads in our test, and a simple trial load did not catch it.
2. **Youth.** The Domain library first shipped on 22 October 2026. Alchemy's last release had 20 breaking changes; releases come about weekly. Foldkit is not at version 1.
3. **Can an agent write these models and screens reliably on real features?** One run so far.
4. **Who may do what is ours to get right**, and it must live outside the code the agent edits.
5. **Views can lag** (up to about 10 seconds seen in our sandbox host; cause not found).
6. **Two young suppliers.** They meet only at MCP, so either can be replaced.
7. **Operations:** production credentials must not be reachable by any agent.

## 15. When to stop

| Sign | Then |
|---|---|
| Fewer than 8 of 10 real changes succeed without help, after one round of improving the skill | The agent proposes and a worker of ours finishes; the loop stays, the "no help" promise waits |
| The sandbox fails on real Cloudflare (size, timers, sleeping) | Use Alchemy's own Cloudflare host: one deploy per change |
| Replaying data cannot make shape changes safe | Models stay additive; real migrations are written and reviewed by a person |
| An Alchemy release breaks the model interface | Freeze the version for the phase; if it continues, keep the model shape and own the host (ours is 117 lines) |
| The first app's eval or tester score is below today's at the switch | No switch. The old app stays live; nothing was deleted |

## 16. How we judge it

| Measure | Today | Target |
|---|---|---|
| Ask to live, for a change inside an app | over 7 hours seen; about 2 hours on the best night | under 2 minutes |
| Steps without a hitch at the tester's first walk | 3 of 10 | 8 of 10 |
| Time a change waits on a person | 5 to 7 hours seen | one approval, by the expert who asked |
| Agents between the person and the change | 4 to 6 | 1, plus the tester after |
| Share of platform commits that change the factory itself | about 70% | under 20% after Phase 5 |
| Versions of the agent library in use | 3 | 1 |
| Cost per applied change | not measured | measured from Phase 0 |

## 17. Decisions

**Made by Julien on 13 November:**

- Phase 0 now; Phase 1 only after Phase 0's exit test.
- Stop the product manager panel roll-out; live apps on fixes only.
- Each app in its own repository; the monorepo is for the platform.
- The app on AWS stays there and moves last.
- Leverage Alchemy as much as possible; sign-in decentralized, one per app.

**Open:**

1. The one-week trial on the live coaching app (Phase 0-B): yes or no.
2. The bridge: is "sign in with our account" kept as an optional provider, so Studio can span connected apps?
3. Foldkit: try it for new plugin screens embedded in the React shell, or stay on this kit only?
4. The approval rule: one yes per change by the expert, with only a change in what a plugin needs (network, a secret, payments, a role, sharing) going to Julien?

## 18. What ran on 13 November

| Spike | Result |
|---|---|
| A Domain model for a workout log | 59 lines; MCP tools and agent tools from one definition; tests in 124 ms; type check 1.4 s; a capability declared and supplied; 123 KB compressed, no Node dependency |
| That model stored durably inside our sandbox | A 117-line host of ours; data survived a restart; apply of a changed model in 0.26 s; MCP served from inside; a capability reachable only when handed in; a broken build refused |
| Code loaded on the fly into a Durable Object | Apply without redeploy in about half a second; isolation confirmed; local runtime only |
| The whole loop with a real model | One run: 66 s, no help (section 3) |
| An earlier pilot on Chord | 9 self-updates of 9, median 40 s; 19 upstream bugs; 571 lines of our own for the self-update path |

Not yet run: real Cloudflare for the sandbox, an Alchemy deploy to a real account, Effect Cluster.

## 19. Hands-on run of Alchemy's own stack (13 November, local, no cloud account)

Starting from Alchemy's Better Auth example for Domain, on this machine, with local emulation only.

| Step | Result |
|---|---|
| Local development with no cloud account | Works after three fixes the docs do not mention: a newer Node version, sign-in provider secrets required when the stack is planned, and the example's state store needing an account (switched to local state). Then the database, the Durable Objects and the Worker all ran locally |
| The model over HTTP and MCP | Works. MCP is not in the tutorial; adding it took about 15 lines. The tool list came back with the model's two tools |
| Sign-in with Better Auth | Works. Signed out: refused. A user writes and reads their own notes. A second user reading or writing the first one's notes: refused. Wiring is about 105 lines. E-mail and password took one line |
| A sign-in screen | **None is provided.** The example has only provider buttons; an e-mail form had to be written |
| Sign-in through an outside OIDC provider (standing in for "sign in with our account") | Works with about 15 lines of configuration; the session then wrote a note through MCP |
| A Foldkit screen bound to the model | Works. A submitted note appeared through live push about 190 ms later; a note written from outside showed on the page. Screen 171 lines, bundle 160 KB compressed, build about 4 s. **No styling and no components**: the pages are unstyled browser defaults |
| An agent-style edit: add a field to the model, then fix the screen | The type check flagged the screen at both places it was out of date. 6 files, +34 and −21 lines. Tests green, hot reload showed the field |
| The data-shape gap, seen again | Notes saved before that edit **no longer loaded**, and nothing warned about it. Changing a view's shape needs a version bump that only the tutorial's last part mentions |
| MCP with sign-in | The tool list is open to anyone; calls need the session. A bearer token works after one line. **No OAuth for MCP clients** |

What this changes in the plan:

- **Sign-in per app is real and small on the server side** (middleware, sessions, the cross-user refusal, an outside OIDC provider, bearer tokens: one to fifteen lines each). The sign-in screen and OAuth for MCP clients are ours to build, once, in the kernel.
- **Foldkit is good for a screen's logic and safety, not for its look.** The type checker caught a stale screen, which is exactly what an agent needs. But it is verbose (about 170 lines for a two-field form) and brings no styling. So the proposal in section 6 stands as a trial, with our design rules supplying the look.
- **The data-shape check before apply is not optional.** The same failure appeared in two separate runs: a changed shape breaks reads of old data silently.
- Alchemy's documentation is behind its code in several places; budget for that.

## Sources

- Alchemy at commit 33c10dd5 (13 November 2026), version 2.0.0-beta.87: the Domain package and its documentation (https://alchemy.run/domain, https://alchemy.run/domain/mcp, https://alchemy.run/domain/cloudflare, https://alchemy.run/domain/effect-cluster), the Better Auth pages (https://alchemy.run/better-auth/what-is-better-auth), the cluster tutorial (https://alchemy.run/cluster/tutorial/part-4), plan and apply from code (https://alchemy.run/cli/api), the release notes (https://alchemy.run/blog/2026-11-12-beta-87/).
- pi-durable 1.5.2 and the pi repository's main branch on 12 November 2026 (https://github.com/earendil-works/pi): the durable README, the MCP client, Chord's design, the P3 decisions.
- Foldkit (https://github.com/foldkit/foldkit).
