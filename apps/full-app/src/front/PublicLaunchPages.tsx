import { useEffect, useMemo, useRef } from 'react'
import { useConfig } from '@hachej/boring-core/front'
import { definePanel, postUiCommand, workspaceLinkCommand } from '@hachej/boring-workspace'
import { definePlugin } from '@hachej/boring-workspace/plugin'

const calendlyUrl = 'https://calendly.com/julien-hurault-sumeo/30min'
const githubUrl = 'https://github.com/hachej/boring-ui'
const linkedinUrl = 'https://www.linkedin.com/in/julienhuraultanalytics/'
const consultingUrl = 'https://consulting.senecaapp.ai'

function shortBrandName(appName: string): string {
  const trimmed = appName.trim()
  return trimmed.replace(/\s+AI$/i, '') || trimmed || 'Boring UI'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return char
    }
  })
}

export function PublicHeroDescription() {
  const { appName } = useConfig()
  const brandName = shortBrandName(appName)
  return (
    <>
      Choose the AI you <em className="public-hero-trust">trust</em>.<br />
      {brandName} gives it a private remote computer where it can read files, run tasks, make changes, and show you the work for review.
    </>
  )
}

function openPublicPanel(
  containerApi: import('@hachej/boring-workspace').PaneProps['containerApi'],
  panel: 'landing' | 'lets-chat',
) {
  if (panel === 'landing') {
    containerApi.addPanel({
      id: 'public-landing-page',
      component: 'public.launch.landing',
      title: 'Landing page',
    })
    return
  }
  containerApi.addPanel({
    id: 'public-lets-chat',
    component: 'public.launch.lets-chat',
    title: 'Let’s chat',
  })
}

function PublicPagesPane({ containerApi }: import('@hachej/boring-workspace').PaneProps) {
  return (
    <div className="public-pages-pane">
      <button type="button" onClick={() => openPublicPanel(containerApi, 'landing')}>
        <strong>Landing page</strong>
      </button>
      <button type="button" onClick={() => openPublicPanel(containerApi, 'lets-chat')}>
        <strong>Book a call</strong>
      </button>
      <div className="public-pages-pane-note">
        <span>Sign in to unlock a private workspace where commands run for real — files, tools, and code.</span>
      </div>
    </div>
  )
}

