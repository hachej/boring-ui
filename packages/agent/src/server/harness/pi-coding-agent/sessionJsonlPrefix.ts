import { open } from "node:fs/promises";
import type { SessionEntry, SessionHeader } from "@mariozechner/pi-coding-agent";

const SUMMARY_PREFIX_BYTES = 64 * 1024;

export async function readJsonlPrefix(filepath: string, maxBytes = SUMMARY_PREFIX_BYTES): Promise<string> {
  const handle = await open(filepath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return completeJsonlPrefix(buffer.subarray(0, bytesRead).toString("utf-8"), bytesRead === maxBytes);
  } finally {
    await handle.close();
  }
}

export function parseJsonlPrefixEntries(content: string): (SessionHeader | SessionEntry)[] {
  const entries: (SessionHeader | SessionEntry)[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Prefix summaries tolerate malformed or truncated tail lines.
    }
  }
  return entries;
}

function completeJsonlPrefix(content: string, reachedLimit: boolean): string {
  if (!reachedLimit) return content;
  const lastNewline = content.lastIndexOf("\n");
  return lastNewline >= 0 ? content.slice(0, lastNewline + 1) : content;
}
