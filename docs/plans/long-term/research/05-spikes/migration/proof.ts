import { basename, join } from "node:path";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { AgentHarness, Session } from "/home/ubuntu/projects/spike-pi-storage/node_modules/@earendil-works/pi-agent-core/dist/index.js";
import { NodeExecutionEnv } from "/home/ubuntu/projects/spike-pi-storage/node_modules/@earendil-works/pi-agent-core/dist/node.js";
import { createModels } from "/home/ubuntu/projects/spike-pi-storage/node_modules/@earendil-works/pi-ai/dist/index.js";
import { builtinModels } from "/home/ubuntu/projects/spike-pi-storage/node_modules/@earendil-works/pi-ai/dist/providers/all.js";
import { fauxAssistantMessage, fauxProvider } from "/home/ubuntu/projects/spike-pi-storage/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";
import { CanonicalPiSessionStorage, importNativeTranscript, openTargetStore, readNativeTranscript } from "./canonical-session-storage.ts";

const source = process.argv[2] ?? "/home/ubuntu/.pi/agent/sessions/--home-ubuntu-projects-swissinfer--/2026-06-10T08-09-44-475Z_019eb094-871b-76f6-901f-8bbe94901f06.jsonl";
const mode = process.argv[3] ?? "faux";
const outputDir = process.argv[4] ?? join(process.cwd(), ".proof");
await mkdir(outputDir, { recursive: true });
const copiedSource = join(outputDir, basename(source));
await copyFile(source, copiedSource);
const sourceHashBefore = Buffer.from(await readFile(source)).toString("base64");
const transcript = await readNativeTranscript(copiedSource);
const dbPath = join(outputDir, "canonical.sqlite");
const store = openTargetStore(dbPath, { tenantId: "proof-tenant", workspaceId: "proof-workspace" });

const imported = importNativeTranscript(store, transcript);
const storage = CanonicalPiSessionStorage.open(store, transcript.header.id);
const entriesBefore = (await storage.getEntries()).length;
const env = new NodeExecutionEnv({ cwd: process.cwd(), shellEnv: process.env });
let models;
let model;
if (mode === "gemini") {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required for gemini mode");
  models = builtinModels();
  model = models.getModel("google", "gemini-2.5-flash");
  if (!model) throw new Error("google/gemini-2.5-flash missing from pinned catalog");
} else {
  const faux = fauxProvider();
  faux.setResponses([(context) => fauxAssistantMessage(
    `CONTINUED_FROM_IMPORTED_CONTEXT messages=${context.messages.length}`,
  )]);
  models = createModels();
  models.setProvider(faux.provider);
  model = faux.getModel();
}

const harness = new AgentHarness({
  env,
  session: new Session(storage as never),
  models,
  model,
  tools: [],
  thinkingLevel: "off",
  systemPrompt: "This is a migration continuity proof. Reply briefly.",
});
const reply = await harness.prompt("Confirm that this is a continuation of the imported session.");
const text = reply.content.filter((part) => part.type === "text").map((part) => part.text).join("");
const reopened = CanonicalPiSessionStorage.open(store, transcript.header.id);
const entriesAfter = (await reopened.getEntries()).length;
console.log(JSON.stringify({
  source,
  copiedSource,
  mode,
  importedLineCount: imported.importedLineCount,
  originalEntryCount: transcript.entries.length,
  entriesBefore,
  entriesAfter,
  appendedEntries: entriesAfter - entriesBefore,
  leafBefore: imported.leafId,
  leafAfter: await reopened.getLeafId(),
  compactionCount: transcript.entries.filter((entry) => entry.type === "compaction").length,
  reply: text,
  originalUnchanged: Buffer.from(await readFile(source)).toString("base64") === sourceHashBefore,
}));
await env.cleanup();
store.close();
