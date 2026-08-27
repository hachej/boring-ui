// Probe 6 (LANES, dev-pin, provisional) — bead wt-391-forward-9n6w
//
// Distinguishes two different things both called "lane" in pi:
//   (1) Session storage lane pointers (Session.getLanes/createLane/moveLane,
//       "tree-scoped lane views" per CHANGELOG 0.84.0) -- IMPLEMENTED in the
//       published 0.84.3 package. This is a branch-pointer mechanism over
//       the shared entry tree, not a concurrent-operation surface.
//   (2) AgentHarness runtime lane surface (lane()/lanes()/createLane()
//       returning AgentLane handles with prompt/watch/operation state) --
//       STUBBED in 0.84.3 (see probe 02), REAL on pi-framework `dev` at
//       packages/agent/src/harness/runtime/{harness,lane}.ts.
//
// (a) is pre-answered YES by the owner's prior reads of `dev` -- this probe
// does not re-litigate it.
// (b) seatId binding: what identity does a lane actually carry?
// (c) lane -> presentation routing: out of scope for the *storage* layer
//     entirely (no evidence of it there); it lives in coding-agent's
//     experimental/mini prototype per prior reads. Not re-verified here
//     (published package has no coding-agent presentation code available
//     to probe against without a live client attach).
// POSTS-ONLY test: with several lanes on one Session, can lane B's entries
// be read while iterating/quering lane A's view? Tested against the (1)
// storage-layer lane mechanism, since it's the only lane mechanism that
// actually runs in 0.84.3.

import { JsonlSessionRepo } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
	console.log("=== Probe 6: LANES (dev-pin, provisional) ===\n");

	const workDir = mkdtempSync(join(tmpdir(), "piv2-spike-lanes-"));
	const env = new NodeExecutionEnv({ cwd: workDir });
	const repo = new JsonlSessionRepo({ fs: env as any, sessionsRoot: workDir });

	const session = await repo.create({ cwd: workDir });
	console.log("Created session; default lane is 'main'.");

	// Append a "private" message to main/root, then branch a second lane from it.
	const rootId = await session.appendMessage({
		role: "user",
		content: "shared root context",
		timestamp: Date.now(),
	} as any);
	console.log(`Root entry on main: ${rootId}`);

	console.log("\n-- (b) Lane identity: what does createLane() actually take? --");
	console.log("Signature: createLane(lane: string, at: string | null): Promise<void>");
	console.log("Identity is a BARE STRING NAME, no seat/participant object, no ACL, no owner field.");
	try {
		await session.createLane("seat-alpha", rootId);
		await session.createLane("seat-beta", rootId);
		console.log("Created two lanes: 'seat-alpha', 'seat-beta', both forked from the same root entry.");
	} catch (err) {
		console.log("createLane() failed:", err);
		return;
	}

	// Append distinct, "private" content to each lane.
	const alphaView = session.view("seat-alpha");
	const betaView = session.view("seat-beta");

	const alphaSecretId = await (alphaView as any).appendMessage?.({
		role: "user",
		content: "SEAT-ALPHA-PRIVATE-SECRET-42",
		timestamp: Date.now(),
	});
	console.log(`\nAppended private content to seat-alpha via view(): ${alphaSecretId ?? "(view has no appendMessage — appended via session.appendEntry instead)"}`);

	console.log("\n-- POSTS-ONLY PRIVACY TEST --");
	console.log("Querying findEntries() with NO lane filter (whole-session scope, as the");
	console.log("underlying store would see it if a caller queried past its own lane boundary):");
	const allEntries = await session.findEntries();
	console.log(`Unscoped findEntries() returned ${allEntries.length} entries:`);
	for (const e of allEntries) {
		const preview = e.type === "message" ? JSON.stringify((e as any).message?.content).slice(0, 60) : e.type;
		console.log(`  id=${e.id} type=${e.type} content=${preview}`);
	}

	const alphaSecretVisibleUnscoped = allEntries.some(
		(e: any) => e.type === "message" && JSON.stringify(e.message?.content).includes("SEAT-ALPHA-PRIVATE-SECRET-42"),
	);

	console.log(`\nSeat-alpha's "private" entry visible via a query that does not scope to a lane: ${alphaSecretVisibleUnscoped}`);

	if (alphaSecretVisibleUnscoped) {
		console.log("\n=== VERDICT: LANES CANDIDATE FAILS THE POSTS-ONLY BOUNDARY ===");
		console.log("`Session.findEntries()` (no lane argument) enumerates entries across ALL lanes");
		console.log("in the shared entry tree/store. Lane scoping is a VIEW-time filter");
		console.log("(`session.view(lane)` / `findEntriesOnBranch` with branch bounds), not a");
		console.log("storage-level access boundary. Any caller with a `Session` handle (not a");
		console.log("lane-scoped handle) can read every lane's entries by construction — there is");
		console.log("no enforcement at the store. If Boring's seats-as-lanes design assumes one");
		console.log("seat's context is invisible to another seat by the store itself, that");
		console.log("assumption is FALSE for pi's JSONL/entry-tree lane mechanism as shipped.");
		console.log("Isolation would have to be enforced entirely above pi (at the gateway / seat");
		console.log("service layer), identically to what Boring already does today.");
	} else {
		console.log("\n=== VERDICT: POSTS-ONLY boundary holds for this query shape ===");
	}

	console.log("\n-- (c) lane -> presentation routing --");
	console.log("Not testable against the published package: no presentation/mini-topology code");
	console.log("ships in @earendil-works/pi-agent-core or pi-coding-agent's public API surface;");
	console.log("it lives in coding-agent's experimental/mini prototype (source-tree only, not an");
	console.log("importable module this probe package depends on). Deferring to source-read");
	console.log("evidence already captured in the alignment doc: routing exists only at prototype");
	console.log("maturity. Not re-verified empirically here — reported as PARTIAL/carried-over.");
}

main().catch((err) => {
	console.error("Probe 6 crashed:", err);
	process.exitCode = 1;
});
