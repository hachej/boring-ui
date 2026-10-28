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
--coach-subtle:#52525b;--coach-warning:#fef3c7;--coach-warning-foreground:#92400e;--coach-ok:#dcfce7;--coach-ok-foreground:#166534;color-scheme:light}
body{font-family:system-ui,-apple-system,sans-serif}`;

/** `oneLine`: the app whose only PM code is `improve={{ agent: 'pm' }}`, served through the fake PM door (#854). */
export async function startPmPanel({ oneLine = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-pm-panel-'));
  const originals = process.env.PM_BEFORE ? new Map(['app-shell.tsx', 'agent-layer.tsx', 'nav.tsx'].map(name => [name, execFileSync('git', ['show', `f81113dc9:registry/app-shell/${name}`], { encoding: 'utf8' })])) : undefined;
  try {
    const app = await startAppShell({ directory, scripted: true, pageFile: fileURLToPath(new URL(oneLine ? './oneline.tsx' : './page.tsx', import.meta.url)), themeCss: COACH_THEME, pmTranscript: { text: words, segments }, browserPlugins: originals ? [{ name: 'pre-pm-public-shell', setup(builder) {
      builder.onLoad({ filter: /registry\/app-shell\/(app-shell|agent-layer|nav)\.tsx$/ }, args => ({ contents: originals.get(args.path.split('/').pop()), loader: 'tsx', resolveDir: fileURLToPath(new URL('../../registry/app-shell/', import.meta.url)) }));
    } }] : [] });
    return { ...app, close: async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); } };
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startPmPanel(); console.log(`Fictional PM panel: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
