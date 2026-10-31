import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startAppShell } from '../app-shell/server.mjs';
import { segments, words } from './speech.mjs';

/** Coach Max's theme (the row C boards' zinc values): one host theme file, the only place fixture colours live. */
export const COACH_THEME = `:root{--background:#fff;--foreground:#18181b;--card:#fff;--card-foreground:#18181b;--popover:#fff;--popover-foreground:#18181b;
--primary:#18181b;--primary-foreground:#fff;--secondary:#f4f4f5;--secondary-foreground:#18181b;--muted:#f4f4f5;--muted-foreground:#52525b;--accent:#f4f4f5;--accent-foreground:#18181b;
--destructive:#ef4444;--border:#e4e4e7;--input:#d4d4d8;--ring:#a1a1aa;--radius:0.5rem;
--pm-mark:#18181b;--pm-mark-foreground:#fff;--pm-mic:transparent;--pm-mic-foreground:#18181b;--pm-send-idle:#a1a1aa;--pm-line:#d4d4d8;--pm-strip-line:#71717a;
--pm-radius-box:14px;--pm-radius-sheet:20px;--pm-shadow-sheet:0 -8px 24px rgba(0,0,0,0.12);--pm-shadow-panel:0 -8px 24px rgba(0,0,0,0.1);--pm-weight-title:650;--pm-hint:#71717a;--pm-radius-round:9999px;--pm-radius-toggle:22px;--pm-radius-segment:19px;--pm-radius-control:8px;--pm-bubble:#f4f4f5;--pm-bubble-foreground:#18181b;--pm-reply:transparent;--pm-radius-bubble:16px;--pm-radius-tail:4px;--pm-radius-token:6px;--pm-mark-line:35%;--pm-mark-width:2px;
--coach-subtle:#52525b;--warning-soft:#fef3c7;--warning-soft-foreground:#92400e;color-scheme:light}
body{font-family:system-ui,-apple-system,sans-serif}
:root.dark{--background:#18181b;--foreground:#fafafa;--card:#18181b;--card-foreground:#fafafa;--popover:#27272a;--popover-foreground:#fafafa;--primary:#fafafa;--primary-foreground:#18181b;--secondary:#27272a;--secondary-foreground:#fafafa;--muted:#27272a;--muted-foreground:#a1a1aa;--accent:#3f3f46;--accent-foreground:#fafafa;--border:#3f3f46;--input:#52525b;--pm-mark:#fafafa;--pm-mark-foreground:#18181b;--pm-mic-foreground:#fafafa;color-scheme:dark}
:root[data-pm-theme=studio]{--background:#faf5ff;--foreground:#3b0764;--card:#faf5ff;--card-foreground:#3b0764;--popover:#faf5ff;--popover-foreground:#3b0764;--primary:#7e22ce;--primary-foreground:#faf5ff;--secondary:#f3e8ff;--secondary-foreground:#3b0764;--muted:#f3e8ff;--muted-foreground:#6b21a8;--accent:#e9d5ff;--accent-foreground:#3b0764;--border:#d8b4fe;--input:#d8b4fe;--ring:#a855f7;--pm-mark:#7e22ce;--pm-mark-foreground:#faf5ff;--pm-mic-foreground:#7e22ce;--radius:0.9rem}
:root.dark[data-pm-theme=studio]{--background:#1e1230;--foreground:#f3e8ff;--card:#1e1230;--card-foreground:#f3e8ff;--popover:#2e1647;--popover-foreground:#f3e8ff;--primary:#d8b4fe;--primary-foreground:#3b0764;--secondary:#3b1d54;--secondary-foreground:#f3e8ff;--muted:#3b1d54;--muted-foreground:#d8b4fe;--accent:#581c87;--accent-foreground:#f3e8ff;--border:#6b21a8;--input:#6b21a8;--pm-mark:#d8b4fe;--pm-mark-foreground:#3b0764;--pm-mic-foreground:#d8b4fe}`;

/** `oneLine`: the app whose only PM code is `panel={pmPanel({ agent: 'pm' })}`, served through the fake PM door (#854) under a host prefix, with the host's task API. */
export async function startPmPanel({ oneLine = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-pm-panel-'));
  const originals = process.env.PM_BEFORE ? new Map(['app-shell.tsx', 'agent-layer.tsx', 'nav.tsx'].map(name => [name, execFileSync('git', ['show', `f81113dc9:registry/app-shell/${name}`], { encoding: 'utf8' })])) : undefined;
  try {
    const app = await startAppShell({ directory, scripted: true, pageFile: fileURLToPath(new URL(oneLine ? './oneline.tsx' : './page.tsx', import.meta.url)), themeCss: COACH_THEME, pmTranscript: { text: words, segments }, ...(oneLine ? { prefix: '/apps/coach-max/', pmTasks: true } : {}), browserPlugins: originals ? [{ name: 'pre-pm-public-shell', setup(builder) {
      builder.onLoad({ filter: /registry\/app-shell\/(app-shell|agent-layer|nav)\.tsx$/ }, args => ({ contents: originals.get(args.path.split('/').pop()), loader: 'tsx', resolveDir: fileURLToPath(new URL('../../registry/app-shell/', import.meta.url)) }));
    } }] : [] });
    return { ...app, close: async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); } };
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startPmPanel(); console.log(`Fictional PM panel: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
