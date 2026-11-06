/**
 * The `<target>` block (point-and-speak) as the kit writes it: `<target>{JSON object, at most 1024 bytes}</target>`, a blank line, then what
 * the person said. This is the one stripper packages/agent uses (conversation titles and previews, struggle detection). It repeats the kit's
 * `withoutTarget` (`@hachej/boring-ui-kit/chat-view`) because this package has only a type edge to ui; `test/packages/target-grammar.test.mjs`
 * runs one table through both. A block that is not valid by that rule is plain text.
 */
export function withoutTarget(text: string): string {
  if (!text.startsWith('<target>')) return text;
  const end = text.indexOf('</target>');
  if (end < 0 || text.slice(end + 9, end + 11) !== '\n\n') return text;
  const json = text.slice(8, end);
  if (new TextEncoder().encode(json).length > 1024) return text;
  try {
    const target: unknown = JSON.parse(json);
    if (target === null || typeof target !== 'object' || Array.isArray(target)) return text;
  } catch { return text; }
  return text.slice(end + 11);
}
