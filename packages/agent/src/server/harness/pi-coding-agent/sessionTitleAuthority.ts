import type { SessionEntry, SessionInfoEntry } from "@mariozechner/pi-coding-agent";

export const USER_SESSION_TITLE_CUSTOM_TYPE = "boring.session-title-authority";
export const MAX_USER_SESSION_TITLE_CHARACTERS = 200;

interface UserSessionTitleData {
  titleSetByUser: true;
  title: string;
}

export interface PhysicalSessionEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  customType?: string;
  data?: unknown;
  name?: unknown;
}

export function normalizeUserSessionTitle(title: string): string {
  const normalized = title.replace(/[\r\n]+/g, " ").trim();
  if (!normalized) throw new Error("Session title must not be empty");
  if (normalized.length > MAX_USER_SESSION_TITLE_CHARACTERS) {
    throw new Error(`Session title must be at most ${MAX_USER_SESSION_TITLE_CHARACTERS} characters`);
  }
  return normalized;
}

export function userSessionTitleData(title: string): UserSessionTitleData {
  return { titleSetByUser: true, title };
}

/**
 * Authority is one physically contiguous predecessor -> marker -> session_info
 * chain. Partial, stale-branch, malformed, and interleaved appends stay inert.
 */
export function isAttachedUserSessionTitleMarker(
  parent: PhysicalSessionEntry | undefined,
  marker: PhysicalSessionEntry | undefined,
): boolean {
  if (marker?.type !== "custom" || typeof marker.id !== "string" || !marker.id
    || marker.customType !== USER_SESSION_TITLE_CUSTOM_TYPE) return false;
  if (parent && (typeof parent.id !== "string" || !parent.id)) return false;
  return marker.parentId === (parent?.id ?? null);
}

export function userSessionTitleFromSequence(
  parent: PhysicalSessionEntry | undefined,
  marker: PhysicalSessionEntry | undefined,
  titleEntry: PhysicalSessionEntry | undefined,
): string | undefined {
  if (!isAttachedUserSessionTitleMarker(parent, marker)) return undefined;
  if (titleEntry?.type !== "session_info" || typeof titleEntry.id !== "string" || !titleEntry.id
    || titleEntry.parentId !== marker?.id) return undefined;
  if (parent?.id === marker?.id || parent?.id === titleEntry.id || marker?.id === titleEntry.id) return undefined;
  const data = marker?.data as Partial<UserSessionTitleData> | null | undefined;
  if (data?.titleSetByUser !== true || typeof data.title !== "string") return undefined;
  try {
    const title = normalizeUserSessionTitle(data.title);
    return titleEntry.name === title ? title : undefined;
  } catch {
    return undefined;
  }
}

export interface UserSessionTitleProjection {
  readonly title: string | undefined;
  readonly timestamp: string | undefined;
  accept(entry: PhysicalSessionEntry): void;
  breakSequence(): void;
}

/** Canonical physical-record projection shared by file and in-memory readers. */
export function createUserSessionTitleProjection(): UserSessionTitleProjection {
  let parent: PhysicalSessionEntry | undefined;
  let marker: PhysicalSessionEntry | undefined;
  let previousKnown = false;
  let markerPredecessorKnown = false;
  let title: string | undefined;
  let timestamp: string | undefined;
  const reset = (predecessorKnown: boolean) => {
    parent = undefined;
    marker = undefined;
    previousKnown = predecessorKnown;
    markerPredecessorKnown = false;
  };
  return {
    get title() { return title; },
    get timestamp() { return timestamp; },
    accept(entry) {
      if (entry.type === "session" || entry.type === "pi_session_file") {
        reset(true);
        return;
      }
      const projected = markerPredecessorKnown
        ? userSessionTitleFromSequence(parent, marker, entry)
        : undefined;
      if (projected) {
        title = projected;
        timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
      }
      parent = marker;
      marker = entry;
      markerPredecessorKnown = previousKnown;
      previousKnown = true;
    },
    breakSequence() {
      reset(false);
    },
  };
}

export function createUserSessionTitleEntries(input: {
  title: string;
  parentId: string | null;
  timestamp: string;
  authorityId: string;
  titleId: string;
}): { authority: SessionEntry; title: SessionInfoEntry } {
  const authority: SessionEntry = {
    type: "custom",
    id: input.authorityId,
    parentId: input.parentId,
    timestamp: input.timestamp,
    customType: USER_SESSION_TITLE_CUSTOM_TYPE,
    data: userSessionTitleData(input.title),
  };
  return {
    authority,
    title: {
      type: "session_info",
      id: input.titleId,
      parentId: input.authorityId,
      timestamp: input.timestamp,
      name: input.title,
    },
  };
}
