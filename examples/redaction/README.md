# Fictional redaction admission

Run `npm run build`, then `node examples/redaction.mjs`. Three independent subjects publish fictional text through native producer/delivery tasks into a real SQLite workspace (one per scope, [`../shared/sqlite-workspaces.mjs`](../shared/sqlite-workspaces.mjs), with the fixture's policy at the workspace boundary). This uses no model, browser, consumer source or patient data.

`openRedactionFixture` owns its native Harness and provider. The host supplies authenticated fixture actors and current policy. `local` exposes privileged setup/inspection access for the example and tests; it is not a browser capability. `close()` awaits owned resource teardown. Opening a viewer is not part of this fixture.

`capture(subject, requestId, actor)` returns exact source/config revisions and current generation/edit/output expectations. Retain that original request for retries. `admit(request, actor)` creates an immutable request reservation and advances that subject's generation guard in one provider transaction. The reservation binds the original actor, request and opaque generation UUID. Its shared resource identity prevents another actor from claiming the same request, even though operation receipts are actor-scoped.

After reservation, a native transaction records the request plus producer and delivery tasks together. Those two transactions are a recoverable boundary, not an atomic provider/native commit. A retry reads the original reservation and receipt, including the original guard revision after a newer generation advances. It neither selects fresh expectations nor rewinds a guard. The delivery task checks generation, human-edit, source, config and output expectations in its output transaction.

Independent A/B/C guards permit out-of-order completion. Human edits use separate resources; a changed edit revision blocks old generated output. The producer retains the exact captured source text and original actor in native input. Delivery resolves that actor from committed native storage. Explicit admission access avoids trying to read a newly created producer inside a native write transaction.

Results distinguish these facts:

- `admitted` returns the original generation, resource references and native task IDs. It does not mean output has published.
- `reserved` confirms the provider stage committed while native admission is unconfirmed. It returns no protected references. Retry the original request under current permission.
- `unknown` means an acknowledgement or admission outcome is uncertain. Retry the original request; do not mint a replacement ID.
- `conflict`, `denied` and `unavailable` refuse the current invocation. They do not erase effects of an earlier attempt with that request ID.

Current policy gates reservation creation, native admission, execution, publication and reference disclosure. External policy changes do not share the provider/native storage transaction. References and registration do not create permission. Test hooks pause after actual commits to prove crash recovery; they are trusted fixture code.

`test/compatibility/redaction.test.mjs` covers real provider/native admission, duplicate and concurrent identities, out-of-order completion, human edits, mutable callers and revocation. `test/contracts/redaction-crash.test.mjs` kills real child processes after reservation, native admission and output commits. The installed files/agent consumer repeats these cases.

## Typed proposals, corrections and adoption

`node examples/redaction-adoption.mjs` drives the extended fixture. Native generation calls real source and calculator tools through a scripted model. Bounded repair and a separate final validation task enforce the required evidence. Host-issued item IDs remain stable across reordered proposals. Human corrections live separately; explicit adoption chooses proposed or corrected text and conditionally publishes the record and letter in one SQLite transaction.

`test/compatibility/redaction-proposals.test.mjs`, `redaction-adoption.test.mjs` and `test/contracts/redaction-adoption-crash.test.mjs` exercise these paths, including process death after the two-output commit and before acknowledgement. See the [feature map](../../docs/implementation/FEATURES.md#fictional-redaction-corrections-and-adoption) for their scope. Live-model quality, clinical expert acceptance and consumer migration remain unqualified.
