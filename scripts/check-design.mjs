import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitIgnored, walkProject } from './project-files.mjs';
import { SHADCN_BUILTINS } from './check-registry-blocks.mjs';
import { registryCss } from '../lab/studio/tailwind.mjs';
import { scanAppDesign, scanDesign } from '../packages/ui/bin/boring-ui-blocks.mjs';

// The rule engine ships in the kit's bin (`boring-ui-blocks check --design`); this script applies it to the registry and the kit.
export { scanDesign };

export const designRoot = fileURLToPath(new URL('../', import.meta.url));
export const readDesignConfig = (root = designRoot) => JSON.parse(readFileSync(resolve(root, 'scripts/design-groups.json'), 'utf8'));
export const groupForFile = (file, config) => config.groups.find(group => group.folders.some(folder => file.startsWith(folder)));
const primitive = /^(?:Button|IconButton|Toggle|ToggleGroup|Input|Textarea|Select|Checkbox|Switch|RadioGroup|Dialog|Sheet|Drawer|Popover|Tooltip|DropdownMenu|ActionMenu|SidebarMenu\w*)$/;
export function checkDesign(root = designRoot, { config = readDesignConfig(root), allowlist = JSON.parse(readFileSync(resolve(root, 'scripts/design-allowlist.json'), 'utf8')) } = {}) {
  const errors = [], findings = [], allowed = [];
  if (config.version !== 1 || !Array.isArray(config.groups) || !config.groups.length) throw new Error('Invalid design group config');
  const ids = new Set();
  for (const group of config.groups) {
    if (ids.has(group.id) || !['REPORT', 'FAIL'].includes(group.mode) || !group.folders?.length || !group.selector) errors.push(`Invalid design group: ${group.id}`);
    ids.add(group.id);
  }
  const exemptions = new Set(allowlist.exceptions.map(entry => entry.id));
  for (const entry of allowlist.allow) if (!exemptions.has(entry.exception) || !entry.file || !entry.rules?.length || !entry.pattern) errors.push('Invalid design allowlist entry');
  const add = finding => {
    const group = finding.group ? config.groups.find(group => group.id === finding.group) : finding.file === 'registry.json#theme' ? config.groups.at(-1) : groupForFile(finding.file, config);
    if (!group) { errors.push(`Unowned design source: ${finding.file}`); return; }
    const result = { ...finding, group: group.id, mode: group.mode };
    const exemption = allowlist.allow.find(entry => entry.file === finding.file && entry.rules.includes(finding.rule) && new RegExp(entry.pattern).test(finding.value));
    (exemption ? allowed : findings).push(exemption ? { ...result, exception: exemption.exception } : result);
  };
  const manifest = JSON.parse(readFileSync(resolve(root, 'registry.json'), 'utf8'));
  const ignored = gitIgnored(root);
  let files = 0;
  for (const folder of ['registry', 'packages/ui/src', 'packages/ui/styles']) if (existsSync(resolve(root, folder))) walkProject(root, folder, (entry, file) => {
    if (entry.isSymbolicLink()) { errors.push(`Design source symlink: ${file}`); return false; }
    if (entry.isDirectory() || !/\.(?:tsx?|jsx?|mjs|css|json|md)$/.test(file)) return;
    files++;
    const text = readFileSync(resolve(root, file), 'utf8');
    // Documentation contains syntax examples, not shipped classes. Still report obsolete style support.
    for (const finding of scanDesign(file, text)) if (!file.endsWith('.md') || finding.rule === 'style') add(finding);
    const hostComponents = new Map();
    for (const match of text.matchAll(/\b(?:import|export)\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
      const [, bindings, specifier] = match;
      const ui = /^@\/components\/ui\/([\w-]+)$/.exec(specifier);
      if (ui) for (const [name] of bindings.matchAll(/(?<=\*\s+as\s+)[\w$]+|\b[A-Z]\w*/g)) hostComponents.set(name, ui[1]);
      let reason;
      if (ui && !SHADCN_BUILTINS.includes(ui[1])) reason = `shadcn import outside the app setup (SHADCN_BUILTINS): ${specifier}`;
      else if (!ui && !/^type\b/.test(bindings.trim()) && [...bindings.matchAll(/\b[A-Z]\w*/g)].some(([name]) => primitive.test(name))) reason = `UI primitive must come from the host's @/components/ui/*: ${specifier}`;
      if (reason) add({ file, line: text.slice(0, match.index).split('\n').length, column: 1, rule: 'primitive-import', value: reason, ...(/\b(?:Button|IconButton|Toggle|Switch)\b/.test(bindings) ? { group: '1' } : {}) });
    }
    const lineOf = index => text.slice(0, index).split('\n').length;
    // Objects holding host controls (`const controls = { textarea: Textarea }`) make `<controls.textarea>` a host control too.
    const holders = new Map();
    for (const match of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{([^}]*)\}/g)) {
      const held = [...match[2].matchAll(/\b[A-Z]\w*/g)].map(([name]) => name).filter(name => hostComponents.has(name));
      if (held.length) holders.set(match[1], held);
    }
    const classConsts = new Map(), touch = /(?<![\w-])(?:size|h|w)-11(?![\w-])/g;
    // Only a string literal or a cn/clsx/cva call counts as a held class.
    for (const match of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*((?:(["'`])(?:(?!\3)[^\\])*\3)|(?:cn|clsx|cva|twMerge)\([^;]*?\))\s*(?=;|\n)/g)) {
      const strings = [...match[2].matchAll(/(["'`])((?:(?!\1)[^\\])*)\1/g)].map(([, , value]) => value);
      if (strings.length) classConsts.set(match[1], strings.join(' ').replace(touch, ''));
    }
    const appearance = /(?<![\w-])(?:(?:bg|font|shadow|rounded|border|ring|duration|animate|size|p[xytrblse]?)-|text-(?!(?:left|right|center|justify|start|end)\b)|h-(?!auto\b))/;
    const hostFile = tag => {
      const [root, member] = tag.split('.');
      if (hostComponents.has(root)) return hostComponents.get(root);
      const held = holders.get(root)?.find(name => name.toLowerCase() === member?.toLowerCase()) ?? holders.get(root)?.[0];
      return held && hostComponents.get(held);
    };
    for (const match of text.matchAll(/<([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\b[^>]*?\bclassName\s*=\s*(?:["']([^"']*)["']|\{([^}]*?)\})/g)) {
      const ui = hostFile(match[1]);
      if (!ui) continue;
      let classes = match[2] ?? match[3];
      // A class held in a const and passed as className={cls} is the same class.
      if (match[3] !== undefined) classes += ' ' + [...match[3].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map(([, name]) => classConsts.get(name)).filter(Boolean).join(' ');
      if (appearance.test(classes)) add({ file, line: lineOf(match.index), column: 1, rule: 'shadcn-restyle', value: `${match[1]} className changes appearance: ${classes.trim()}`, ...(['button', 'toggle', 'switch'].includes(ui) ? { group: '1' } : {}) });
    }
    // An arbitrary descendant variant on a parent restyles the host control inside it.
    for (const match of text.matchAll(/[^\s"'`{}]*\[&[^\s"'`{}]*/g)) {
      const token = match[0].slice(match[0].indexOf('[&'));
      const split = /^\[&(.*)\]:((?:[\w-]+:)*)([^\s:\]]+)$/.exec(token);
      if (!split || !/data-slot|role=|(?<![A-Za-z0-9-])(?:button|input|textarea|select|checkbox|switch|toggle)(?![A-Za-z0-9-])/.test(split[1]) || !appearance.test(split[3].replace(touch, ''))) continue;
      add({ file, line: lineOf(match.index), column: 1, rule: 'shadcn-restyle', value: `descendant variant restyles a host control: ${token}`, ...(/button|toggle|switch/.test(split[1]) ? { group: '1' } : {}) });
    }
  }, ignored);
  // The design-system page (lab/design-system) is an app built from kit parts: it gets the app rules, so a palette colour or a restyled kit part fails here.
  if (existsSync(resolve(root, 'lab/design-system'))) walkProject(root, 'lab/design-system', (entry, file) => {
    if (entry.isSymbolicLink()) { errors.push(`Design source symlink: ${file}`); return false; }
    if (entry.isDirectory() || !/\.(?:tsx?|jsx?|mjs|css)$/.test(file)) return;
    files++;
    for (const finding of scanAppDesign(file, readFileSync(resolve(root, file), 'utf8'))) add({ column: 1, ...finding, value: finding.value ?? finding.message });
  }, ignored);
  for (const entry of config.primitives ?? []) if (existsSync(resolve(root, entry.file))) add({ file: entry.file, line: 1, column: 1, rule: 'primitive-file', value: `delete owned primitive; compose ${entry.replacement}` });
  // Registry css is shipped even when there is no adjacent .css file. Include it without scanning generated public/r twice.
  for (const item of manifest.items) {
    const file = item.name === 'theme' ? 'registry.json#theme' : `registry/${item.name}/@css`;
    // An item may carry both (the theme: token values and the control-size token's css); scan each.
    const text = [item.cssVars, item.css].filter(Boolean).map(css => registryCss({ css })).join('\n');
    for (const finding of scanDesign(file, text)) add(finding);
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
  return { errors, findings, allowed, files, groups: config.groups.map(group => ({ ...group, count: findings.filter(finding => finding.group === group.id).length })) };
}

export function formatDesignReport(result) {
  return ['BORING-UI-1 static design inventory (REPORT is migration debt, not conformance)', ...result.groups.map(group => `${group.mode} group ${group.id} ${group.name}: ${group.count} violation(s)`), `Scanned ${result.files} files; ${result.allowed.length} explicitly allowed theme values.`].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkDesign(realpathSync(designRoot));
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(formatDesignReport(result));
    if (process.argv.includes('--details')) for (const entry of result.findings) console.log(`${entry.mode} ${entry.file}:${entry.line}:${entry.column} group ${entry.group} ${entry.rule}: ${entry.value}`);
    if (result.errors.length) console.error(result.errors.join('\n'));
  }
  if (result.errors.length || result.findings.some(finding => finding.mode === 'FAIL')) process.exitCode = 1;
}
