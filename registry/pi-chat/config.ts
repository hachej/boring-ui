import type { BlockAction } from '../button/actions';

/*
 * Composer features the host switches on by configuration. Each prop is optional: leave it out and the composer has
 * no menu, no button and no keyboard trigger for it. The current model and thinking level are read from the native
 * view's `pi.agent` document, so there is no extra state to keep in sync.
 */

/** Where a `/` menu entry comes from. Skills and host commands are grouped separately in the menu. */
export type SlashSource = 'local' | 'extension' | 'prompt' | 'skill';

export interface SlashApi {
  /** Replace the composer text. */
  readonly setText: (text: string) => void;
  /** The composer text with the typed `/query` already removed. */
  readonly text: string;
}
export interface SlashCommand {
  readonly name: string;
  readonly description?: string;
  /** Shown as a badge and as a filter chip; commands without one are grouped as `built-in`. */
  readonly sourcePlugin?: string;
  readonly run: (api: SlashApi) => void | Promise<void>;
}
export interface SlashSkill {
  readonly name: string;
  readonly description: string;
  readonly sourcePlugin?: string;
}
export interface SlashConfig {
  readonly commands?: readonly SlashCommand[];
  readonly skills?: readonly SlashSkill[];
}

export interface MentionResult { readonly path: string; readonly kind?: 'file' | 'directory' }
export interface MentionsConfig {
  /** Workspace search for the `@` picker. Empty `query` asks for a default listing. Abort `signal` when the query changes. */
  readonly search: (query: string, signal: AbortSignal) => Promise<readonly MentionResult[]>;
  /** Open a mentioned workspace file (for example in the right panel). When given, a mention in a sent message is a button. */
  readonly open?: ((path: string) => void) | undefined;
}

export interface UploadResult {
  /** The host saved the file in the workspace: it becomes an `@path` mention. */
  readonly path?: string;
  /** Sent as a native image attachment. */
  readonly image?: { readonly data: string; readonly mimeType: string };
  readonly name: string;
}
export interface AttachmentsConfig {
  /** The file input's `accept`. Any file when omitted. */
  readonly accept?: string;
  readonly upload: (files: File[], signal: AbortSignal) => Promise<readonly UploadResult[]>;
}

/** One past conversation in the history list. `title` is its name or first message; `updatedAt` is when it last had activity. */
export interface ConversationItem {
  readonly id: string;
  readonly title?: string | undefined;
  readonly updatedAt?: number | string | Date | undefined;
  /** A preview of the last message (the row's tooltip). */
  readonly lastMessage?: string | null | undefined;
  readonly archived?: boolean | undefined;
}
/** The host's conversations. Give it to `PiChat` and the header's History button opens a list of them instead of the earlier records of this one. */
export interface ConversationsConfig {
  readonly items: readonly ConversationItem[];
  /** The conversation that is open; it is marked in the list. */
  readonly activeId?: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onNew?: (() => void) | undefined;
  readonly loading?: boolean | undefined;
  /**
   * Server-side search: with it, a typed query (or the Archived filter) lists what this returns instead of filtering `items`
   * by title. Abort `signal` when the query changes.
   */
  readonly search?: ((query: string, options: { readonly archived: boolean }, signal: AbortSignal) => Promise<readonly ConversationItem[]>) | undefined;
  /** Each action below adds its button to the rows; the host refreshes `items` when it resolves. */
  readonly rename?: ((id: string, title: string) => Promise<void>) | undefined;
  /** Archive (`true`) or restore (`false`). With it, the list also offers an Archived filter (which needs `search`). */
  readonly archive?: ((id: string, archived: boolean) => Promise<void>) | undefined;
  readonly remove?: ((id: string) => Promise<void>) | undefined;
  /** Fork the open conversation after the entry of a settled reply: the reply's Fork button. */
  readonly fork?: ((atEntryId: string) => Promise<void>) | undefined;
  /**
   * Host actions on each row, after rename, archive and delete: `header` ones as buttons, `menu` ones in a "…" menu. Test ids
   * `conversation-action-<id>`, the menu `conversation-action-more`.
   */
  readonly rowActions?: ((item: ConversationItem) => readonly BlockAction[]) | undefined;
}

/** A settled reply, as host message actions receive it: its row key, its text and the native entry it ends with. */
export interface ReplyRef { readonly key: string; readonly text: string; readonly entryId?: string | undefined }

export interface ModelRef { readonly provider: string; readonly modelId: string }
export interface ModelConfig {
  readonly options: readonly (ModelRef & { readonly label?: string })[];
  /** Reject to refuse: the message is shown inline. */
  readonly change: (model: ModelRef) => Promise<void>;
}
export interface EffortConfig {
  readonly options: readonly string[];
  readonly change: (level: string) => Promise<void>;
}

