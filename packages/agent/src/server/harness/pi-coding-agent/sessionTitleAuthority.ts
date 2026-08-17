import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export const USER_SESSION_TITLE_CUSTOM_TYPE = "boring.session-title-authority";

interface UserSessionTitleData {
  titleSetByUser: true;
  title: string;
}

export function userSessionTitleData(title: string): UserSessionTitleData {
  return { titleSetByUser: true, title };
}

/** Returns a user-owned title only for the exact persisted authority marker. */
export function userSessionTitleFromEntry(entry: SessionEntry): string | undefined {
  if (entry.type !== "custom" || entry.customType !== USER_SESSION_TITLE_CUSTOM_TYPE) return undefined;
  const data = entry.data as Partial<UserSessionTitleData> | null | undefined;
  if (data?.titleSetByUser !== true || typeof data.title !== "string") return undefined;
  const title = data.title.replace(/[\r\n]+/g, " ").trim();
  return title || undefined;
}
