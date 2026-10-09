export interface TextEdit {
  readonly find: string;
  readonly replace: string;
}

export type TextEditResult = { readonly kind: 'applied'; readonly text: string }
  | { readonly kind: 'rejected'; readonly editIndex: number; readonly reason: string };

export function parseTextEdits(value: unknown): readonly TextEdit[] {
  if (!Array.isArray(value) || !value.length) throw new TypeError('At least one exact text edit is required');
  const edits: readonly unknown[] = value;
  return edits.map(item => {
    if (!item || typeof item !== 'object' || !('find' in item) || !('replace' in item) || typeof item.find !== 'string' || !item.find.length || typeof item.replace !== 'string'
      || Object.keys(item).some(key => key !== 'find' && key !== 'replace')) throw new TypeError('Each text edit requires nonempty find and string replace');
    return { find: item.find, replace: item.replace };
  });
}

/** Each edit sees the preceding edit's result; ambiguous or missing matches refuse the entire transformation. */
export function applyTextEdits(text: string, input: readonly TextEdit[]): TextEditResult {
  if (typeof text !== 'string') throw new TypeError('Expected text');
  const edits = parseTextEdits(input);
  let result = text;
  for (const [editIndex, edit] of edits.entries()) {
    const at = result.indexOf(edit.find);
    if (at < 0) return { kind: 'rejected', editIndex, reason: 'Exact text was not found' };
    if (result.indexOf(edit.find, at + 1) >= 0) return { kind: 'rejected', editIndex, reason: 'Exact text occurs more than once' };
    result = result.slice(0, at) + edit.replace + result.slice(at + edit.find.length);
  }
  if (new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(result)) !== result) return { kind: 'rejected', editIndex: edits.length - 1, reason: 'Result contains invalid Unicode' };
  return { kind: 'applied', text: result };
}
