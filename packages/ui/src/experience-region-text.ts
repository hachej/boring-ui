import type { ExperienceDescriptor } from './experience-compose.js';
import { assertRegionReplacement, experienceRegion } from './experience-region-tree.js';

interface Member { readonly key: string; readonly start: number; readonly valueStart: number; readonly valueEnd: number; readonly end: number }
function membersOfValidatedJson(text: string, start: number): { readonly entries: readonly Member[]; readonly end: number } {
  const whitespace = (index: number): number => { while (/\s/.test(text[index] ?? '') && index < text.length) index++; return index; };
  const stringEnd = (index: number): number => {
    for (index++; index < text.length; index++) {
      if (text[index] === '\\') index++;
      else if (text[index] === '"') return index + 1;
    }
    throw new TypeError('Invalid JSON string');
  };
  const valueEnd = (index: number): number => {
    if (text[index] === '"') return stringEnd(index);
    if (text[index] !== '{' && text[index] !== '[') {
      while (index < text.length && !/[\s,}\]]/.test(text[index] ?? '')) index++;
      return index;
    }
    let depth = 0;
    for (; index < text.length; index++) {
      if (text[index] === '"') { index = stringEnd(index) - 1; continue; }
      if (text[index] === '{' || text[index] === '[') depth++;
      if ((text[index] === '}' || text[index] === ']') && --depth === 0) return index + 1;
    }
    throw new TypeError('Invalid JSON container');
  };
  start = whitespace(start);
  if (text[start] !== '{') throw new TypeError('Expected a JSON object');
  let index = start + 1;
  const entries: Member[] = [], keys = new Set<string>();
  while (text[whitespace(index)] !== '}') {
    const memberStart = index, keyStart = whitespace(index), keyEnd = stringEnd(keyStart);
    const key: unknown = JSON.parse(text.slice(keyStart, keyEnd));
    if (typeof key !== 'string' || keys.has(key)) throw new TypeError('Ambiguous JSON member');
    keys.add(key);
    const colon = whitespace(keyEnd);
    if (text[colon] !== ':') throw new TypeError('Invalid JSON member');
    const begin = whitespace(colon + 1), finish = valueEnd(begin), end = whitespace(finish);
    entries.push({ key, start: memberStart, valueStart: begin, valueEnd: finish, end });
    if (text[end] === '}') return { entries, end: end + 1 };
    if (text[end] !== ',') throw new TypeError('Invalid JSON object');
    index = end + 1;
  }
  return { entries, end: whitespace(index) + 1 };
}

export function replaceRegionText(text: string, base: ExperienceDescriptor, next: ExperienceDescriptor, name: string): string {
  assertRegionReplacement(base, next, name);
  const oldRegion = experienceRegion(base, name), newRegion = experienceRegion(next, name);
  const root = membersOfValidatedJson(text, 0), elementMember = root.entries.find(member => member.key === 'elements');
  if (!elementMember) throw new TypeError('Missing experience elements');
  const elements = membersOfValidatedJson(text, elementMember.valueStart), parts: string[] = [];
  const last = elements.entries.at(-1);
  for (const member of elements.entries) {
    const end = member === last ? member.valueEnd : member.end;
    if (oldRegion.descendants.has(member.key)) continue;
    if (member.key !== oldRegion.id) { parts.push(text.slice(member.start, end)); continue; }
    const region = membersOfValidatedJson(text, member.valueStart), children = region.entries.find(item => item.key === 'children');
    const value = JSON.stringify(newRegion.node.children);
    parts.push(children
      ? text.slice(member.start, children.valueStart) + value + text.slice(children.valueEnd, end)
      : text.slice(member.start, region.end - 1) + `${region.entries.length ? ',' : ''}"children":${value}` + text.slice(region.end - 1, end));
  }
  for (const id of newRegion.descendants) parts.push(`${JSON.stringify(id)}:${JSON.stringify(next.elements[id])}`);
  return text.slice(0, elementMember.valueStart + 1) + parts.join(',') + text.slice(last?.valueEnd ?? elements.end - 1);
}
