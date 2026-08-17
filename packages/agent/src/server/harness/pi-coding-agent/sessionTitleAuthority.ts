import type { SessionEntry, SessionInfoEntry } from "@mariozechner/pi-coding-agent";

export const USER_SESSION_TITLE_CUSTOM_TYPE = "boring.session-title-authority";

interface UserSessionTitleData {
  titleSetByUser: true;
  title: string;
}

export interface UserSessionTitleAuthority {
  title: string;
  timestamp: string;
}

export function userSessionTitleData(title: string): UserSessionTitleData {
  return { titleSetByUser: true, title };
}

/**
 * A marker becomes authoritative only when the immediately following record is
 * its matching session_info child. This keeps interrupted/contended partial
 * appends inert while leaving native Pi's session name readable.
 */
export function userSessionTitleFromPair(
  marker: SessionEntry | undefined,
  titleEntry: SessionEntry | undefined,
): UserSessionTitleAuthority | undefined {
  if (marker?.type !== "custom" || marker.customType !== USER_SESSION_TITLE_CUSTOM_TYPE) return undefined;
  if (titleEntry?.type !== "session_info" || titleEntry.parentId !== marker.id) return undefined;
  const data = marker.data as Partial<UserSessionTitleData> | null | undefined;
  if (data?.titleSetByUser !== true || typeof data.title !== "string") return undefined;
  const title = data.title.replace(/[\r\n]+/g, " ").trim();
  if (!title || (titleEntry as SessionInfoEntry).name !== title) return undefined;
  return { title, timestamp: marker.timestamp };
}

export function latestUserSessionTitle(entries: SessionEntry[]): UserSessionTitleAuthority | undefined {
  let latest: UserSessionTitleAuthority | undefined;
  for (let index = 1; index < entries.length; index += 1) {
    latest = userSessionTitleFromPair(entries[index - 1], entries[index]) ?? latest;
  }
  return latest;
}
