// A small, dependency-free tokenizer for the code viewer: comments, strings, numbers and keywords of the languages a workspace holds most
// (TypeScript and JavaScript, Python, shell, JSON). It reads text and returns plain tokens; nothing here is markup, and nothing runs.
export type TokenKind = 'comment' | 'string' | 'number' | 'keyword';
export interface Token { readonly text: string; readonly kind?: TokenKind | undefined }

interface Grammar { readonly pattern: RegExp; readonly keywords: ReadonlySet<string> }

const words = (list: string) => new Set(list.split(' '));
const JS_KEYWORDS = words('as async await break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of private protected public readonly return static super switch this throw true try type typeof undefined var void while yield');
const PY_KEYWORDS = words('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield');
const SH_KEYWORDS = words('case do done elif else esac exit export fi for function if in local return select then until while');
const JSON_KEYWORDS = words('true false null');

// One alternation per language, tried at each position in order: the first group that matches names the token.
const NUMBER = String.raw`\b(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`;
const WORD = String.raw`[A-Za-z_$][\w$]*`;
const grammar = (comment: string, string: string, keywords: ReadonlySet<string>): Grammar => ({ keywords, pattern: new RegExp(`(${comment})|(${string})|(${NUMBER})|(${WORD})`, 'y') });

const JS = grammar(String.raw`\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)`, String.raw`"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|\`(?:\\[\s\S]|[^\`\\])*\`?`, JS_KEYWORDS);
const PY = grammar(String.raw`#[^\n]*`, String.raw`(?:[rbfRBF]{0,2})(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)`, PY_KEYWORDS);
const SH = grammar(String.raw`#[^\n]*`, String.raw`"(?:\\[\s\S]|[^"\\])*"?|'[^']*'?`, SH_KEYWORDS);
const JSON_G = grammar(String.raw`(?!)`, String.raw`"(?:\\.|[^"\\\n])*"?`, JSON_KEYWORDS);

const GRAMMARS: Readonly<Record<string, Grammar>> = Object.assign(Object.create(null), {
  ts: JS, tsx: JS, js: JS, jsx: JS, mjs: JS, cjs: JS, mts: JS, cts: JS,
  py: PY, sh: SH, bash: SH, zsh: SH, json: JSON_G,
});

/** Is this file extension one the viewer colours? */
export const isHighlighted = (language: string | undefined): boolean => language !== undefined && language in GRAMMARS;

/** Files past this size stay plain: colouring is for reading a file, not for a data dump. */
export const HIGHLIGHT_LIMIT = 200_000;

/** The text split into tokens that join back to it exactly. An unknown language, or a text past the limit, is one plain token. */
export function tokenize(text: string, language: string | undefined): readonly Token[] {
  const rules = language !== undefined && language in GRAMMARS ? GRAMMARS[language] : undefined;
  if (!rules || text.length > HIGHLIGHT_LIMIT) return [{ text }];
  const out: Token[] = [];
  let plain = '';
  const flush = () => { if (plain) { out.push({ text: plain }); plain = ''; } };
  let at = 0;
  const { pattern } = rules;
  while (at < text.length) {
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (match && match[0] !== '') {
      const kind: TokenKind | undefined = match[1] !== undefined ? 'comment' : match[2] !== undefined ? 'string' : match[3] !== undefined ? 'number' : rules.keywords.has(match[0]) ? 'keyword' : undefined;
      if (kind) { flush(); out.push({ text: match[0], kind }); } else plain += match[0];
      at += match[0].length;
    } else { plain += text[at]; at += 1; }
  }
  flush();
  return out;
}

/** Tokens grouped by line (a comment or string that spans lines is cut at each break), so a viewer can number and wrap each line itself. */
export function tokenLines(text: string, language: string | undefined): readonly (readonly Token[])[] {
  const lines: Token[][] = [[]];
  for (const token of tokenize(text, language)) {
    token.text.split('\n').forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines.at(-1)!.push({ text: part, kind: token.kind });
    });
  }
  if (lines.length > 1 && lines.at(-1)!.length === 0) lines.pop();
  return lines;
}
