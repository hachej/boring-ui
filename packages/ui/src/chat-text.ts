/**
 * Optional chat text rules: the grammar of what a person types and what a message shows. Pure string functions; no React, files, agent
 * or controller runtime. Registry items (pi-chat, pi-chat-slash, pi-chat-markdown, pi-chat-voice, shared-chat, ...) call these and keep
 * no copy, so a composer, a bubble and the shared chat agree on one `@mention` syntax.
 */

/** Where a `/` menu entry comes from. Skills and host commands are grouped separately in the menu. */
export type SlashSource = 'local' | 'extension' | 'prompt' | 'skill';
/** The unified `/` menu entry. */
export interface SlashItem {
  readonly name: string;
  readonly description: string;
  readonly source: SlashSource;
  readonly sourcePlugin?: string;
}
/** The commands and skills a `/` menu lists (the item's `SlashConfig` is assignable to it). */
export interface SlashEntries {
  readonly commands?: readonly { readonly name: string; readonly description?: string | undefined; readonly sourcePlugin?: string | undefined }[] | undefined;
  readonly skills?: readonly { readonly name: string; readonly description: string; readonly sourcePlugin?: string | undefined }[] | undefined;
}

/** The `/` menu entries: host commands first, then skills. */
export function slashItems(config: SlashEntries): SlashItem[] {
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
 * The text of a mention of `path` (a workspace path or a shared-chat member id). A value with whitespace, a quote or a backslash is
 * written in double quotes, `@"docs/Meeting notes.md"`, with `\` and `"` escaped, because a bare mention ends at a space and a bare `\`
 * is not an escape. Any other value stays bare (`@docs/plan.md`).
 */
export function mentionToken(path: string): string {
  return /[\s"\\]/.test(path) ? `@"${path.replace(/[\\"]/g, '\\$&')}"` : `@${path}`;
}
/**
 * The `@` tokens of a message, bare or quoted: group 1 is the character before the `@` (or the start), group 2 the quoted body (escapes
 * still in it), group 3 the bare path. `mentionedPaths` of `@hachej/boring-agent/mentions` parses the same syntax (a contract test keeps
 * them equal).
 */
export const MENTION_TOKEN = /(^|\s)@(?:"((?:[^"\\]|\\.)*)"|([^\s]+))/g;

/** The value of one `MENTION_TOKEN` match: a quoted body unescaped, a bare one without trailing sentence punctuation. */
const mentionValue = (match: RegExpMatchArray): string =>
  match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3]!.replace(/[.,;:!?)\]}'"]+$/, '');

/** The distinct values a message mentions, in order. The same result as the agent's `mentionedPaths`. */
export function mentionedPaths(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const value = mentionValue(match);
    if (value) found.add(value);
  }
  return [...found];
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BOUNDARY = '[^A-Za-z0-9_./-]';
/** Whether the draft already holds a mention of `path`. */
export function hasMention(text: string, path: string): boolean {
  return new RegExp(`(^|${BOUNDARY})${escape(mentionToken(path))}($|${BOUNDARY})`).test(text);
}
/** The draft without its mention of `path` (and the space after it). */
export function removeMention(text: string, path: string): string {
  return text.replace(new RegExp(`(^|${BOUNDARY})${escape(mentionToken(path))}(?=$|${BOUNDARY})[ ]?`), '$1').replace(/^[ ]+/, '');
}

/**
 * The draft with `text` added at its end: a space between them unless the draft is empty or already ends in whitespace. Dictation,
 * voice transcripts, picked mentions and app targets all append this way.
 */
export function appendToDraft(draft: string, text: string): string {
  return `${draft}${draft === '' || /\s$/.test(draft) ? '' : ' '}${text}`;
}
/** The draft with `text` put back before it on its own line (a refused or withdrawn message); whitespace-only parts are dropped. */
export function prependToDraft(draft: string, text: string): string {
  return [text, draft].filter(value => value.trim()).join('\n');
}

export type Piece = { readonly text: string; readonly kind?: 'mention' | 'skill'; readonly value?: string };

/** Upload paths are `uploads/<name>`: the attachments of a message, shown as cards rather than as text. */
export const isUploadPath = (path: string): boolean => path.startsWith('uploads/');

export type FileKind = 'document' | 'image' | 'pdf' | 'sheet' | 'slides' | 'audio' | 'file';
const KIND_BY_EXTENSION: Readonly<Record<string, FileKind>> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', avif: 'image',
  pdf: 'pdf',
  webm: 'audio', ogg: 'audio', m4a: 'audio', mp4: 'audio', mp3: 'audio', wav: 'audio',
  csv: 'sheet', tsv: 'sheet', xls: 'sheet', xlsx: 'sheet', xlsm: 'sheet', ods: 'sheet', numbers: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  md: 'document', markdown: 'document', txt: 'document', doc: 'document', docx: 'document', odt: 'document', rtf: 'document',
};
/** The card's kind, from the extension alone. */
export function fileKind(path: string): FileKind {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
  return KIND_BY_EXTENSION[extension] ?? 'file';
}
/** Recorded voice uses a reserved upload filename prefix; other audio remains a plain file card. */
export const isVoicePath = (path: string): boolean => /^uploads\/voice-[^/]+$/.test(path) && fileKind(path) === 'audio';

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

/** Paste-to-file thresholds: a paste with more characters or more lines than these becomes a file. Defaults 2000 and 40. */
export interface PasteToFile { readonly minChars?: number | undefined; readonly minLines?: number | undefined }
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
      const path = mentionValue(match);
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
