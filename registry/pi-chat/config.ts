import type { ReactNode } from 'react';
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

export interface MentionResult { readonly path: string; readonly kind?: 'file' | 'directory'; readonly label?: string }
export interface MentionsConfig {
  /** Accessible name and optional option/media presentation for a host catalog. */
  readonly listLabel?: string;
  readonly icon?: ReactNode;
  readonly renderOption?: (item: MentionResult, query: string) => ReactNode;
  readonly label?: (id: string) => string;
  /** Workspace search for the `@` picker. Empty `query` asks for a default listing. Abort `signal` when the query changes. */
  readonly search: (query: string, signal: AbortSignal) => Promise<readonly MentionResult[]>;
  /** Open a mentioned workspace file (for example in the right panel). When given, a mention in a sent message is a button. */
  readonly open?: ((path: string) => void) | undefined;
  /** Changes whenever what `search` would return may have changed (a workspace change event, another workspace). An open picker searches again. */
  readonly generation?: string | number | undefined;
  /** Host-supplied look for a mention in a sent message (a plug-in such as feedback). Return undefined to keep the default mention. */
  readonly render?: ((path: string) => ReactNode | undefined) | undefined;
  /** Sent-message rendering, independent of the composer's token presentation. */
  readonly renderSent?: ((path: string) => ReactNode | undefined) | undefined;
  /**
   * The bytes of an image upload, for its card's thumbnail: the host reads them through its own provider. Absent: the card shows its icon.
   * Only png, jpeg, gif and webp are shown (`thumbnail`); anything else, or a refusal, leaves the icon.
   */
  readonly preview?: PreviewRead | undefined;
}
/** Reads an image upload for its card's thumbnail: its media type and base64 data, or undefined. */
export type PreviewRead = (path: string, signal: AbortSignal) => Promise<{ readonly mimeType: string; readonly data: string } | undefined>;

/** Paste-to-file thresholds: a paste with more characters or more lines than these becomes a file. Defaults 2000 and 40. */
export interface PasteToFile { readonly minChars?: number | undefined; readonly minLines?: number | undefined }
/** A paste the composer took, with the textarea range it replaces (restored if the upload is cancelled). */
export interface PastedText { readonly text: string; readonly start: number; readonly end: number }

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
export interface ReplyRef {
  readonly key: string; readonly text: string; readonly entryId?: string | undefined;
  /** When the last model round of the reply was written (ms), the same value as its message's `timestamp`: a host keys its own per-reply data on it. */
  readonly timestamp?: number | undefined;
  /** The model that wrote the last round of the reply, as its message names it (`provider` and `model` ids). */
  readonly model?: { readonly provider: string; readonly modelId: string } | undefined;
  /**
   * Sum of the model rounds that form the reply (ms): Pi's own `AssistantMessage.durationMs`, measured monotonically
   * and kept in the transcript. It excludes queue time, tool runs and retry delays, and is absent for a message written
   * before Pi recorded it. It is never computed from the clock at render time.
   */
  readonly durationMs?: number | undefined;
}

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

/** Upload paths are `uploads/<name>`: the attachments of a message, shown as cards rather than as text. */
export const isUploadPath = (path: string): boolean => path.startsWith('uploads/');

export type FileKind = 'document' | 'image' | 'pdf' | 'sheet' | 'slides' | 'file';
const KIND_BY_EXTENSION: Readonly<Record<string, FileKind>> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', avif: 'image',
  pdf: 'pdf',
  csv: 'sheet', tsv: 'sheet', xls: 'sheet', xlsx: 'sheet', xlsm: 'sheet', ods: 'sheet', numbers: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  md: 'document', markdown: 'document', txt: 'document', doc: 'document', docx: 'document', odt: 'document', rtf: 'document',
};
/** The card's kind, from the extension alone. */
export function fileKind(path: string): FileKind {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
  return KIND_BY_EXTENSION[extension] ?? 'file';
}
/** The name a card shows: the upload's file name without the random suffix `uploadPath` adds (`report-1a2b3c4d.pdf` is `report.pdf`). */
export function displayName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.replace(/-[0-9a-f]{8}(?=\.[^.]*$|$)/i, '');
}

/**
 * The pieces a message shows once `hidden` ones are taken out: a space that a removed piece leaves at a join is dropped, and the ends are
 * trimmed where it was. The message's own text is not changed, only what the bubble draws.
 */
export function visibleParts(parts: readonly Piece[], hidden: (part: Piece) => boolean): Piece[] {
  const out: Piece[] = [];
  let gap = false;
  for (const part of parts) {
    if (hidden(part)) { gap = true; continue; }
    const prev = out[out.length - 1];
    const joins = gap && part.kind === undefined && (prev === undefined || (prev.kind === undefined && /\s$/.test(prev.text)));
    out.push(joins ? { text: part.text.replace(/^\s+/, '') } : part);
    gap = false;
  }
  const last = out[out.length - 1];
  if (gap && last && last.kind === undefined) out[out.length - 1] = { text: last.text.replace(/\s+$/, '') };
  return out.filter(part => part.kind !== undefined || part.text !== '');
}

/** Whether pasted text is long enough to become a file. `more` than the limits: the characters, or the lines, of the text. */
export function isLongPaste(text: string, limits: PasteToFile = {}): boolean {
  const { minChars = 2000, minLines = 40 } = limits;
  return text.length > minChars || text.split('\n').length > minLines;
}
/** Markdown in pasted text: a heading, a list or quote item, a fence, a table row, emphasis or a link. Anything else is plain text. */
export function looksLikeMarkdown(text: string): boolean {
  return /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|~~~)/m.test(text) || /\*\*[^*\n]+\*\*|\]\([^)\n]+\)|^\|.*\|\s*$/m.test(text);
}
/** Split a sent message into plain text, `@path` mentions and a leading `/skill` token. */
export function pieces(text: string, options: { readonly mentions: boolean; readonly skills: readonly string[]; readonly uploads?: boolean }): Piece[] {
  const found: { start: number; end: number; kind: 'mention' | 'skill'; value: string }[] = [];
  const skill = options.skills.length ? new RegExp(`^/(${options.skills.map(escape).join('|')})(?=\\s|$)`).exec(text) : null;
  if (skill) found.push({ start: 0, end: skill[0].length, kind: 'skill', value: skill[1]! });
  if (options.mentions || options.uploads) {
    for (const match of text.matchAll(MENTION_TOKEN)) {
      // A quoted path keeps its punctuation (the closing quote ends it); a bare one drops trailing punctuation, as a sentence would.
      const quoted = match[2] !== undefined;
      const path = quoted ? match[2]!.replace(/\\(.)/g, '$1') : match[3]!.replace(/[.,;:!?)\]}'"]+$/, '');
      if (!path || (!options.mentions && !isUploadPath(path))) continue;
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
