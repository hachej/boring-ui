import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Candidates ordered by likelihood: dist layout first (flat file in dist/),
// then src layout (src/server/ subdirectory), then env var override.
// tsup outputs dist/server.js (not dist/server/boringSystemPrompt.js), so
// __dirname in dist is packages/workspace/dist/, one level above docs/.
function resolveDocsPath(): string | null {
  const override = process.env.BORING_DOCS_PATH;
  if (override) return override;

  const candidates = [
    join(__dirname, "../docs"),   // dist/server.js → packages/workspace/docs/
    join(__dirname, "../../docs"), // src/server/*.ts → packages/workspace/docs/
  ];
  return candidates.find(existsSync) ?? null;
}

function readDocOrFallback(docsPath: string, name: string): string {
  const file = join(docsPath, name);
  try {
    return existsSync(file) ? readFileSync(file, "utf-8").trim() : "";
  } catch {
    return "";
  }
}

export function buildBoringSystemPrompt(): string {
  const docsPath = resolveDocsPath();

  const intro = `You are an expert agent operating inside boring-ui, an open-source workspace for building agent-powered products. You help users by reading files, executing commands, editing code, and opening workspace panels.`;

  if (!docsPath) {
    return intro;
  }

  // Inline doc content so the prompt works even when the agent runs in an
  // isolated environment (e.g. Vercel sandbox) without access to the host FS.
  const plugins = readDocOrFallback(docsPath, "plugins.md");
  const panels = readDocOrFallback(docsPath, "panels.md");
  const bridge = readDocOrFallback(docsPath, "bridge.md");

  const sections = [
    plugins && `<boring-ui-docs topic="plugin-system">\n${plugins}\n</boring-ui-docs>`,
    panels && `<boring-ui-docs topic="panel-components">\n${panels}\n</boring-ui-docs>`,
    bridge && `<boring-ui-docs topic="ui-bridge">\n${bridge}\n</boring-ui-docs>`,
  ].filter(Boolean);

  return [intro, ...sections].join("\n\n");
}
