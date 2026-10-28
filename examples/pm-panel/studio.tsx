// Row D stories (1440×900): Studio's frame around the kit's PM conversation, desktop preset, in English. The rail, header and device frame
// are fixture chrome copied from the D boards (Studio owns them); the conversation column and the point layer inside the frame are the kit's.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { PmChat } from '../../registry/pm-panel/pm-panel';
import type { ImproveSpec } from '../../registry/pm-panel/pm-panel';

/** The Studio theme's roles for the PM composer (slate and the blue accent of row D). */
const STUDIO: CSSProperties = {
  '--background': '#fff', '--foreground': '#1c2327', '--primary': '#1c2327', '--primary-foreground': '#fff', '--muted': '#e2e9ec', '--muted-foreground': '#66737a',
  '--secondary': '#e2e9ec', '--secondary-foreground': '#1c2327', '--accent': '#e2e9ec', '--accent-foreground': '#1c2327', '--border': '#d5dde0', '--input': '#d5dde0', '--ring': '#8a979d', '--radius': '9px',
  '--pm-mark': '#5bbbe6', '--pm-mark-foreground': '#1c2327', '--pm-mark-line': '60%', '--pm-mark-width': '2px', '--pm-mic': '#5bbbe6', '--pm-mic-foreground': '#1c2327', '--pm-send-idle': '#c3ccd0', '--pm-line': 'transparent',
  '--pm-strip-line': '#5b6770', '--pm-hint': '#8a979d', '--pm-radius-box': '16px', '--pm-radius-toggle': '10px', '--pm-radius-segment': '8px', '--pm-radius-control': '9px',
  '--pm-bubble': '#5bbbe6', '--pm-bubble-foreground': '#1c2327', '--pm-reply': '#e2e9ec', '--pm-radius-bubble': '14px', '--pm-radius-tail': '4px', '--pm-radius-token': '6px', '--pm-radius-popover': '12px', '--pm-radius-send': '8px', '--pm-shadow-popover': '0 8px 24px rgba(28,35,39,0.14)', '--pm-label': '#3b4a52',
  background: '#e8eef0', color: '#1c2327', fontFamily: "'DM Sans', system-ui, sans-serif",
} as CSSProperties;
const circle = (active = false): CSSProperties => ({ width: 32, height: 32, borderRadius: 16, background: active ? '#fff' : '#dfe6e9', border: '1px solid #d5dde0', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, ...(active ? { boxShadow: '0 0 0 3px #5bbbe6' } : {}) });
const ghost: CSSProperties = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b4a52' };
const svg = (path: ReactNode, size = 16) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;

function Rail() {
  return <nav aria-label="Apps" style={{ width: 48, flex: '0 0 48px', background: '#e6ecee', borderRight: '1px solid #d5dde0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '8px 0', boxSizing: 'border-box' }}>
    <div style={{ width: 26, height: 26, borderRadius: 13, border: '3px solid #1c2327', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 10, height: 10, borderRadius: 5, background: '#5bbbe6' }} /></div>
    <div style={{ height: 6 }} />
    <span style={circle()}>B</span><span style={circle()}>C</span>
    <span style={circle(true)}>{svg(<><path d="M6 7v10" /><path d="M18 7v10" /><path d="M3 10v4" /><path d="M21 10v4" /><path d="M6 12h12" /></>, 18)}</span>
    <span style={circle()}>C</span><span style={circle()}>D</span><span style={circle()}>P</span><span style={circle()}>S</span>
    <span style={{ fontSize: 18, color: '#66737a' }}>+</span>
    <div style={{ flex: 1 }} />
    <div style={{ width: 32, height: 32, borderRadius: 16, background: '#d9f99d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>H</div>
  </nav>;
}

function Header() {
  return <header style={{ height: 52, flex: '0 0 52px', display: 'flex', background: '#eef2f3' }}>
    <div style={{ width: 420, flex: '0 0 420px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 16px', borderRight: '1px solid #d5dde0' }}>
      <span style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 600 }}>Coach Max</span>
      <span style={{ fontSize: 11, fontWeight: 500, borderRadius: 99, padding: '1px 8px', background: '#e2e9ec', color: '#3b4a52' }}>Live</span>
      <span style={{ flex: 1 }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', border: '1px solid #d5dde0', borderRadius: 8, background: '#fff', fontSize: 13, boxSizing: 'border-box' }}>
        {svg(<><path d="M3 6l2 2 4-4" /><path d="M3 14l2 2 4-4" /><path d="M13 6h8" /><path d="M13 14h8" /></>, 15)}
        <span style={{ fontSize: 11, fontWeight: 500, borderRadius: 99, padding: '1px 8px', background: '#1c2327', color: '#fff' }}>1</span></span>
      <span style={ghost}>{svg(<path d="M5 12h14" />)}</span>
    </div>
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px 0 14px', background: '#e8eef0' }}>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: '#3b4a52', border: '1px solid #d5dde0', borderRadius: 99, padding: '2px 9px', background: '#fff' }}>v42</span>
      <span style={ghost}>{svg(<><path d="M15 3h6v6" /><path d="M10 14L21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>)}</span>
      <span style={ghost}>{svg(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>)}</span>
    </div>
  </header>;
}

/** The fictional app inside the 360×720 device frame (English, as on the D boards). */
function DeviceApp({ setPage, note }: { readonly setPage: (element: HTMLElement | null) => void; readonly note: (value: string) => void }) {
  return <div style={{ position: 'relative', width: 360, height: 720, background: '#fff', borderRadius: 28, border: '1px solid #d5dde0', boxSizing: 'border-box', overflow: 'hidden' }}>
    <div ref={setPage} data-pm-page="" data-testid="studio-frame" data-feedback-visible="" style={{ height: '100%', overflow: 'auto', padding: 16, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>My day</div>
      <div role="article" aria-label="Lunch" data-testid="d-card" onClick={() => note('card')} style={{ border: '1px solid #e4e4e7', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', color: '#66737a' }}>MEALS</div>
        <div style={{ fontSize: 20, fontWeight: 800, fontStyle: 'italic', margin: '2px 0 8px' }}>DAY PLAN</div>
        <div style={{ fontSize: 14, display: 'flex', justifyContent: 'space-between', fontWeight: 650 }}><span>Lunch</span><span>520 kcal · 32 g</span></div>
      </div>
      <div role="meter" aria-label="Protein" aria-valuenow={70} aria-valuemin={0} aria-valuemax={100} data-testid="d-gauge" onClick={() => note('gauge')} style={{ border: '1px solid #e4e4e7', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', color: '#66737a' }}>PROTEIN</div>
        <div style={{ marginTop: 10, height: 8, borderRadius: 4, background: '#e6ecee' }}><div style={{ width: '70%', height: '100%', borderRadius: 4, background: '#1c2327' }} /></div>
      </div>
    </div>
  </div>;
}

export function StudioStory({ spec, note }: { readonly spec: ImproveSpec; readonly note: (value: string) => void }) {
  const [page, setPage] = useState<HTMLElement | null>(null);
  return <div data-testid="studio-story" className="app-shell" style={{ ...STUDIO, width: '100vw', height: '100vh', display: 'flex', overflow: 'hidden' }}>
    <Rail />
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <Header />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <section aria-label="Conversation" style={{ width: 420, flex: '0 0 420px', background: '#eef2f3', borderRight: '1px solid #d5dde0', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <PmChat spec={spec} page={page} screen="My day" preset="desktop" />
        </section>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e8eef0' }}><DeviceApp setPage={setPage} note={note} /></div>
      </div>
    </div>
  </div>;
}
