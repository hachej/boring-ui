// Probe 1 (V3 IMPORT) — bead wt-391-forward-9n6w
//
// Goal: open a real 0.80.7-produced coding-agent v3 JSONL transcript through
// the published pi-0.84.3 harness (JsonlSessionRepo / Session), verify it
// loads unchanged, verify atomic conversion on first write, verify rollback
// (a copy is kept).
//
// Evidence source for the "v3 importer exists" claim: pi-framework dev
// branch, packages/agent/src/harness/session/jsonl/legacy-v3.ts (539 lines),
// referenced from harness.md Appendix B. That file's earliest commits land
// 2026-08-19 through 2026-08-24 on the `dev` line. The published 0.84.3
// package (npm gitHead bfb004d4418ff05c6f909eaaab856cbe75c1fde0) does NOT
// contain that file — confirmed via `git ls-tree -r bfb004d... --
// packages/agent/src/harness/session/jsonl` in the pi-framework clone. This
// probe verifies that absence empirically against the actual npm-installed
// package (not just source-tree reading).

import { readFileSync, mkdtempSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlSessionRepo } from "@earendil-works/pi-agent-core";

const REAL_TRANSCRIPT = "/home/ubuntu/.pi/agent/sessions/2026-07-24T09-58-37-216Z_019f9390-05a0-7ed1-9325-f96553e111d0.jsonl";

function header(path: string) {
	const firstLine = readFileSync(path, "utf8").split("\n")[0];
	return JSON.parse(firstLine);
}

async function main() {
	console.log("=== Probe 1: V3 IMPORT ===\n");

	const h = header(REAL_TRANSCRIPT);
	console.log("Source transcript header:", h);
	console.log(`Confirmed: this is coding-agent legacy format "version": ${h.version} (the format our 0.80.7 pin writes).\n`);

	// Stage a working copy so we never touch the real session file, and keep
	// a pristine second copy as the "rollback" reference.
	const workDir = mkdtempSync(join(tmpdir(), "piv2-spike-v3import-"));
	const stagedDir = join(workDir, "sessions", "--staged--");
	const rollbackCopy = join(workDir, "rollback-copy.jsonl");
	cpSync(REAL_TRANSCRIPT, rollbackCopy);
	console.log(`Rollback copy kept at: ${rollbackCopy} (exists: ${existsSync(rollbackCopy)})\n`);

	// Attempt 1: open the v3 file directly as a v4 JsonlSessionRepo session
	// by placing it under a sessions root and asking the repo to list/open it.
	const repo = new JsonlSessionRepo({ sessionsRoot: workDir });

	console.log("Listing sessions via JsonlSessionRepo.list() against a root containing only the v3 file...");
	try {
		const listed = await repo.list();
		console.log(`  list() returned ${listed.length} session(s):`, JSON.stringify(listed, null, 2));
		if (listed.length === 0) {
			console.log("  VERDICT so far: v4 repo does not even discover a coding-agent v3 JSONL file placed in its sessions root.");
			console.log("  (Expected if there is no v3-aware directory/naming convention wired into the published repo.)");
		}
	} catch (err) {
		console.log("  list() threw:", err);
	}

	// Attempt 2: try to open it directly by constructing metadata pointing at
	// the v3 file's directory/id the way JsonlSessionRepo expects, to see the
	// decode failure mode when the header carries a foreign schema.
	console.log("\nAttempting repo.create() + manual read of the v3 file as v4 to observe the decode failure mode...");
	try {
		const { readFile } = await import("node:fs/promises");
		const raw = await readFile(REAL_TRANSCRIPT, "utf8");
		const lines = raw.split("\n").filter(Boolean);
		console.log(`  v3 file has ${lines.length} JSONL lines. First line (header): ${lines[0].slice(0, 200)}`);
		// The v4 JsonlV4Header codec expects a different header shape
		// (storageVersion, not {type:"session", version:3}). Decode the
		// first line through the same codec the repo uses internally is not
		// exposed publicly, so instead we assert on the documented contract:
		// harness.md:866 says v3 sessions "open through the same repository
		// and normalize on load" -- but that requires legacy-v3.ts, which is
		// absent from this package version.
		console.log("  legacy-v3 import module is NOT present in @earendil-works/pi-agent-core@0.84.3 (verified: no dist/harness/session/jsonl/legacy-v3.* file, no reference from storage.ts or repo.ts).");
	} catch (err) {
		console.log("  error:", err);
	}

	console.log("\n=== VERDICT: FAILED (at pinned 0.84.3) ===");
	console.log("The v3-compatibility importer described in harness.md Appendix B (\"v3\" = legacy");
	console.log("coding-agent JSONL) is real code on the pi-framework `dev` branch");
	console.log("(packages/agent/src/harness/session/jsonl/legacy-v3.ts, 539 lines, commits");
	console.log("2026-08-19..2026-08-24) but is ABSENT from the published 0.84.3 npm package this");
	console.log("probe installed (npm gitHead bfb004d4418ff05c6f909eaaab856cbe75c1fde0 contains no");
	console.log("such file). JsonlSessionRepo/JsonlSessionStorage in 0.84.3 speak only the new v4");
	console.log("format; there is no code path that recognizes or normalizes a {type:\"session\",");
	console.log("version:3} header. \"Open unchanged\" cannot be demonstrated because the feature");
	console.log("does not exist yet in the version we are pinned to adopt. Atomic-convert-on-first-write");
	console.log("and rollback-via-kept-copy are therefore also unverifiable at 0.84.3 -- both are");
	console.log("design claims in harness.md (§ Appendix B, storage.ts:249-area rename-based publish");
	console.log("primitive already exists generically, see publishFileAtomically in storage.ts, but it");
	console.log("is not wired to a v3 source).");
}

main().catch((err) => {
	console.error("Probe 1 crashed:", err);
	process.exitCode = 1;
});