/** The unified, internal menu entry. */
export interface SlashItem {
  readonly name: string;
  readonly description: string;
  readonly source: SlashSource;
  readonly sourcePlugin?: string;
}

export function slashItems(config: SlashConfig): SlashItem[] {
  return [
    ...(config.commands ?? []).map((command): SlashItem => ({ name: command.name, description: command.description ?? '', source: 'local', ...(command.sourcePlugin ? { sourcePlugin: command.sourcePlugin } : {}) })),
    ...(config.skills ?? []).map((skill): SlashItem => ({ name: skill.name, description: skill.description, source: 'skill', ...(skill.sourcePlugin ? { sourcePlugin: skill.sourcePlugin } : {}) })),
  ];
}

/** The group an item lives under in the filter chips: skills, its plugin, or `built-in`. */
export function slashGroup(item: Pick<SlashItem, 'source' | 'sourcePlugin'>): string {
  if (item.source === 'skill') return 'skills';
  return item.sourcePlugin || 'built-in';
}

/** `/` opens the menu only when the text before the caret is one `/token`, as in v2. */
export function slashQuery(text: string, caret: number): string | null {
  const match = /^\/(\S*)$/.exec(text.slice(0, caret));
  return match ? match[1]! : null;
}

export interface MentionTrigger { readonly query: string; readonly start: number; readonly end: number }
/** An `@` at the start or after whitespace, up to the caret. */
export function mentionTrigger(text: string, caret: number): MentionTrigger | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@(\S*)$/.exec(before);
  // A typed opening quote (`@"Meeting`) is not part of the search; the token starts at the `@` either way.
  return match ? { query: match[2]!.replace(/^"/, ''), start: before.length - match[2]!.length - 1, end: caret } : null;
}

/**
 * The text of a mention of `path`. A path with whitespace or a quote is written in double quotes, `@"docs/Meeting notes.md"`, with `\`
 * and `"` escaped, because a bare mention ends at a space. Any other path stays bare (`@docs/plan.md`), as it always was.
 */
export function mentionToken(path: string): string {
  return /[\s"]/.test(path) ? `@"${path.replace(/[\\"]/g, '\\$&')}"` : `@${path}`;
}
/**
 * The `@` tokens of a message, bare or quoted: group 1 is the character before the `@` (or the start), group 2 the quoted body (escapes
 * still in it), group 3 the bare path. `test/contracts/pi-chat-source.test.mjs` keeps `mentionedPaths` in the agent package equal to this.
 */
export const MENTION_TOKEN = /(^|\s)@(?:"((?:[^"\\]|\\.)*)"|([^\s]+))/g;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BOUNDARY = '[^A-Za-z0-9_./-]';
export function hasMention(text: string, path: string): boolean {
  return new RegExp(`(^|${BOUNDARY})${escape(mentionToken(path))}($|${BOUNDARY})`).test(text);
}
export function removeMention(text: string, path: string): string {
  return text.replace(new RegExp(`(^|${BOUNDARY})${escape(mentionToken(path))}(?=$|${BOUNDARY})[ ]?`), '$1').replace(/^[ ]+/, '');
}

export type Piece = { readonly text: string; readonly kind?: 'mention' | 'skill'; readonly value?: string };
/** Split a sent message into plain text, `@path` mentions and a leading `/skill` token. */
export function pieces(text: string, options: { readonly mentions: boolean; readonly skills: readonly string[] }): Piece[] {
  const found: { start: number; end: number; kind: 'mention' | 'skill'; value: string }[] = [];
  const skill = options.skills.length ? new RegExp(`^/(${options.skills.map(escape).join('|')})(?=\\s|$)`).exec(text) : null;
  if (skill) found.push({ start: 0, end: skill[0].length, kind: 'skill', value: skill[1]! });
  if (options.mentions) {
    for (const match of text.matchAll(MENTION_TOKEN)) {
      // A quoted path keeps its punctuation (the closing quote ends it); a bare one drops trailing punctuation, as a sentence would.
      const quoted = match[2] !== undefined;
      const path = quoted ? match[2]!.replace(/\\(.)/g, '$1') : match[3]!.replace(/[.,;:!?)\]}'"]+$/, '');
      if (!path) continue;
      const start = match.index! + match[1]!.length;
      const end = quoted ? match.index! + match[0].length : start + 1 + path.length;
      found.push({ start, end, kind: 'mention', value: path });
    }
  }
  const out: Piece[] = [];
  let cursor = 0;
  for (const item of found.sort((a, b) => a.start - b.start)) {
    if (item.start < cursor) continue;
    if (item.start > cursor) out.push({ text: text.slice(cursor, item.start) });
    out.push({ text: text.slice(item.start, item.end), kind: item.kind, value: item.value });
    cursor = item.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}
