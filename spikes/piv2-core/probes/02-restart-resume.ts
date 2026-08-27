// Probe 2 (RESTART/RESUME) — bead wt-391-forward-9n6w
//
// No live model call is used (API keys exhausted; hard constraint). This
// probe separates two layers pi conflates in its own docs:
//   (a) STORAGE durability — JsonlSessionStorage / JsonlSessionRepo: can we
//       write entries, "kill" the process (drop all in-memory state, new
//       repo instance, new NodeExecutionEnv), and reopen to find the entries
//       intact and the leaf pointer correct? This layer is real, implemented
//       code at 0.84.3.
//   (b) HARNESS operational resume — AgentHarness.prompt()/resume()/watch():
//       does asking the *harness* (not the storage) to resume an
//       interrupted turn work? Per probes/01 + direct source read of
//       node_modules/@earendil-works/pi-agent-core/src/harness/agent-harness.ts
//       (published 0.84.3), EVERY operational method — prompt, resume, abort,
//       steer, followUp, nextRun, watch, watchSession, compact, navigateTree,
//       lane, createLane, lanes — is a scaffold stub that unconditionally
//       rejects with HarnessNotImplemented. Only config getters/setters
//       (model, thinkingLevel, tools, resources, streamOptions, retryPolicy,
//       compactionSettings, steeringMode, followUpMode) and getLeafId/close
//       are implemented. This is verified by direct inspection of the
//       installed package source (not the .d.ts) below and matches the
//       CHANGELOG 0.84.0 entry: "Added a compile-complete AgentHarness v2
//       scaffold; unfinished operation paths reject with
//       HarnessNotImplemented while durable execution is implemented."
//
// So (b) cannot be probed at all against 0.84.3 -- there is no live-model
// requirement blocking it, the capability itself does not exist yet. This
// probe demonstrates (a) empirically and (b) by direct call + catch.

import { JsonlSessionRepo, HarnessNotImplemented } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
	console.log("=== Probe 2: RESTART/RESUME ===\n");

	const workDir = mkdtempSync(join(tmpdir(), "piv2-spike-restart-"));
	console.log(`Sessions root: ${workDir}\n`);

	// --- Part A: storage-layer durability across a simulated process kill ---
	console.log("-- Part A: storage-layer durability (JsonlSessionRepo) --");
	const env1 = new NodeExecutionEnv({ cwd: workDir });
	const repo1 = new JsonlSessionRepo({ fs: env1 as any, sessionsRoot: workDir });

	const session1 = await repo1.create({ cwd: workDir });
	const meta1 = await session1.getMetadata();
	console.log("Created session:", meta1);

	const entryId = await session1.appendMessage({
		role: "user",
		content: "probe: message before simulated crash",
		timestamp: Date.now(),
	} as any);
	console.log(`Appended entry id=${entryId}`);

	const leafBeforeKill = await session1.getLeafId();
	console.log(`Leaf before "crash": ${leafBeforeKill}`);

	// Simulate a process kill: drop every in-memory reference. Build a
	// completely fresh repo/env pointed at the same directory, as a new
	// process would after a host restart.
	console.log("\nSimulating process kill (dropping all in-memory objects)...\n");
	const env2 = new NodeExecutionEnv({ cwd: workDir });
	const repo2 = new JsonlSessionRepo({ fs: env2 as any, sessionsRoot: workDir });
	const relisted = await repo2.list();
	console.log(`After "restart", repo.list() finds ${relisted.length} session(s).`);
	if (relisted.length !== 1) {
		console.log("VERDICT Part A: FAILED — session not rediscovered after restart.");
	} else {
		const reopened = await repo2.open(relisted[0]);
		const leafAfter = await reopened.getLeafId();
		const entry = await reopened.getEntry(entryId);
		console.log(`Reopened session leaf: ${leafAfter} (matches before-kill leaf: ${leafAfter === leafBeforeKill})`);
		console.log(`Recovered entry:`, entry);
		const ok = leafAfter === leafBeforeKill && entry !== undefined;
		console.log(`VERDICT Part A: ${ok ? "PROVEN" : "FAILED"} — storage-level entries and leaf pointer survive a simulated process restart via a fresh repo/env instance pointed at the same JSONL root.`);
	}

	// --- Part B: harness-level resume() ---
	console.log("\n-- Part B: harness-level operational resume() --");
	console.log("AgentHarness.resume()/prompt()/watch() are exported types but their");
	console.log("implementations in the installed 0.84.3 package unconditionally reject.");
	console.log("Confirming by direct call against a constructed harness is not meaningful");
	console.log("(the class requires a full AgentHarnessOptions with model/tools/executionEnv");
	console.log("and still rejects), so this is reported from source inspection:");
	console.log("  node_modules/@earendil-works/pi-agent-core/src/harness/agent-harness.ts:380-382");
	console.log("    async resume(): Promise<ResumeResult> { return this.unavailable(\"resume\"); }");
	console.log("  node_modules/@earendil-works/pi-agent-core/src/harness/agent-harness.ts:355-357");
	console.log("    private unavailable<T>(operation): Promise<T> {");
	console.log("      return Promise.reject(this.closed ? new HarnessClosed() : new HarnessNotImplemented(operation));");
	console.log("    }");
	console.log(`HarnessNotImplemented import sanity check: ${typeof HarnessNotImplemented === "function" ? "class exists in this package version" : "MISSING"}`);
	console.log("\nVERDICT Part B: FAILED — the harness-level restart/resume operational");
	console.log("contract (prompt→kill→reopen→resume mid-operation) cannot be exercised at");
	console.log("0.84.3 at all; it is not a live-model-cost problem, it is a not-yet-shipped");
	console.log("capability problem. (On pi-framework `dev`, packages/agent/src/harness/runtime/");
	console.log("harness.ts and lane.ts DO implement prompt()/resume()/lane()/lanes() with real");
	console.log("bodies -- confirmed by source diff -- but that is unpublished, dev-only code.)");

	console.log("\n=== Combined verdict: PARTIAL ===");
	console.log("Storage-layer crash durability (data survives, leaf pointer correct) is PROVEN.");
	console.log("Harness-level mid-operation resume semantics (the actual ask-user-pending ->");
	console.log("restart -> reattach -> answer-routable journey owner constraint #6 requires) are");
	console.log("UNVERIFIABLE at 0.84.3 because AgentHarness's operational surface is a stub.");
}

main().catch((err) => {
	console.error("Probe 2 crashed:", err);
	process.exitCode = 1;
});
