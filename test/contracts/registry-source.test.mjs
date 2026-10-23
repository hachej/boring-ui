import { workspaceDirectory, registryPin } from '../../scripts/consumer-install.mjs';
import semver from 'semver';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrySchema, registryItemSchema } from 'shadcn/schema';
import { buildRegistry } from '../../scripts/build-registry.mjs';
import { checkRegistryBlocks, SHADCN_BUILTINS } from '../../scripts/check-registry-blocks.mjs';
import { viewersCss } from '../../registry/viewer-frame/build-css.mjs';
import { feedbackCss } from '../../scripts/build-feedback-css.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Items written in Tailwind, installed into their own folder, rather than recipes over a headless @hachej/boring-ui-kit controller.
const manifest = registrySchema.parse(JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')));
// Tailwind items bring owned source with shadcn tokens: every rule is scoped to the item's root class and lives in the base or components layer.
const TAILWIND = { windows: { scope: '[data-boring="window-layer"]', keyframes: /^$/, folder: 'windows' }, 'requests-board': { scope: '[data-boring="requests-board"]', keyframes: /^$/, folder: 'requests-board' }, 'record-viewer': { scope: '[data-boring="records-viewer"]', keyframes: /^$/, folder: 'record-viewer' }, 'agent-target': { scope: '[data-boring="agent-target"]', keyframes: /^$/, folder: 'agent-target' }, 'mockup-viewer': { scope: '[data-boring="mockup-viewer"]', keyframes: /^$/, folder: 'mockup-viewer' }, 'version-history': { scope: '[data-boring="version-history"]', keyframes: /^$/, folder: 'version-history' }, 'file-tree': { scope: '[data-boring="file-tree"]', keyframes: /^$/, folder: 'file-tree' }, button: { scope: '.pi-chat', keyframes: /^$/, folder: 'button' }, utils: { scope: '.pi-chat', keyframes: /^$/, folder: 'utils' }, 'pi-chat': { scope: '.pi-chat', keyframes: /^@keyframes pi-chat-/, folder: 'pi-chat' }, 'pi-chat-markdown': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-chat-markdown' }, 'pi-chat-slash': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-chat-slash' }, 'pi-chat-mentions': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-chat-mentions' }, 'pi-chat-pickers': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-chat-pickers' }, 'pi-chat-voice': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-chat-voice' }, 'pi-chat-attachments': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-chat-attachments' }, 'pi-chat-plugins': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-chat-plugins' }, 'pi-chat-question': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-chat-question' }, 'pi-chat-approval': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-chat-approval' }, 'pi-chat-subagent': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-chat-subagent' }, 'pi-artifacts': { scope: '.pi-chat', keyframes: /^$/, folder: 'pi-artifacts' }, 'shared-chat': { scope: '.pi-chat', keyframes: /^$/, folder: 'shared-chat' }, 'pi-ambient': { scope: '.pi-chat', keyframes: /^@keyframes pi-ambient-/, folder: 'pi-ambient' }, dock: { scope: '.pi-chat', keyframes: /^$/, folder: 'dock' }, 'pi-workspace': { scope: '.pi-chat', keyframes: /^@keyframes pi-workspace-/, folder: 'pi-workspace' }, 'placed-agent': { scope: '.pi-chat', keyframes: /^$/, folder: 'placed-agent' }, 'pi-app': { scope: '.pi-chat', keyframes: /^@keyframes pi-app-/, folder: 'pi-app' }, 'viewer-frame': { scope: '.boring-viewer', keyframes: /^@keyframes boring-viewer-/, folder: 'viewer-frame' }, 'viewer-markdown': { scope: '.boring-viewer', keyframes: /^$/, folder: 'viewer-markdown' }, 'viewer-html': { scope: '.boring-viewer', keyframes: /^$/, folder: 'viewer-html' }, 'viewer-image': { scope: '.boring-viewer', keyframes: /^$/, folder: 'viewer-image' }, 'viewer-pdf': { scope: '.boring-viewer', keyframes: /^$/, folder: 'viewer-pdf' }, 'viewer-code': { scope: '.boring-viewer', keyframes: /^$/, folder: 'viewer-code' }, 'provider-setup': { scope: '.provider-setup', keyframes: /^@keyframes provider-setup-/, folder: 'provider-setup' }, 'app-shell': { scope: '.app-shell', keyframes: /^$/, folder: 'app-shell' }, documents: { scope: '.app-shell', keyframes: /^$/, folder: 'documents' }, 'maquette-viewer': { scope: '[data-boring="maquette-viewer"]', keyframes: /^$/, folder: 'maquette-viewer' }, 'diagram-viewer': { scope: '[data-boring="diagram-viewer"]', keyframes: /^$/, folder: 'diagram-viewer' } };
// The feedback item imports the package's browser entries directly (no copied validators), React and React DOM (a portal); nothing from store, agent or source.
const FEEDBACK_IMPORTS = new Set(['react', 'react-dom', 'lucide-react', '@hachej/boring-feedback/format', '@hachej/boring-feedback/page', '@hachej/boring-feedback/ui', '@hachej/boring-feedback/preview']);
// The feedback item is a plug-in of its host pi-chat (owner ruling 6): its card and voice button import pi-chat's rows and labels and utils
// (`../pi-chat/`, `../utils/`), and the host's model and chat types, which are type-only imports and never installed as a direct dependency.
const HOST_IMPORTS = ['../pi-chat/', '../utils/'];
/** The `@boring-ui/` items a block reaches through registryDependencies, transitively (shadcn built-ins excluded). */
const closureOf = name => {
  const closure = new Set();
  const visit = from => { for (const dependency of (manifest.items.find(entry => entry.name === from).registryDependencies ?? []).filter(dependency => !SHADCN_BUILTINS.includes(dependency))) { const next = dependency.slice('@boring-ui/'.length); if (!closure.has(next)) { closure.add(next); visit(next); } } };
  visit(name);
  return closure;
};
/** The host-themed roots and everything they install, without global token defaults. */
const TOKEN_FREE_ROOTS = ['app-shell', 'agent-target', 'requests-board', 'windows'];
const TOKEN_FREE_CLOSURE = () => new Set(TOKEN_FREE_ROOTS.flatMap(name => [name, ...closureOf(name)]));
const TYPE_ONLY_IMPORTS = new Set(['@earendil-works/pi-ai', '@hachej/boring-ui-kit/native-chat']);
/** The modules a source imports or re-exports, split into type-only and value (a runtime `export ... from` counts as a value). */
const importKinds = source => ({
  typeOnly: new Set([...source.matchAll(/\b(?:import|export)\s+type\b[^'";]*?\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1])),
  valued: new Set([...source.matchAll(/\b(?:import|export)\s+(?!type\s)[^'";]*?\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1])),
});

test('app-shell, agent-target and requests-board closures ship no global tokens: no cssVars or theme item', () => {
  // `shadcn add` of the shell must not merge light and dark tokens or radius steps into the host's CSS: the theme is an optional item the host adds itself.
  for (const root of TOKEN_FREE_ROOTS) {
    const closure = closureOf(root);
    assert.ok(closure.size > 0);
    assert.ok(!closure.has('theme'), `the theme item is optional for ${root}`);
  }
  for (const name of TOKEN_FREE_CLOSURE()) assert.equal(manifest.items.find(entry => entry.name === name).cssVars, undefined, `${name} ships cssVars`);
});

test('pi-chat declares Trace as a style-resolved shadcn built-in, never a vendored item', () => {
  const chat = manifest.items.find(item => item.name === 'pi-chat');
  assert.ok(SHADCN_BUILTINS.includes('trace'));
  assert.ok(chat.registryDependencies.includes('trace'));
  assert.ok(!chat.files.some(file => /\/trace\.tsx$/.test(file.path)));
  for (const name of ['activity', 'tool', 'queue']) assert.match(readFileSync(join(root, `registry/pi-chat/${name}.tsx`), 'utf8'), /from '@\/components\/ui\/trace'/);
});

test('the type-only exception admits only type imports: a runtime re-export of a model SDK is a value import', () => {
  const reexport = importKinds("export { stream } from '@earendil-works/pi-ai';\n");
  assert.ok(reexport.valued.has('@earendil-works/pi-ai') && !reexport.typeOnly.has('@earendil-works/pi-ai'));
  const typed = importKinds("import type { ToolCall } from '@earendil-works/pi-ai';\nexport type { ToolResultMessage } from '@earendil-works/pi-ai';\n");
  assert.ok(typed.typeOnly.has('@earendil-works/pi-ai') && !typed.valued.has('@earendil-works/pi-ai'));
});

test('standard pinned CLI rebuilds the committed source registry artifact exactly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-registry-build-'));
  try {
    buildRegistry(root, directory);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'registry.json'), 'utf8')), JSON.parse(readFileSync(join(root, 'public/r/registry.json'), 'utf8')));
    for (const item of manifest.items) {
      const built = registryItemSchema.parse(JSON.parse(readFileSync(join(directory, item.name + '.json'), 'utf8')));
      const committed = JSON.parse(readFileSync(join(root, 'public/r', item.name + '.json'), 'utf8'));
      assert.deepEqual(built, registryItemSchema.parse(committed), 'Generated item is stale or differs from the real CLI');
      assert.equal(readFileSync(join(directory, item.name + '.json'), 'utf8'), readFileSync(join(root, 'public/r', item.name + '.json'), 'utf8'), 'public/r is stale: run npm run registry:build');
      for (const file of built.files ?? []) assert.equal(file.content, readFileSync(join(root, file.path), 'utf8'));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('registry dependency pins and scoped styles preserve the declared source distribution boundary', () => {
  const architecture = JSON.parse(readFileSync(join(root, 'ARCHITECTURE.json'), 'utf8'));
  const ui = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8'));
  const boringVersion = name => JSON.parse(readFileSync(join(workspaceDirectory(root, name), 'package.json'), 'utf8')).version;
  assert.equal(architecture.sourceDistribution.manifest, 'registry.json');
  assert.equal(architecture.sourceDistribution.format, 'shadcn@' + architecture.rootDevDependencies.shadcn);
  for (const item of manifest.items) {
    if (item.name === 'theme') {
      // The one theme: shadcn tokens for light and dark and their Tailwind bindings, no files and no packages. The CLI only adds the tokens a host lacks.
      assert.equal(item.type, 'registry:theme');
      assert.equal(item.files, undefined); assert.equal(item.dependencies, undefined); assert.equal(item.css, undefined);
      const { theme, light, dark } = item.cssVars;
      assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).filter(name => name !== 'radius').sort(), 'dark redefines every color token');
      for (const [name, value] of Object.entries(theme)) {
        if (name === 'default-border-width') {
          assert.equal(value, 'var(--border-width, 1px)', 'optional host border width keeps the stock Tailwind fallback');
          assert.ok(!('border-width' in light) && !('border-width' in dark), 'the binding requires no extra core token');
          continue;
        }
        const used = /^var\(--([\w-]+)\)$/.exec(value)?.[1] ?? /var\(--([\w-]+)\)/.exec(value)?.[1];
        assert.ok(used && used in light, `${name} binds a token of the theme`);
      }
      for (const token of ['background', 'foreground', 'muted', 'muted-foreground', 'border', 'ring', 'primary', 'primary-foreground', 'destructive', 'radius']) assert.ok(token in light, token);
      continue;
    }
    // Every Tailwind item depends on the theme (directly or through pi-chat).
    if (item.name in TAILWIND && item.name !== 'utils') {
      // The shell and targeting closures ship no global tokens; every other Tailwind item still depends on the theme.
      assert.equal(closureOf(item.name).has('theme'), !TOKEN_FREE_CLOSURE().has(item.name), `${item.name} depends on @boring-ui/theme`);
    }
    const declared = new Set();
    for (const dependency of item.dependencies ?? []) {
      const split = dependency.lastIndexOf('@'), name = dependency.slice(0, split), spec = dependency.slice(split + 1);
      // Internal packages are caret ranges on their version.
      const internal = name.startsWith('@hachej/boring-');
      if (internal) assert.match(spec, /^\^/, dependency);
      // Pi peers stay on the reviewed 1.1.x line (tilde) until the owner moves them.
      if (name.startsWith('@earendil-works/')) assert.match(spec, /^~/, dependency);
      const version = spec.replace(/^[\^~]/, '');
      assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
      declared.add(name);
      // Items that bring their own Tailwind source pin extra packages exactly as the repository's root tooling does.
      // Peers are the source of truth for item ranges; a Tailwind item without a peer uses the root tooling pin, and the SDK always does.
      const expected = internal ? boringVersion(name) : name === '@modelcontextprotocol/sdk' ? architecture.rootDevDependencies[name] : (ui.peerDependencies[name] ?? (item.name in TAILWIND ? architecture.rootDevDependencies[name] : undefined))?.replace(/^[\^~]/, '');
      assert.equal(version, expected, dependency);
    }
    // Blocks may depend only on other items of this registry (pi-ambient and pi-workspace build on pi-chat); nothing from a remote registry.
    // ... or one of the fixed shadcn built-ins by bare name (scripts/check-registry-blocks.mjs), which the consumer's own style resolves.
    for (const dependency of item.registryDependencies ?? []) assert.ok(SHADCN_BUILTINS.includes(dependency) || manifest.items.some(other => '@boring-ui/' + other.name === dependency), 'No implicit unpinned child items: ' + dependency);
    assert.equal(item.cssVars, undefined, 'No registry theme replacement');
    if (item.name in TAILWIND) {
      const { scope, keyframes, folder } = TAILWIND[item.name];
      // Standard Tailwind layers stay scoped to the item's root class, plus prefixed keyframes. Never a root, html or body rule.
      const scoped = (rules, where) => { for (const [key, value] of Object.entries(rules)) {
        if (typeof value === 'object' && /^@(media|container|supports)\b/.test(key)) { scoped(value, where + ' ' + key); continue; }
        for (const part of key.split(/,(?![^(]*\))/)) assert.ok(part.trim().startsWith(scope), where + ': ' + key);
      } };
      for (const [at, rules] of Object.entries(item.css ?? {})) {
        if (at.startsWith('@keyframes ')) { assert.match(at, keyframes); continue; }
        assert.match(at, /^@layer (base|components|utilities)$/);
        scoped(rules, at);
      }
      if (item.name === 'viewer-frame') assert.deepEqual(item.css, viewersCss(), 'registry.json css differs from registry/viewer-frame/viewers.css: run node registry/viewer-frame/build-css.mjs');
      const names = new Set(item.files.map(file => file.path.replace(new RegExp('^registry/' + folder + '/'), '')));
      for (const file of item.files) {
        assert.match(file.target, new RegExp('^components/' + folder + '/'), 'files install into their own folder, never over the host\'s button or utils');
        const source = readFileSync(join(root, file.path), 'utf8');
        for (const imported of [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1])) {
          if (imported.startsWith('./')) { assert.ok([...names].some(name => name.replace(/\.tsx?$/, '') === imported.slice(2)), `${file.path} imports missing ${imported}`); continue; }
          // The shadcn components of the host's own style (`@/components/ui/<built-in>`, and the `use-mobile` hook that the sidebar brings), only when declared.
          const shadcn = /^@\/(?:components\/ui\/([\w-]+)|hooks\/use-mobile)$/.exec(imported);
          if (shadcn) { assert.ok((item.registryDependencies ?? []).includes(shadcn[1] ?? 'sidebar') && SHADCN_BUILTINS.includes(shadcn[1] ?? 'sidebar'), `${file.path} imports ${imported} without declaring the shadcn built-in`); continue; }
          // A block imports the item it depends on by its installed sibling folder (`../utils/utils`, `../pi-chat/rows`); scripts/check-registry-blocks.mjs enforces the direction.
          const sibling = /^\.\.\/([\w-]+)\/([\w-]+)$/.exec(imported);
          if (sibling) { const other = manifest.items.find(entry => entry.name === sibling[1]); assert.ok(other && (item.registryDependencies ?? []).includes('@boring-ui/' + other.name) && other.files.some(entry => entry.path.replace(/\.tsx?$/, '') === `registry/${other.name}/${sibling[2]}`), `${file.path} imports ${imported} outside its registryDependencies`); continue; }
          if (architecture.sourceDistribution.runtimeImports.includes(imported)) continue;
          const pkg = imported.startsWith('@') ? imported.split('/').slice(0, 2).join('/') : imported.split('/')[0];
          assert.ok(declared.has(pkg), `${file.path} imports ${imported} which the item does not declare`);
          assert.ok(!/^(ai|@ai-sdk\/.*)$/.test(pkg), 'No AI SDK');
        }
        assert.doesNotMatch(source, /dangerouslySetInnerHTML|eval\s*\(|new Function/);
        // Only this sandbox-document builder contains the trusted pick script. Public/browser tests prove it stays in InteractiveFrame.
        if (file.path === 'registry/mockup-viewer/mockup-frame.ts') {
          assert.match(source, /export function mockupContent\(/);
          assert.match(source, /const PICK = `<script>/);
          assert.doesNotMatch(source, /from ['"]react|createElement|appendChild|contentDocument/);
        } else assert.doesNotMatch(source, /<script\b/);
      }
      continue;
    }
    if (item.name === 'feedback' || item.name === 'feedback-preview') {
      if (item.name === 'feedback-preview') assert.equal(item.css, undefined, 'the banner is styled by the feedback item');
      else assert.ok(!item.dependencies.some(name => name.startsWith('@earendil-works/pi-ai')), 'annotation-only feedback must not install the model SDK');
      if (item.name === 'feedback') assert.deepEqual(item.css, feedbackCss(), 'registry.json css differs from registry/feedback/feedback.css: run node scripts/build-feedback-css.mjs');
      const scoped = (rules, where) => { for (const [key, value] of Object.entries(rules)) {
        if (key.startsWith('@layer ')) { assert.match(key, /^@layer (base|components|utilities)$/); scoped(value, where + ' ' + key); continue; }
        if (/^@(media|container|supports)\b/.test(key)) { scoped(value, where + ' ' + key); continue; }
        for (const part of key.split(/,(?![^(]*\))/)) assert.ok(part.trim().startsWith('[data-boring="feedback"]'), where + ': ' + key);
      } };
      if (item.name === 'feedback') scoped(item.css, 'feedback');
      assert.ok(declared.has('@hachej/boring-feedback'));
      const names = item.files.map(file => file.path.replace(/^registry\/feedback\//, '').replace(/\.tsx?$/, ''));
      for (const file of item.files) {
        assert.match(file.target, new RegExp('^components/' + item.name + '/'), 'files install into their own folder');
        const source = readFileSync(join(root, file.path), 'utf8');
        const { typeOnly, valued } = importKinds(source);
        for (const imported of [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1])) {
          if (imported.startsWith('./')) { assert.ok(names.includes(imported.slice(2)), `${file.path} imports missing ${imported}`); continue; }
          const hostUi = /^@\/components\/ui\/([\w-]+)$/.exec(imported);
          if (hostUi) { assert.ok(SHADCN_BUILTINS.includes(hostUi[1]) && item.registryDependencies?.includes(hostUi[1]), `${file.path} imports undeclared host ${imported}`); continue; }
          if (HOST_IMPORTS.some(prefix => imported.startsWith(prefix))) { assert.ok(item.registryDependencies.includes('@boring-ui/pi-chat') && item.registryDependencies.includes('@boring-ui/utils'), `${file.path} imports its host ${imported} without depending on it`); continue; }
          // The hold-to-record hook is the optional voice item's, declared like the host.
          if (imported.startsWith('../pi-chat-voice/')) { assert.ok(item.registryDependencies.includes('@boring-ui/pi-chat-voice'), `${file.path} imports ${imported} without depending on @boring-ui/pi-chat-voice`); continue; }
          if (TYPE_ONLY_IMPORTS.has(imported) && typeOnly.has(imported) && !valued.has(imported)) continue;
          assert.ok(FEEDBACK_IMPORTS.has(imported), `${file.path} imports ${imported}: only React, React DOM and @hachej/boring-feedback/format, /page, /ui and /preview`);
        }
        // Masking, picking, anchoring and placement stay in the package: no copied serializer, policy or resolver.
        assert.doesNotMatch(source, /function\s+(parseFeedback|checkFeedback|serializePage|createPrivacyPolicy|anchorOf|resolveAppElement|maskText)\b|elementsFromPoint|getAttribute\(/);
        assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML|eval\s*\(|new Function|<script\b/);
      }
      continue;
    }
    const prefix = { 'markdown-editor': '.boring-markdown-recipe[data-boring=\"markdown-editor\"]', chat: '.boring-chat-recipe[data-boring=\"chat\"]', 'html-viewer': '.boring-html-recipe[data-boring=\"html-viewer\"]', 'file-tree': '[data-boring=\"file-tree\"]', 'task-list-viewer': '.boring-task-list-recipe[data-boring=\"task-list-viewer\"]' }[item.name];
    // Items without CSS still validate every shipped source and dependency.
    if (item.css) {
      assert.ok(prefix);
      for (const selector of Object.keys(item.css)) {
        for (const part of selector.split(',')) assert.ok(part.trim().startsWith(prefix), selector);
      }
    }
    for (const file of item.files) {
      const source = readFileSync(join(root, file.path), 'utf8');
      const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
      assert.ok(imports.length > 0);
      for (const imported of imports) {
        const hostUi = /^@\/components\/ui\/([\w-]+)$/.exec(imported);
        if (hostUi) { assert.ok(SHADCN_BUILTINS.includes(hostUi[1]) && item.registryDependencies?.includes(hostUi[1]), `${file.path} imports undeclared host ${imported}`); continue; }
        const sibling = /^\.\.\/([\w-]+)\/([\w-]+)$/.exec(imported);
        if (sibling) {
          const dependency = manifest.items.find(entry => entry.name === sibling[1]);
          assert.ok(dependency && item.registryDependencies?.includes('@boring-ui/' + dependency.name) && dependency.files.some(entry => entry.path.replace(/\.tsx?$/, '') === `registry/${dependency.name}/${sibling[2]}`), `${file.path} imports unshipped or undeclared ${imported}`);
          continue;
        }
        if (item.name === 'board-viewer' || item.name === 'mockup-viewer' || item.name === 'looks-viewer' || item.name === 'highlights' || item.name === 'markdown-editor') {
          if (imported.startsWith('./')) assert.ok(item.files.some(entry => entry.path.replace(/\.tsx?$/, '').endsWith('/' + imported.slice(2))), `${file.path} imports unshipped ${imported}`);
          else {
            const pkg = imported.startsWith('@') ? imported.split('/').slice(0, 2).join('/') : imported.split('/')[0];
            assert.ok(declared.has(pkg) || architecture.sourceDistribution.runtimeImports.includes(imported), `${file.path} imports undeclared ${imported}`);
          }
          continue;
        }
        if (item.name !== 'task-list-viewer') { assert.ok(architecture.sourceDistribution.runtimeImports.includes(imported), imported); continue; }
        if (imported.startsWith('./')) {
          assert.ok(item.files.some(entry => entry.path.replace(/\.tsx?$/, '').endsWith('/' + imported.slice(2))), `${file.path} imports unshipped ${imported}`);
        } else assert.ok(['react', 'zod', '@hachej/boring-ui-kit', '@hachej/boring-ui-kit/resources', '@hachej/boring-ui-kit/contracts', '@hachej/boring-ui-kit/text-buffer', '@hachej/boring-files', '@hachej/boring-files/platform'].includes(imported), imported);
      }
      assert.doesNotMatch(source, /dangerouslySetInnerHTML|eval\s*\(|new Function|<script\b/);
    }
  }
});

test('the block check rejects an import cycle in a registry block or a package source and prints its path', () => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-registry-cycle-'));
  try {
    cpSync(join(root, 'registry.json'), join(directory, 'registry.json'));
    cpSync(join(root, 'registry'), join(directory, 'registry'), { recursive: true });
    for (const name of readdirSync(join(root, 'packages'))) cpSync(join(root, 'packages', name, 'src'), join(directory, 'packages', name, 'src'), { recursive: true });
    assert.deepEqual(checkRegistryBlocks(directory).errors, []);
    // The cycle the owner found: the row model (a leaf lib) taking its queued-message type from the queue component.
    const rows = join(directory, 'registry/pi-chat/rows.ts');
    writeFileSync(rows, "import type { QueuedMessage as Queued } from './queue';\nexport type Fixture = Queued;\n" + readFileSync(rows, 'utf8'));
    // A longer, runtime cycle in a package source.
    const ui = join(directory, 'packages/ui/src');
    writeFileSync(join(ui, 'cycle-a.ts'), "import { b } from './cycle-b.js';\nexport const a = () => b;\n");
    writeFileSync(join(ui, 'cycle-b.ts'), "import { c } from './cycle-c.js';\nexport const b = () => c;\n");
    writeFileSync(join(ui, 'cycle-c.ts'), "export { a as c } from './cycle-a.js';\n");
    const cycles = checkRegistryBlocks(directory).errors.filter(error => error.includes('import cycle'));
    assert.deepEqual(cycles.map(error => /import cycle: (.*) \(/.exec(error)[1]), [
      'packages/ui/src/cycle-a.ts -> packages/ui/src/cycle-b.ts -> packages/ui/src/cycle-c.ts -> packages/ui/src/cycle-a.ts',
      'registry/pi-chat/queue.tsx -> registry/pi-chat/rows.ts -> registry/pi-chat/queue.tsx',
    ]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the block check accepts the fixed shadcn built-ins by bare name and rejects any other bare name or an undeclared @/components/ui import', () => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-registry-builtins-'));
  try {
    cpSync(join(root, 'registry.json'), join(directory, 'registry.json'));
    cpSync(join(root, 'registry'), join(directory, 'registry'), { recursive: true });
    for (const name of readdirSync(join(root, 'packages'))) cpSync(join(root, 'packages', name, 'src'), join(directory, 'packages', name, 'src'), { recursive: true });
    assert.deepEqual(checkRegistryBlocks(directory).errors, [], 'the committed app-shell item passes');
    const manifestPath = join(directory, 'registry.json');
    const edit = change => { const value = JSON.parse(readFileSync(manifestPath, 'utf8')); change(value.items.find(item => item.name === 'app-shell')); writeFileSync(manifestPath, JSON.stringify(value)); };
    edit(item => item.registryDependencies.push('carousel'));
    assert.deepEqual(checkRegistryBlocks(directory).errors.filter(error => error.includes('carousel')).length, 1, 'a bare name outside the list is refused');
    cpSync(join(root, 'registry.json'), manifestPath);
    edit(item => { item.registryDependencies = item.registryDependencies.filter(dependency => dependency !== 'sidebar'); });
    assert.ok(checkRegistryBlocks(directory).errors.some(error => /registry\/app-shell\/[^:]+: imports @\/components\/ui\/sidebar, but item app-shell does not declare/.test(error)), 'an import of an undeclared built-in is refused');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the block check keeps the reply cards out of the core chat: no card module and no pi-artifacts in pi-chat (rule 7, D-257)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-registry-cards-'));
  try {
    cpSync(join(root, 'registry.json'), join(directory, 'registry.json'));
    cpSync(join(root, 'registry'), join(directory, 'registry'), { recursive: true });
    for (const name of readdirSync(join(root, 'packages'))) cpSync(join(root, 'packages', name, 'src'), join(directory, 'packages', name, 'src'), { recursive: true });
    assert.deepEqual(checkRegistryBlocks(directory).errors, [], 'the committed core chat passes');
    const manifestPath = join(directory, 'registry.json');
    const edit = change => { const value = JSON.parse(readFileSync(manifestPath, 'utf8')); change(value.items.find(item => item.name === 'pi-chat')); writeFileSync(manifestPath, JSON.stringify(value)); };
    // A card module back in the core (the layout before step 3).
    cpSync(join(root, 'registry/pi-chat-question/question-card.tsx'), join(directory, 'registry/pi-chat/question-card.tsx'));
    edit(item => item.files.push({ path: 'registry/pi-chat/question-card.tsx', type: 'registry:component', target: 'components/pi-chat/question-card.tsx' }));
    assert.ok(checkRegistryBlocks(directory).errors.some(error => /registry\/pi-chat\/question-card\.tsx: the core chat ships question-card/.test(error)), 'a card module in the core is refused');
    cpSync(join(root, 'registry.json'), manifestPath);
    edit(item => item.registryDependencies.push('@boring-ui/pi-artifacts'));
    assert.ok(checkRegistryBlocks(directory).errors.some(error => /core chat must not depend on the optional feature item pi-artifacts/.test(error)), 'a core that depends on pi-artifacts is refused');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the block check keeps viewers lazy: the agent page and the kind modules never import a view statically (rule 7, D-257 step 4)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-registry-viewers-'));
  try {
    cpSync(join(root, 'registry.json'), join(directory, 'registry.json'));
    cpSync(join(root, 'registry'), join(directory, 'registry'), { recursive: true });
    for (const name of readdirSync(join(root, 'packages'))) cpSync(join(root, 'packages', name, 'src'), join(directory, 'packages', name, 'src'), { recursive: true });
    assert.deepEqual(checkRegistryBlocks(directory).errors, [], 'the committed agent page and kinds pass');
    const prepend = (path, line) => writeFileSync(join(directory, path), line + '\n' + readFileSync(join(directory, path), 'utf8'));
    // Type-only imports are erased: allowed.
    prepend('registry/pi-app/artifact-panel.tsx', "import type { PdfPaneProps } from '../viewer-pdf/pdf-pane';");
    assert.deepEqual(checkRegistryBlocks(directory).errors.filter(error => error.includes('statically')), [], 'a type-only import of a view is allowed');
    // The layout before step 4: the panel imports the Markdown pane and a kind module imports its view.
    prepend('registry/pi-app/artifact-panel.tsx', "import { MarkdownPane } from '../viewer-markdown/markdown-pane';");
    prepend('registry/maquette-viewer/maquette-kind.tsx', "import { MaquetteViewer } from './maquette-viewer';");
    const errors = checkRegistryBlocks(directory).errors.filter(error => error.includes('statically'));
    assert.ok(errors.some(error => /registry\/pi-app\/artifact-panel\.tsx: imports the view viewer-markdown\/markdown-pane statically/.test(error)), 'the agent page importing a view is refused');
    assert.ok(errors.some(error => /registry\/maquette-viewer\/maquette-kind\.tsx: imports the view maquette-viewer\/maquette-viewer statically/.test(error)), 'a kind module importing its view is refused');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('registry pins accept prerelease versions and a caret range admits only its own major', () => {
  assert.match('1.1.0-rc.1', registryPin);
  assert.match('^1.1.0', registryPin);
  assert.equal(semver.satisfies('1.2.0-rc.1', '^1.1.0'), false);
  assert.equal(semver.satisfies('1.1.0', '^1.1.0'), true);
});
