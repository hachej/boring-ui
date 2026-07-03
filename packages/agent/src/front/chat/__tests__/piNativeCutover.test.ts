import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const CHAT_SOURCE_ROOT = join(process.cwd(), "src/front/chat");

describe("Pi-native chat cutover invariants", () => {
  test("production chat source does not reintroduce legacy AI SDK or browser transcript owners", () => {
    const matches = chatSourceFiles().flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const violations: string[] = [];
      if (source.includes("@ai-sdk/react")) violations.push("@ai-sdk/react");
      if (/\buseChat\s*\(/.test(source)) violations.push("useChat(");
      if (source.includes("boring-ui:chat-sessions:v1"))
        violations.push("boring-ui:chat-sessions:v1");
      return violations.map(
        (violation) => `${relative(process.cwd(), file)}: ${violation}`,
      );
    });

    expect(matches).toEqual([]);
  });
});

function chatSourceFiles(): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        if (entry === "__tests__") continue;
        visit(path);
        continue;
      }
      if (/\.[cm]?[tj]sx?$/.test(entry)) files.push(path);
    }
  };

  visit(CHAT_SOURCE_ROOT);
  return files;
}
