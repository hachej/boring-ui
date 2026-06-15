import { useEffect, useRef } from 'react'
import { definePanel, postUiCommand, workspaceLinkCommand } from '@hachej/boring-workspace'
import { definePlugin } from '@hachej/boring-workspace/plugin'

const calendlyUrl = 'https://calendly.com/julien-hurault-sumeo/30min'
const githubUrl = 'https://github.com/hachej/boring-ui'
const linkedinUrl = 'https://www.linkedin.com/in/julienhuraultanalytics/'
const consultingUrl = 'https://consulting.senecaapp.ai'

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

const landingPageHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Seneca AI — the open-source AI workspace</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Spectral:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet" />
  <style>
    :root {
      color-scheme: light;
      --bg: oklch(0.992 0.002 72);
      --paper: oklch(0.972 0.004 72);
      --ink: oklch(0.20 0.006 72);
      --ink-soft: oklch(0.46 0.008 72);
      --line: oklch(0.90 0.004 72);
      --accent: oklch(0.62 0.14 65);
      --on-ink: oklch(0.985 0.002 72);
      --sans: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --serif: "Spectral", Georgia, "Times New Roman", serif;
      font-family: var(--sans);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: var(--bg); color: var(--ink); -webkit-font-smoothing: antialiased; }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 0 clamp(20px, 4.5vw, 56px); }
    a { color: inherit; text-decoration: none; }

    /* ---- top bar ---- */
    .topbar { position: sticky; top: 0; z-index: 10; backdrop-filter: blur(10px); background: color-mix(in oklch, var(--bg) 82%, transparent); border-bottom: 1px solid color-mix(in oklch, var(--line) 70%, transparent); }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; }
    .wordmark { display: inline-flex; align-items: center; gap: 11px; font-size: 13px; font-weight: 600; letter-spacing: .15em; text-transform: uppercase; }
    .wordmark .sq { width: 14px; height: 14px; border-radius: 3px; background: var(--accent); }
    .nav { display: inline-flex; align-items: center; gap: clamp(14px, 2vw, 26px); }
    .nav-link { font-size: 12px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); transition: color .15s ease; }
    .nav-link:hover { color: var(--ink); }
    .nav-sep { width: 1px; height: 18px; background: var(--line); }
    .nav-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; color: var(--ink-soft); transition: color .15s ease, background .15s ease; }
    .nav-icon:hover { color: var(--ink); background: color-mix(in oklch, var(--paper) 70%, transparent); }
    .nav-icon svg { width: 16px; height: 16px; }
    .navcta { display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; padding: 9px 17px; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; background: var(--ink); color: var(--on-ink); border: 1px solid var(--ink); }
    .navcta:hover { background: color-mix(in oklch, var(--ink) 88%, var(--accent)); }
    /* footer brand mark */
    .brand { display: inline-flex; align-items: center; gap: 11px; font-weight: 600; font-size: 15px; letter-spacing: -.01em; }
    .mark { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 9px; background: var(--ink); color: var(--on-ink); font-family: var(--serif); font-weight: 600; font-size: 17px; }

    /* ---- hero ---- */
    .hero { padding-top: clamp(52px, 9vw, 104px); padding-bottom: clamp(20px, 3vw, 32px); }
    .kicker { display: inline-flex; align-items: center; gap: 9px; margin: 0 0 26px; color: var(--ink-soft); font-size: 11px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; }
    .kicker::before { content: ""; width: 26px; height: 1px; background: var(--accent); }
    h1 { max-width: 16ch; margin: 0; font-family: var(--serif); font-weight: 600; font-size: clamp(44px, 7.6vw, 96px); line-height: .98; letter-spacing: -.02em; }
    h1 em { font-style: italic; color: var(--accent); }
    .lead { max-width: 58ch; margin: 28px 0 0; color: var(--ink-soft); font-size: clamp(16px, 1.55vw, 20px); line-height: 1.55; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 34px; }
    .btn { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 13px 22px; font-size: 14px; font-weight: 500; border: 1px solid var(--line); transition: transform .15s ease, border-color .15s ease, background .15s ease; }
    .btn:hover { transform: translateY(-1px); }
    .btn.primary { background: var(--ink); color: var(--on-ink); border-color: var(--ink); }
    .btn.primary:hover { background: color-mix(in oklch, var(--ink) 88%, var(--accent)); }
    .btn.ghost:hover { border-color: color-mix(in oklch, var(--ink) 28%, transparent); }
    .btn .arrow { font-size: 15px; }
    .btn svg { width: 16px; height: 16px; }
    .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
    .pill { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); border-radius: 999px; padding: 6px 13px; font-size: 12.5px; font-weight: 500; color: var(--ink-soft); }
    .pill b { width: 5px; height: 5px; border-radius: 999px; background: var(--accent); }

    /* ---- showcase ---- */
    .showcase { padding-top: clamp(48px, 7vw, 88px); }
    .showcase-rule { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
    .showcase-rule span { color: var(--ink-soft); font-size: 12px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; }
    .frame { margin-top: 26px; border: 1px solid var(--line); border-radius: 22px; background: var(--paper); padding: 10px; box-shadow: 0 1px 0 oklch(1 0 0 / .6) inset, 0 30px 70px -45px oklch(0.20 0.006 72 / .35); }
    .screen { border: 1px solid var(--line); border-radius: 15px; overflow: hidden; background: var(--bg); }
    .demo-video { display: block; width: 100%; height: auto; aspect-ratio: 1660 / 1080; object-fit: cover; }
    .panes { display: grid; grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr); gap: 10px; }
    .pane { border: 1px solid var(--line); border-radius: 15px; background: var(--bg); overflow: hidden; }
    .pane-bar { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border-bottom: 1px solid var(--line); font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
    .pane-bar .led { width: 7px; height: 7px; border-radius: 999px; background: var(--accent); }
    .chat { padding: 16px; display: flex; flex-direction: column; gap: 12px; min-height: 320px; }
    .msg { max-width: 86%; padding: 11px 13px; border-radius: 13px; font-size: 13.5px; line-height: 1.5; }
    .msg.them { align-self: flex-start; background: var(--paper); border: 1px solid var(--line); border-bottom-left-radius: 4px; color: var(--ink); }
    .msg.me { align-self: flex-end; background: color-mix(in oklch, var(--accent) 14%, var(--bg)); border: 1px solid color-mix(in oklch, var(--accent) 30%, var(--line)); border-bottom-right-radius: 4px; }
    .composer { margin-top: auto; display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 12px; padding: 9px 9px 9px 14px; background: var(--bg); }
    .composer .ph { flex: 1; color: color-mix(in oklch, var(--ink-soft) 75%, transparent); font-size: 13px; }
    .composer .send { width: 28px; height: 28px; border-radius: 8px; background: var(--ink); color: var(--on-ink); display: grid; place-items: center; font-size: 13px; }
    .work-tabs { display: flex; gap: 6px; padding: 9px 12px; border-bottom: 1px solid var(--line); }
    .tab { font-size: 12px; font-weight: 500; padding: 5px 11px; border-radius: 8px; color: var(--ink-soft); }
    .tab.on { background: var(--paper); color: var(--ink); border: 1px solid var(--line); }
    .preview { padding: 22px 22px 26px; }
    .preview .eyebrow { color: var(--accent); font-size: 10px; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; }
    .preview h3 { margin: 10px 0 0; font-family: var(--serif); font-weight: 600; font-size: clamp(24px, 3vw, 34px); line-height: 1.02; letter-spacing: -.01em; max-width: 14ch; }
    .skeleton { margin-top: 18px; display: flex; flex-direction: column; gap: 9px; }
    .skeleton i { display: block; height: 9px; border-radius: 999px; background: color-mix(in oklch, var(--ink) 8%, var(--line)); }
    .skeleton i:nth-child(1) { width: 92%; }
    .skeleton i:nth-child(2) { width: 78%; }
    .skeleton i:nth-child(3) { width: 64%; }
    .preview .block { margin-top: 18px; height: 96px; border-radius: 12px; border: 1px solid var(--line); background: linear-gradient(120deg, var(--paper), color-mix(in oklch, var(--accent) 9%, var(--bg))); }
    .legend { display: grid; grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr); gap: 10px; margin-top: 12px; }
    .legend span { color: var(--ink-soft); font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; text-align: center; }

    /* ---- section scaffolding ---- */
    section.band { padding-top: clamp(64px, 9vw, 120px); }
    .eyebrow-row { display: inline-flex; align-items: center; gap: 9px; color: var(--ink-soft); font-size: 11px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; }
    .eyebrow-row::before { content: ""; width: 26px; height: 1px; background: var(--accent); }
    h2 { margin: 22px 0 0; font-family: var(--serif); font-weight: 600; font-size: clamp(30px, 4.4vw, 50px); line-height: 1.04; letter-spacing: -.02em; max-width: 20ch; }
    .section-lead { max-width: 56ch; margin: 18px 0 0; color: var(--ink-soft); font-size: clamp(15px, 1.4vw, 18px); line-height: 1.6; }

    /* ---- manifesto ---- */
    .manifesto { margin-top: clamp(56px, 8vw, 96px); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: clamp(32px, 5vw, 56px) 0; }
    .manifesto p { margin: 0; font-family: var(--serif); font-weight: 500; font-size: clamp(22px, 3.1vw, 36px); line-height: 1.3; letter-spacing: -.01em; max-width: 24ch; }
    .manifesto p em { font-style: italic; color: var(--accent); }
    .manifesto .by { margin-top: 22px; font-family: var(--sans); font-size: 13px; color: var(--ink-soft); letter-spacing: .02em; }

    /* ---- feature grid ---- */
    .grid { margin-top: clamp(36px, 5vw, 56px); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .card { border: 1px solid var(--line); border-radius: 18px; background: var(--paper); padding: clamp(20px, 2.4vw, 28px); transition: border-color .15s ease, transform .15s ease; }
    .card:hover { border-color: color-mix(in oklch, var(--accent) 40%, var(--line)); transform: translateY(-2px); }
    .card .ico { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 11px; background: color-mix(in oklch, var(--accent) 13%, var(--bg)); color: var(--accent); margin-bottom: 16px; }
    .card .ico svg { width: 19px; height: 19px; }
    .card h3 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -.01em; }
    .card p { margin: 9px 0 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; }

    /* ---- models row ---- */
    .models { margin-top: clamp(28px, 4vw, 40px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .model { border: 1px dashed var(--line); border-radius: 16px; padding: 22px; background: var(--bg); }
    .model .t { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
    .model h4 { margin: 12px 0 0; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
    .model p { margin: 7px 0 0; color: var(--ink-soft); font-size: 13.5px; line-height: 1.5; }

    /* ---- extend / connect chips ---- */
    .chips { margin-top: clamp(28px, 4vw, 40px); display: flex; flex-wrap: wrap; gap: 10px; }
    .chip { display: inline-flex; align-items: center; gap: 9px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); padding: 14px 18px; font-size: 14.5px; font-weight: 500; }
    .chip .d { width: 7px; height: 7px; border-radius: 999px; background: var(--accent); }

    /* ---- status note ---- */
    .note { margin-top: clamp(40px, 6vw, 64px); display: flex; gap: 16px; align-items: flex-start; border: 1px solid var(--line); border-radius: 18px; background: color-mix(in oklch, var(--accent) 6%, var(--paper)); padding: clamp(20px, 2.6vw, 28px); }
    .note .badge { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: var(--ink); color: var(--on-ink); font-size: 18px; }
    .note h3 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
    .note p { margin: 7px 0 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; max-width: 64ch; }

    /* ---- consulting ---- */
    .consult { margin-top: 22px; display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: clamp(24px, 4vw, 48px); align-items: center; border: 1px solid var(--line); border-radius: 22px; background: var(--paper); padding: clamp(28px, 4vw, 48px); }
    .consult-copy h2 { margin: 0; }
    .consult-copy .section-lead { margin-top: 16px; }
    .consult-cta { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
    .consult-link { font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; color: var(--ink-soft); }
    .text-link { display: inline-flex; align-items: center; gap: 7px; margin-top: 22px; font-size: 14px; font-weight: 500; color: var(--ink); border-bottom: 1px solid color-mix(in oklch, var(--accent) 55%, var(--line)); padding-bottom: 2px; transition: border-color .15s ease, color .15s ease; }
    .text-link:hover { color: var(--accent); border-color: var(--accent); }
    .cta code { font: 600 .92em/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 2px 7px; border-radius: 6px; background: color-mix(in oklch, var(--on-ink) 16%, transparent); color: var(--on-ink); }

    /* ---- final CTA ---- */
    .cta { margin-top: clamp(72px, 10vw, 128px); border: 1px solid var(--line); border-radius: 26px; background: var(--ink); color: var(--on-ink); padding: clamp(40px, 6vw, 72px) clamp(28px, 5vw, 64px); text-align: center; }
    .cta h2 { color: var(--on-ink); margin: 0 auto; max-width: 22ch; }
    .cta h2 em { font-style: italic; color: var(--accent); }
    .cta p { margin: 18px auto 0; max-width: 52ch; color: color-mix(in oklch, var(--on-ink) 72%, var(--ink)); font-size: clamp(15px, 1.4vw, 18px); line-height: 1.6; }
    .cta .actions { justify-content: center; }
    .cta .btn.primary { background: var(--on-ink); color: var(--ink); border-color: var(--on-ink); }
    .cta .btn.primary:hover { background: color-mix(in oklch, var(--on-ink) 86%, var(--accent)); }
    .cta .btn.ghost { color: var(--on-ink); border-color: color-mix(in oklch, var(--on-ink) 30%, transparent); }
    .cta .btn.ghost:hover { border-color: var(--on-ink); }

    footer { margin-top: clamp(48px, 7vw, 88px); padding: 28px 0 40px; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: center; justify-content: space-between; color: var(--ink-soft); font-size: 13px; }
    footer .foot-links { display: inline-flex; gap: 18px; }
    footer .foot-links a:hover { color: var(--ink); }

    @media (max-width: 820px) {
      .grid, .models { grid-template-columns: 1fr; }
      .consult { grid-template-columns: 1fr; align-items: start; }
    }
    @media (max-width: 760px) {
      h1 { font-size: clamp(38px, 11vw, 58px); }
      .panes, .legend { grid-template-columns: 1fr; }
      .chat { min-height: 220px; }
    }
    @media (max-width: 900px) { .nav-link, .nav-sep { display: none; } }
  </style>
</head>
<body>
  <header class="topbar" id="top">
    <div class="wrap bar">
      <a class="wordmark" href="#top"><span class="sq"></span>Seneca AI</a>
      <nav class="nav" aria-label="Sections">
        <a class="nav-link" href="#why">Why Seneca</a>
        <a class="nav-link" href="#models">Models</a>
        <a class="nav-link" href="#consulting">Consulting</a>
        <span class="nav-sep"></span>
        <a class="nav-icon" href="${githubUrl}" target="_blank" rel="noreferrer" aria-label="Seneca on GitHub">
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
      <p class="kicker">Open source · Private · Model-agnostic</p>
      <h1>An AI workspace you <em>own</em>.</h1>
      <p class="lead">Seneca is the open-source alternative to Claude Desktop and Codex App: a private workspace where an agent reads your files, runs your tools, and builds real things. Run it on local models, open models hosted in Europe, or US frontier models — you choose the model, and where your data lives.</p>
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
      <span class="eyebrow-row">Why Seneca</span>
      <h2>Open, private, and yours to deploy anywhere.</h2>
      <p class="section-lead">When access to a tool can be revoked overnight — by a provider, or a policy — you need software that answers to you. Seneca is built so nothing about your AI workspace is borrowed.</p>
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
          <p>Swap models without rewriting anything. Local, open, or frontier — Seneca isn't tied to one provider or one country.</p>
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
      <p class="section-lead">Seneca extends through plugins from day one — add panels, tools, and commands to connect it to the tools and data your work already runs on:</p>
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
          <p class="section-lead">Seneca Consulting designs and ships custom private AI agents — wired to your tools, running on your models and your infrastructure. Fixed scope, fixed price, hosted in Switzerland if you want it there.</p>
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
      <div class="brand"><span class="mark">S</span><span>Seneca AI</span></div>
      <div class="foot-links">
        <a href="${githubUrl}" target="_blank" rel="noreferrer">GitHub</a>
        <a href="#book" data-ws="book-call">Book a call</a>
        <a href="#consulting">Consulting</a>
      </div>
    </footer>
  </div>
  <script>
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[data-ws]')
      if (!link) return
      event.preventDefault()
      parent.postMessage({ source: 'seneca-landing', action: link.getAttribute('data-ws') }, '*')
    })
  </script>
</body>
</html>`

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
      title="Seneca AI landing page"
      srcDoc={landingPageHtml}
      className="public-html-preview"
      sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
    />
  )
}

export function LetsChatDemo() {
  return (
    <iframe
      title="Schedule a Seneca AI walkthrough"
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
      placement: 'left-tab',
      defaultPanelId: 'public.launch.landing',
      component: PublicPagesPane,
    }),
    definePanel({
      id: 'public.launch.landing',
      title: 'Landing page',
      placement: 'center',
      component: LandingPageDemo,
    }),
    definePanel({
      id: 'public.launch.lets-chat',
      title: 'Let’s chat',
      placement: 'center',
      component: LetsChatDemo,
    }),
  ],
})
