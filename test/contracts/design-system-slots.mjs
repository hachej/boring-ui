// What a design-system demo must really render. A demo marks the exports it shows (data-ds-component="Button Badge"); the kit's components stamp their
// own output with data-slot, so an export that was only named on the page (a label, a listing) shows no slot. This reads the expected slots from the
// shadcn/ui sources and compares them with the slots found inside each marked demo. Used by the node test (fail-first on a fake page) and the Chromium test.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** Roots that draw no element of their own: they pass for any slot of their file's family (`dialog-content` for Dialog). */
export const ROOTS = new Set([
  'Dialog', 'DialogPortal', 'Sheet', 'Drawer', 'DrawerPortal', 'DropdownMenu', 'DropdownMenuPortal', 'DropdownMenuSub', 'Popover', 'Tooltip', 'TooltipProvider',
  'Select', 'MessageScrollerProvider', 'AlertDialog', 'AlertDialogPortal',
]);
/** Parts that exist only in a state this static page does not show; each has a reason. */
export const CONDITIONAL = {
  AvatarImage: 'renders only once its image has loaded',
  DrawerOverlay: 'the drawer is not modal here (a modal drawer is a Sheet-like overlay over the whole page)',
  SelectScrollUpButton: 'drawn only when the list scrolls',
  SelectScrollDownButton: 'drawn only when the list scrolls',
  ScrollBar: 'drawn only while the content overflows and is hovered',
};
/** Exports whose component has no data-slot of its own (a styled span, or a Button with the inline-addon sizes): nothing to assert beyond being rendered. */
export const NO_SLOT = new Set(['InputGroupText', 'InputGroupButton']);
const EXTRA = { Toaster: ['sonner-toaster'] };
const family = file => file.replace(/\.tsx$/, '');

function declarations(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map();
  for (const node of tree.statements) {
    if (ts.isFunctionDeclaration(node) && node.name) found.set(node.name.text, node.getText());
    if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations) if (ts.isIdentifier(item.name) && item.initializer) found.set(item.name.text, item.getText());
  }
  return found;
}

const slotsIn = text => [...text.matchAll(/data-slot=["']([\w-]+)["']|\bslot:\s*["']([\w-]+)["']/g)].map(match => match[1] ?? match[2]);

/** Map of export name -> { file, slots: Set } for every capitalised export of shadcn/ui/*.tsx; slots include those of same-file components it wraps. */
export function slotExpectations(root) {
  const result = new Map();
  for (const file of readdirSync(join(root, 'shadcn/ui')).filter(name => name.endsWith('.tsx'))) {
    const source = readFileSync(join(root, 'shadcn/ui', file), 'utf8');
    const declared = declarations(source, file);
    const collect = (name, seen = new Set()) => {
      if (seen.has(name) || !declared.has(name)) return [];
      seen.add(name);
      const text = declared.get(name);
      const wrapped = [...text.matchAll(/<([A-Z]\w*)|\b([A-Z]\w*)\(/g)].map(match => match[1] ?? match[2]).filter(other => other !== name);
      return [...slotsIn(text), ...wrapped.flatMap(other => collect(other, seen))];
    };
    for (const block of source.matchAll(/^export \{([^}]*)\}/gm)) {
      for (const item of block[1].split(',').map(text => text.trim().split(/\s+as\s+/).at(-1)).filter(Boolean)) {
        if (/^[A-Z]/.test(item)) result.set(item, { file: family(file), slots: new Set([...collect(item), ...(EXTRA[item] ?? [])]) });
      }
    }
  }
  return result;
}

/**
 * The exports that the demos do not really render. `rendered` is { name: [slots found inside the demos that mark name] } (a name no demo marks is absent).
 * Returns strings naming each problem; an empty list is full coverage.
 */
export function uncovered(expected, rendered) {
  const problems = [];
  for (const [name, { file, slots }] of expected) {
    if (CONDITIONAL[name]) continue;
    const found = new Set(rendered[name] ?? []);
    if (!(name in rendered)) { problems.push(`${name}: no demo marks it`); continue; }
    if (NO_SLOT.has(name)) continue;
    const real = ROOTS.has(name) ? [...found].some(slot => slot === file || slot.startsWith(`${file}-`)) : [...slots].some(slot => found.has(slot));
    if (!real) problems.push(`${name}: rendered by name only (expected one of ${[...slots].join(', ') || 'a slot'}, found ${[...found].slice(0, 6).join(', ') || 'none'})`);
  }
  return problems;
}

/** Source of a function that runs in a page (or a frame): the slots inside each marked demo, as { name: [slots] }. */
export const RENDERED_SLOTS = `(() => {
  const found = {};
  const add = (names, container) => {
    const slots = [...container.querySelectorAll('[data-slot]')].map(node => node.getAttribute('data-slot'));
    if (container.querySelector('[data-sonner-toaster]')) slots.push('sonner-toaster');
    for (const name of names.split(/\\s+/).filter(Boolean)) found[name] = [...new Set([...(found[name] ?? []), ...slots])];
  };
  for (const node of document.querySelectorAll('[data-ds-component]')) add(node.getAttribute('data-ds-component'), node);
  const cell = document.querySelector('[data-ds-cell-names]');
  if (cell) add(cell.getAttribute('data-ds-cell-names'), document.body);
  return found;
})()`;
