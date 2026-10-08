// Guard: browser-reachable code must not use secure-context-only or environment-fragile APIs directly.
//
// Browsers omit crypto.randomUUID, crypto.subtle, navigator.clipboard, navigator.share, ... on plain-HTTP origins (a private
// Tailscale or LAN address), and they all exist on localhost, so a developer never sees the break. The one owner for those
// capabilities is packages/files/src/platform.ts (`@hachej/boring-files/platform`); each registry item keeps one self-contained helper.
// Everything else goes through them. The browser journeys run on an insecure origin as the dynamic half of this guard.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitIgnored, walkProject } from './project-files.mjs';
import ts from 'typescript';

// Browser-reachable source. Server-only files (packages/agent except its gateway provider, each example server.mjs, files/src/sqlite.ts, the remote handlers) are not listed.
export const BROWSER_GLOBS = [
  /^packages\/agent\/src\/gateway-provider\.ts$/,
  /^packages\/ui\/src\/.+\.[jt]sx?$/,
  /^packages\/feedback\/src\/(?:format|page|ui)\/.+\.[jt]sx?$/,
  /^packages\/files\/src\/(?!sqlite\.ts$|remote-handler\.ts$).+\.ts$/,
  /^packages\/execution\/src\/(?:remote-files|remote-shell)(?:-io|-protocol)?\.ts$/,
  /^registry\/.+\.tsx?$/,
  /^examples\/studio\/(?:panels\/)?[\w-]+\.jsx$/,
  // The opt-in agent worker (BORING-PI-5) is browser code too: its runtime entries, shims and the examples that compose them.
  /^packages\/browser\/src\/(?:[\w-]+|shims\/[\w-]+)\.ts$/,
  /^packages\/agent\/src\/(?:approval|ask-user|memory\/optchat(?:-core)?)\.ts$/,
  /^packages\/execution\/src\/virtual(?:-[\w-]+)?\.ts$/,
  /^examples\/browser-agent\/(?:page|worker)\/[\w-]+\.jsx?$/,
];
/** Roots whose relative imports are followed, so browser modules the globs do not name (share-link.mjs, ...) are covered too. */
const BROWSER_ENTRIES = /^examples\/[\w-]+\/browser\.jsx$/;

/** The only files allowed to touch a raw API, with the proof each must carry that it feature-detects first. */
export const ALLOWLIST = {
  'packages/files/src/platform.ts': { rules: ['randomUUID', 'crypto.subtle', 'navigator.clipboard'], requires: [/typeof crypto\.randomUUID === 'function'/, /globalThis\.crypto\?\.subtle/, /globalThis\.navigator\?\.clipboard/, /execCommand/] },
  'registry/utils/utils.ts': { rules: ['navigator.clipboard'], requires: [/globalThis\.navigator\?\.clipboard/, /execCommand/] },
  'registry/pi-ambient/browser-notify.ts': { rules: ['Notification'], requires: [/typeof candidate === 'function'/, /permission/, /requestPermission/] },
  'examples/ambient/mic.mjs': { rules: ['navigator.secure', 'getUserMedia'], requires: [/typeof globalThis\.navigator\?\.mediaDevices\?\.getUserMedia === 'function'/] },
  // Feedback voice: opens the microphone only from start() (the person's click), through an injectable getUserMedia whose default feature-detects.
  'packages/feedback/src/page/voice/capture.ts': { rules: ['navigator.secure', 'getUserMedia'], requires: [/typeof globalThis\.navigator\?\.mediaDevices\?\.getUserMedia !== 'function'/, /options\.getUserMedia \?\? browserGetUserMedia\(\)/] },
  'registry/viewers/share.ts': { rules: ['navigator.share'], requires: [/typeof nav\?\.share === 'function'/, /copyText/] },
};

const SECURE_ONLY = new Set(['clipboard', 'share', 'canShare', 'credentials', 'mediaDevices', 'geolocation', 'serviceWorker', 'wakeLock', 'bluetooth', 'usb', 'serial', 'hid']);
const HOW = {
  randomUUID: 'import { randomUUID } from "@hachej/boring-files/platform" (crypto.randomUUID is secure-context only)',
  'crypto.subtle': 'use sha256 from "@hachej/boring-files/platform" (crypto.subtle is secure-context only)',
  'navigator.clipboard': 'use copyToClipboard from "@hachej/boring-files/platform", or copyText in the registry item (navigator.clipboard is secure-context only)',
  'navigator.share': 'use createLinkShare from registry/viewers/share.ts (navigator.share is secure-context only)',
  'navigator.secure': 'secure-context-only browser API; feature-detect behind the platform module',
  isSecureContext: 'branching on isSecureContext hides the insecure-origin path; feature-detect the capability instead',
  'node:crypto': 'node:crypto does not exist in the browser; use "@hachej/boring-files/platform"',
  Notification: 'the browser Notification API depends on permission and a secure context; go through registry/pi-ambient/browser-notify.ts, which feature-detects and never asks on load',
  getUserMedia: 'getUserMedia (microphone, camera) is secure-context only and needs permission; it is host-provided, never built into a shared component',
  storage: 'localStorage/sessionStorage throw in private mode and with blocked cookies; wrap every access in try/catch',
  observer: 'ResizeObserver/IntersectionObserver/BroadcastChannel may be absent; guard with typeof X !== "undefined"',
  localhost: 'hard-coded localhost/127.0.0.1 breaks on any other origin; derive from location or take it from the host',
};

