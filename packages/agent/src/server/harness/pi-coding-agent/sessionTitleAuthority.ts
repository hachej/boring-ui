import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionEntry, SessionInfoEntry } from "@mariozechner/pi-coding-agent";

export const USER_SESSION_TITLE_CUSTOM_TYPE = "boring.session-title-authority";

interface UserSessionTitleData {
  titleSetByUser: true;
  title: string;
}

export function userSessionTitleData(title: string): UserSessionTitleData {
  return { titleSetByUser: true, title };
}

/**
 * Authority is a physically contiguous parent -> marker -> session_info chain.
 * Partial, stale-branch, and malformed/interleaved appends therefore stay inert.
 */
export function userSessionTitleFromSequence(
  parent: SessionEntry | undefined,
  marker: SessionEntry | undefined,
  titleEntry: SessionEntry | undefined,
): string | undefined {
  if (marker?.type !== "custom" || marker.customType !== USER_SESSION_TITLE_CUSTOM_TYPE) return undefined;
  if (marker.parentId !== (parent?.id ?? null)) return undefined;
  if (titleEntry?.type !== "session_info" || titleEntry.parentId !== marker.id) return undefined;
  const data = marker.data as Partial<UserSessionTitleData> | null | undefined;
  if (data?.titleSetByUser !== true || typeof data.title !== "string") return undefined;
  const title = data.title.replace(/[\r\n]+/g, " ").trim();
  return title && (titleEntry as SessionInfoEntry).name === title ? title : undefined;
}

/** Streams only compact authority records; giant legacy snapshot/message lines are never JSON-parsed. */
export async function summarizeUserSessionTitle(filepath: string): Promise<string | undefined> {
  let parent: SessionEntry | undefined;
  let marker: SessionEntry | undefined;
  let userTitle: string | undefined;
  const lines = createInterface({ input: createReadStream(filepath, { encoding: "utf-8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    const entry = physicalEntry(line);
    if (!entry || entry.type === "session") {
      parent = undefined;
      marker = undefined;
      continue;
    }
    userTitle = userSessionTitleFromSequence(parent, marker, entry) ?? userTitle;
    parent = marker;
    marker = entry;
  }
  return userTitle;
}

function physicalEntry(line: string): SessionEntry | undefined {
  if (!line.trim()) return undefined;
  const type = /^\s*\{\s*"type"\s*:\s*"([^"]+)"/.exec(line)?.[1];
  if (!type) return undefined;
  if (type === "session") return { type: "session" } as SessionEntry;
  if (type === "custom" || type === "session_info") {
    try { return JSON.parse(line) as SessionEntry; } catch { return undefined; }
  }
  const id = /"id"\s*:\s*"([^"\\]+)"/.exec(line)?.[1];
  return id ? { type, id } as SessionEntry : undefined;
}