function createLandingPageHtml(appName: string): string {
  const brandName = shortBrandName(appName)
  const productName = appName.trim() || brandName
  const escapedAppName = escapeHtml(productName)
  const escapedBrandName = escapeHtml(brandName)
  const brandInitial = (brandName.trim().charAt(0) || 'B').toUpperCase()
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedAppName} — the open-source AI workspace</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Spectral:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/landing.css" />
</head>
<body>
  <header class="topbar" id="top">
    <div class="wrap bar">
      <a class="wordmark" href="#top"><span class="sq"></span>${escapedAppName}</a>
      <nav class="nav" aria-label="Sections">
        <a class="nav-link" href="#why">Why ${escapedBrandName}</a>
        <a class="nav-link" href="#models">Models</a>
        <a class="nav-link" href="#consulting">Consulting</a>
        <span class="nav-sep"></span>
        <a class="nav-icon" href="${githubUrl}" target="_blank" rel="noreferrer" aria-label="${escapedBrandName} on GitHub">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.3a10.7 10.7 0 0 0-3.38 20.86c.53.1.73-.23.73-.51v-1.8c-2.97.65-3.6-1.43-3.6-1.43-.49-1.24-1.19-1.57-1.19-1.57-.97-.66.08-.65.08-.65 1.07.08 1.64 1.1 1.64 1.1.95 1.64 2.5 1.17 3.11.89.1-.69.37-1.17.68-1.44-2.37-.27-4.86-1.19-4.86-5.27 0-1.16.42-2.12 1.1-2.86-.11-.27-.48-1.35.1-2.82 0 0 .9-.29 2.95 1.1a10.2 10.2 0 0 1 5.36 0c2.04-1.39 2.94-1.1 2.94-1.1.59 1.47.22 2.55.11 2.82.69.74 1.1 1.7 1.1 2.86 0 4.09-2.49 4.99-4.87 5.26.38.33.72.98.72 1.98v2.93c0 .29.2.62.74.51A10.7 10.7 0 0 0 12 1.3"/></svg>
        </a>
        <a class="nav-icon" href="${linkedinUrl}" target="_blank" rel="noreferrer" aria-label="Julien Hurault on LinkedIn">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.06 3.77-2.06 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.4c0-1.29-.02-2.95-1.8-2.95-1.8 0-2.07 1.4-2.07 2.85V21H9z"/></svg>
        </a>
        <a class="navcta" href="#book" data-ws="book-call">Book a call</a>
      </nav>
    </div>
  </header>

  <div class="wrap">
    <section class="hero">
      <p class="kicker">Open source · Private · Works with any model</p>
      <h1>One workspace. <em>Any AI provider</em>.</h1>
      <p class="lead">${escapedBrandName} gives the AI of your choice a private remote computer to do real work for you: read files, run tasks, make changes, and show you what changed.<br /><br />Don’t let one provider own your workflow. ${escapedBrandName} is open source and model-agnostic. Use local models, European-hosted models, or frontier labs — and switch whenever you need.</p>
      <div class="actions">
        <a class="btn primary" href="${githubUrl}" target="_blank" rel="noreferrer">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.3a10.7 10.7 0 0 0-3.38 20.86c.53.1.73-.23.73-.51v-1.8c-2.97.65-3.6-1.43-3.6-1.43-.49-1.24-1.19-1.57-1.19-1.57-.97-.66.08-.65.08-.65 1.07.08 1.64 1.1 1.64 1.1.95 1.64 2.5 1.17 3.11.89.1-.69.37-1.17.68-1.44-2.37-.27-4.86-1.19-4.86-5.27 0-1.16.42-2.12 1.1-2.86-.11-.27-.48-1.35.1-2.82 0 0 .9-.29 2.95 1.1a10.2 10.2 0 0 1 5.36 0c2.04-1.39 2.94-1.1 2.94-1.1.59 1.47.22 2.55.11 2.82.69.74 1.1 1.7 1.1 2.86 0 4.09-2.49 4.99-4.87 5.26.38.33.72.98.72 1.98v2.93c0 .29.2.62.74.51A10.7 10.7 0 0 0 12 1.3"/></svg>
          Star on GitHub
        </a>
        <a class="btn ghost" href="#book" data-ws="book-call">Book a live walkthrough<span class="arrow">→</span></a>
      </div>
      <div class="pills">
        <span class="pill"><b></b>MIT licensed</span>
        <span class="pill"><b></b>Self-hostable</span>
        <span class="pill"><b></b>No vendor lock-in</span>
        <span class="pill"><b></b>Extensible via plugins</span>
      </div>
    </section>

    <section class="showcase">
      <div class="showcase-rule">
        <span>One conversation, one workspace</span>
        <span>Live demo</span>
      </div>
      <div class="frame">
        <div class="screen">
          <video
            class="demo-video"
            autoplay muted loop playsinline preload="metadata"
            poster="/seneca-demo-poster.jpg"
          >
            <source src="/seneca-demo.webm" type="video/webm" />
            <source src="/seneca-demo.mp4" type="video/mp4" />
          </video>
        </div>
        <div class="legend"><span>Tell the agent what to do</span><span>Inspect, steer, refine</span></div>
      </div>
    </section>

    <div class="manifesto">
      <p>AI tools shouldn't be tied to a single provider, a single model, or a single country. <em>Europe needs choice.</em></p>
    </div>

    <section class="band" id="why">
      <span class="eyebrow-row">Why ${escapedBrandName}</span>
      <h2>Open, private, and yours to deploy anywhere.</h2>
      <p class="section-lead">When access to a tool can be revoked overnight — by a provider, or a policy — you need software that answers to you. ${escapedBrandName} is built so nothing about your AI workspace is borrowed.</p>
      <div class="grid">
        <div class="card">
          <div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg></div>
          <h3>Open source</h3>
          <p>MIT-licensed and built on the open Pi agent harness. Read it, fork it, audit it. No black boxes between you and your data.</p>
        </div>
        <div class="card">
          <div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
          <h3>Private by design</h3>
          <p>Files, tools, and commands stay scoped to a workspace only you can reach. Run it on your own infrastructure and keep your data where it belongs.</p>
        </div>
        <div class="card">
          <div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg></div>
          <h3>Model-agnostic</h3>
          <p>Swap models without rewriting anything. Local, open, or frontier — ${escapedBrandName} isn't tied to one provider or one country.</p>
        </div>
        <div class="card">
          <div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
          <h3>Deploy anywhere</h3>
          <p>Your laptop, a European cloud, or your own servers. Wherever you choose to run it, it's the same workspace — under your control.</p>
        </div>
      </div>
    </section>

    <section class="band" id="models">
      <span class="eyebrow-row">Run any model</span>
      <h2>Your data. Your choice.</h2>
      <div class="models">
        <div class="model">
          <div class="t">On your machine</div>
          <h4>Local models</h4>
          <p>Run open weights directly on your own hardware. Nothing leaves the room.</p>
        </div>
        <div class="model">
          <div class="t">Hosted in Europe</div>
          <h4>EU open models</h4>
          <p>Open models on European infrastructure, for data residency you can prove.</p>
        </div>
        <div class="model">
          <div class="t">When you need it</div>
          <h4>US frontier models</h4>
          <p>Bring in the strongest US models for the hardest tasks — on your terms.</p>
        </div>
      </div>
    </section>

    <section class="band">
      <span class="eyebrow-row">Built to extend</span>
      <h2>The real power comes from your environment.</h2>
      <p class="section-lead">${escapedBrandName} extends through plugins from day one — add panels, tools, and commands to connect it to the tools and data your work already runs on:</p>
      <div class="chips">
        <span class="chip"><span class="d"></span>Documents</span>
        <span class="chip"><span class="d"></span>Databases</span>
        <span class="chip"><span class="d"></span>Internal tools</span>
        <span class="chip"><span class="d"></span>APIs</span>
        <span class="chip"><span class="d"></span>Your own plugins</span>
      </div>
      <a class="text-link" href="${githubUrl}#plugin-shape" target="_blank" rel="noreferrer">See how the plugin system works<span class="arrow">→</span></a>
    </section>

    <section class="band" id="consulting">
      <span class="eyebrow-row">Consulting</span>
      <div class="consult">
        <div class="consult-copy">
          <h2>Want it built for your team?</h2>
          <p class="section-lead">${escapedBrandName} Consulting designs and ships custom private AI agents — wired to your tools, running on your models and your infrastructure. Fixed scope, fixed price, hosted in Switzerland if you want it there.</p>
        </div>
        <div class="consult-cta">
          <a class="btn primary" href="${consultingUrl}" target="_blank" rel="noreferrer">Explore consulting<span class="arrow">→</span></a>
          <span class="consult-link">${consultingUrl.replace('https://', '')}</span>
        </div>
      </div>
    </section>

    <section class="cta">
      <h2>Have a workflow you'd like to <em>automate</em>?</h2>
      <p>Type <code>/reach-out</code> in the chat right now. We'll turn it into a private AI workspace wired to your tools and data — and help build AI infrastructure that gives people a choice.</p>
      <div class="actions">
        <a class="btn primary" href="#book" data-ws="book-call">Book a 30-min call<span class="arrow">→</span></a>
        <a class="btn ghost" href="${githubUrl}" target="_blank" rel="noreferrer">Star it on GitHub</a>
      </div>
    </section>

    <footer>
      <div class="brand"><span class="mark">${brandInitial}</span><span>${escapedAppName}</span></div>
      <div class="foot-links">
        <a href="${githubUrl}" target="_blank" rel="noreferrer">GitHub</a>
        <a href="#book" data-ws="book-call">Book a call</a>
        <a href="#consulting">Consulting</a>
      </div>
    </footer>
  </div>
  <script src="/landing.js"></script>