const receiver = (node) => node.getText().replace(/\s+/g, '');
const isNavigator = (node) => /(?:^|\.)(?:navigator|nav)$/.test(receiver(node));
const isCrypto = (node) => /(?:^|\.)crypto$/.test(receiver(node));
const propertyName = (node) => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;

/** Findings for one source text: [{ line, rule, message }]. */
export function scanSource(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2023, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const add = (node, rule, what) => found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, rule, message: `${what}: ${HOW[rule]}` });
  const inTry = (node) => { for (let n = node, p = node.parent; p; n = p, p = p.parent) if (ts.isTryStatement(p) && p.tryBlock === n) return true; return false; };
  const typeofGuards = new Set([...source.matchAll(/typeof\s+(ResizeObserver|IntersectionObserver|BroadcastChannel)\b/g)].map((m) => m[1]));
  const visit = (node) => {
    const name = propertyName(node);
    if (name !== undefined) {
      const target = node.expression;
      if (name === 'randomUUID' && isCrypto(target)) add(node, 'randomUUID', 'crypto.randomUUID');
      else if (name === 'subtle' && isCrypto(target)) add(node, 'crypto.subtle', 'crypto.subtle');
      else if (SECURE_ONLY.has(name) && isNavigator(target)) add(node, name === 'clipboard' ? 'navigator.clipboard' : name === 'share' || name === 'canShare' ? 'navigator.share' : 'navigator.secure', `navigator.${name}`);
    }
    if (name === 'getUserMedia') add(node, 'getUserMedia', 'getUserMedia');
    if (name === 'Notification' && /(?:^|\.)(?:globalThis|window|self)$/.test(receiver(node.expression))) add(node, 'Notification', `${receiver(node.expression)}.Notification`);
    // A bare `Notification` used as a value (new Notification, Notification.permission, typeof Notification), not a type or a property name.
    if (ts.isIdentifier(node) && node.text === 'Notification' && !ts.isTypeReferenceNode(node.parent) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      && !ts.isPropertySignature(node.parent) && !ts.isPropertyAssignment(node.parent) && !ts.isImportSpecifier(node.parent)) add(node, 'Notification', 'Notification');
    if (ts.isIdentifier(node) && node.text === 'isSecureContext') add(node, 'isSecureContext', 'isSecureContext');
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && /^(?:node:)?crypto$/.test(node.moduleSpecifier.text)) add(node, 'node:crypto', `import of ${node.moduleSpecifier.text}`);
    if (ts.isIdentifier(node) && (node.text === 'localStorage' || node.text === 'sessionStorage') && !ts.isTypeOfExpression(node.parent) && !inTry(node)) add(node, 'storage', `${node.text} outside try/catch`);
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /^(?:ResizeObserver|IntersectionObserver|BroadcastChannel)$/.test(node.expression.text) && !typeofGuards.has(node.expression.text)) add(node, 'observer', `new ${node.expression.text} without a typeof guard`);
    if (ts.isStringLiteralLike(node) && !ts.isImportDeclaration(node.parent) && /(?:^|[/@\s"'])(?:localhost|127\.0\.0\.1)(?::\d+|\/|$)/.test(node.text)) add(node, 'localhost', `hard-coded host ${JSON.stringify(node.text.slice(0, 40))}`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function listFiles(root) {
  const out = [];
  const ignored = gitIgnored(root);
  for (const top of ['packages', 'registry', 'examples']) if (existsSync(resolve(root, top))) walkProject(root, top, (entry, path) => { if (!entry.isDirectory()) out.push(path); }, ignored);
  return out;
}

/** Browser-reachable files: the globs plus everything relatively imported from an example's browser entry. */
export function browserFiles(root) {
  const all = listFiles(root);
  const reachable = new Set(all.filter((f) => BROWSER_GLOBS.some((g) => g.test(f)) || BROWSER_ENTRIES.test(f)));
  const queue = all.filter((f) => BROWSER_ENTRIES.test(f));
  const exists = (f) => existsSync(resolve(root, f)) && statSync(resolve(root, f)).isFile();
  for (let file; (file = queue.pop());) {
    for (const [, specifier] of readFileSync(resolve(root, file), 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = posix.normalize(posix.join(dirname(file), specifier));
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.jsx`, `${base}.mjs`].find(exists);
      if (target && /\.(?:[jt]sx?|mjs)$/.test(target) && !reachable.has(target)) { reachable.add(target); queue.push(target); }
    }
  }
  return [...reachable].sort();
}

export function checkPlatformApis(root) {
  const errors = [];
  const files = browserFiles(root);
  for (const file of files) {
    const source = readFileSync(resolve(root, file), 'utf8');
    const allowed = ALLOWLIST[file];
    for (const finding of scanSource(file, source)) {
      if (allowed?.rules.includes(finding.rule)) continue;
      errors.push(`BORING-PLATFORM ${file}:${finding.line}: ${finding.message}`);
    }
    for (const needle of allowed?.requires ?? []) if (!needle.test(source)) errors.push(`BORING-PLATFORM ${file}: allowlisted file must feature-detect (missing ${needle})`);
  }
  for (const file of Object.keys(ALLOWLIST)) if (!existsSync(resolve(root, file))) errors.push(`BORING-PLATFORM allowlist names a missing file: ${file}`);
  return { errors, files: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkPlatformApis(realpathSync(fileURLToPath(new URL('../', import.meta.url))));
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log(`ok: ${result.files} browser-reachable files use no secure-context-only API outside ${Object.keys(ALLOWLIST).length} feature-detecting helpers`);
}
