import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BuildBoringSystemPromptOptions {
  /** Workspace visible to the agent. Prefer docs materialized here. */
  workspaceRoot?: string;
}

function resolvePackageDocsPath(): string | null {
  const override = process.env.BORING_DOCS_PATH;
  if (override) return override;

  const candidates = [
    join(__dirname, "docs"),       // dist/docs/ or src/server/docs/
    join(__dirname, "../docs"),    // dist/server.js → packages/workspace/docs/ legacy fallback
    join(__dirname, "../../docs"), // src/server/*.ts → packages/workspace/docs/ legacy fallback
  ];
  return candidates.find(existsSync) ?? null;
}

function resolveWorkspaceDocsPath(workspaceRoot: string | undefined): string | null {
  if (!workspaceRoot) return null;
  const docsPath = join(workspaceRoot, "node_modules", "@hachej", "boring-workspace", "dist", "docs");
  return docsPath;
}

function docFileList(docsPath: string): string {
  return [
    `- Plugin authoring: ${join(docsPath, "plugins.md")}`,
    `- Panel/front APIs: ${join(docsPath, "panels.md")}`,
    `- Agent/UI bridge: ${join(docsPath, "bridge.md")}`,
  ].join("\n");
}

export function buildBoringSystemPrompt(options: BuildBoringSystemPromptOptions = {}): string {
  const workspaceDocsPath = resolveWorkspaceDocsPath(options.workspaceRoot);
  const packageDocsPath = resolvePackageDocsPath();

  const sections = [
    "You are operating inside boring-ui, an open-source workspace for building agent-powered products.",
    "Before you create or edit a boring-ui plugin, you MUST read the `boring-plugin-authoring` skill (its SKILL.md is listed under <available_skills>). The skill is short and contains the minimal plugin template, the imperative `BoringFrontFactory` API, the file-visualizer pattern, and the common-mistakes list. Do not skip it.",
  ];

  if (workspaceDocsPath) {
    sections.push([
      "Reference docs (only needed when SKILL.md is not enough):",
      docFileList(workspaceDocsPath),
    ].join("\n"));
  }

  if (packageDocsPath && packageDocsPath !== workspaceDocsPath) {
    sections.push([
      "Fallback reference docs location:",
      docFileList(packageDocsPath),
    ].join("\n"));
  }

  return sections.join("\n\n");
}
