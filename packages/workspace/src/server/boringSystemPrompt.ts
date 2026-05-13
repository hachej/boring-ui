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
    "When the user asks you to create or update a boring-ui plugin, read the boring-ui documentation before writing code.",
  ];

  if (workspaceDocsPath) {
    sections.push([
      "Preferred boring-ui docs location visible inside this workspace:",
      docFileList(workspaceDocsPath),
    ].join("\n"));
  }

  if (packageDocsPath && packageDocsPath !== workspaceDocsPath) {
    sections.push([
      "Fallback boring-ui package docs location:",
      docFileList(packageDocsPath),
    ].join("\n"));
  }

  sections.push([
    "Minimum plugin rules if docs are temporarily unavailable:",
    "- Use the unified front API: BoringFrontFactory from @hachej/boring-workspace/plugin.",
    "- Plugin roots use package.json plus optional front/index.tsx, agent/index.ts, server/index.ts, shared/.",
    "- Native agent plugins are Pi extensions loaded from file paths; do not pass imported extension factories for hot reload.",
    "- After changing plugin agent files, tell the user to run /reload, which calls POST /api/v1/agent/reload.",
  ].join("\n"));

  return sections.join("\n\n");
}