</body>
</html>`
}

const openLetsChatPanel = () =>
  postUiCommand(
    workspaceLinkCommand({
      kind: 'openPanel',
      id: 'public-lets-chat',
      component: 'public.launch.lets-chat',
      title: 'Let’s chat',
    }),
  )

export function LandingPageDemo() {
  const { appName } = useConfig()
  const landingPageHtml = useMemo(() => createLandingPageHtml(appName), [appName])
  const frameRef = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only trust messages from this iframe's own document.
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data
      if (!data || data.source !== 'seneca-landing') return
      if (data.action === 'book-call') openLetsChatPanel()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  return (
    <iframe
      ref={frameRef}
      title={`${appName} landing page`}
      srcDoc={landingPageHtml}
      className="public-html-preview"
      sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
    />
  )
}

export function LetsChatDemo() {
  const { appName } = useConfig()
  return (
    <iframe
      title={`Schedule a ${appName} walkthrough`}
      src={calendlyUrl}
      className="calendly-frame calendly-frame-full"
      loading="lazy"
    />
  )
}

export const publicLaunchPlugin = definePlugin({
  id: 'public-launch-pages',
  label: 'Public pages',
  panels: [
    definePanel({
      id: 'Pages',
      title: 'Pages',
      placement: 'workspace-page',
      component: PublicPagesPane,
    }),
    definePanel({
      id: 'public.launch.landing',
      title: 'Landing page',
      placement: 'shared-dockview',
      component: LandingPageDemo,
    }),
    definePanel({
      id: 'public.launch.lets-chat',
      title: 'Let’s chat',
      placement: 'shared-dockview',
      component: LetsChatDemo,
    }),
  ],
})
