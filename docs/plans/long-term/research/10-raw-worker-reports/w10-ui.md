DIG the CLIENT/UI layer of two agent frameworks and extract design ideas for an existing, mature chat UI.

ALREADY KNOWN — do not re-report: Flue's state-based protocol vs delta protocol; opaque offsets;
`view=history|updates`; the 5-route surface; `dynamic-tool` part shapes; settlements; that
@flue/react provides hooks not components; that we have 18.5k lines of ChatPanel and they have none.

TARGETS
A. Flue: `@flue/sdk` and `@flue/react`. Docs offline from /home/ubuntu/projects/spike-flue-celld:
     npx -y @flue/cli@2.0.3 docs read sdk/overview | sdk/flue-client | sdk/create-flue-client |
       sdk/events | sdk/errors | guide/react
   Source/types: `npm pack @flue/sdk@2.0.3` and `@flue/react@2.0.3`, untar, read the .d.ts.
B. eve's client story: https://vercel.com/docs/eve and github.com/vercel/eve docs/. Fetch via
   curl -sL "https://r.jina.ai/<url>". Look for its React/streaming/UI packages and its event shapes.

DIG SPECIFICALLY INTO
1. **`useDataWriter` / data parts** (Flue). An agent streams NAMED, typed, client-facing data parts
   (`data-<name>`) that update IN PLACE, separate from the message text. Get the exact contract:
   schema, identity rules, update semantics, how the client renders them, how they interact with
   replay. We have nothing like this and it may be the most interesting idea in their client layer.
2. **`observe()` vs `history()`** on the SDK client: the materialised-state subscription model, how
   it reconciles, what it guarantees on reconnect, optimistic echo handling.
3. **`wait()`** — awaiting a submission's settled reply across process loss.
4. **Attachments**: upload, addressing, `attachmentUrl()`, and how bytes are authorised.
5. eve's equivalents for all of the above, and anything eve has that Flue does not.
6. Error surfaces: how a client distinguishes retryable / terminal / user-actionable failures.

FOR EACH IDEA, answer: what would it give a mature chat UI that ours does not have today, and is it a
protocol change, a component, or a convention? Be concrete — sketch the wire shape or the hook signature.

Compare against ours where useful: the panel is packages/agent/src/front/** on `origin/main` in
/home/ubuntu/projects/boring-ui-v2 (read with `git show origin/main:<path>`); note especially
`front/toolRenderers.tsx` and `shared/tool-ui.ts`, which are OUR differentiators.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/w10-ui-ideas.md
Rank ideas by value to a product with a strong existing UI. For each: mechanism, wire/API sketch, what
it replaces or adds, and rough cost. End with "not worth taking" for anything you evaluated and rejected.
No preamble. 400-800 lines.
