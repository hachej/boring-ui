# pi-for-excel host support & install notes (GPT-5.5 spike findings, 2026-07-04)

> Provenance: GPT-5.5 answers grounded in the pi-for-excel clone at its 2026-07-04 HEAD; file:line references are into that repo. Reconstructed from the session transcript after the original scratchpad file was lost to a /tmp cleanup.

- Manifest supports Excel workbooks only: `<Host Name="Workbook" />`, `ReadWriteDocument`, hosted prod taskpane at Vercel; ribbon command under `DesktopFormFactor` (manifest.prod.xml:19, :24, :27, :31).
- Host support/test status: macOS Excel Desktop is required in release smoke and the latest real-host smoke passed launch/read/write; Windows Desktop is required "at least one pass" but the latest run notes the Windows pass still outstanding (docs/release-smoke-test-checklist.md:62; docs/release-smoke-runs/2026-07-04-macos-post-merge-smoke.md:46-84).
- Excel on the web is documented but weaker: optional sanity pass; install steps are "community-contributed — not officially tested" and may vary by Office 365 tenant (docs/release-smoke-test-checklist.md:66; docs/install.md:63, :65).
- User install is not AppSource: download `manifest.prod.xml`, add/upload it in Excel, then connect a provider (README.md:61-66).
- Platform install paths: macOS copies the manifest into `~/Library/.../wef`; Windows uses "Upload My Add-in…"; Web uses Add-ins -> Manage/Upload My Add-in (docs/install.md:25-73).
- Tenant/admin rollout: no AppSource listing; org rollout docs describe self-hosting/building an org manifest and distributing via Windows network-share catalog or centralized deployment (docs/central-proxy.md:66-99).
- M365 requirements: no explicit subscription requirement beyond having Excel/Office.js; provider access is BYO API key/OAuth (docs/install.md:3, :216; README.md:5).
- Limitations: OAuth/token endpoints can be blocked by Office webviews, especially macOS WKWebView, requiring an HTTPS proxy (docs/install.md:130-143).
- Web/desktop feature gaps: connected local folders work in Excel Online Chrome/Edge, not Firefox/Safari web or macOS WKWebView, and vary on Windows WebView2 (docs/files-workspace.md:23-33).
- Other host limits: host-specific CSP still needs smoke across Mac/Windows/Web; Ajv schema validation is disabled in Office builds due to Office CSP (docs/security-threat-model.md:81-82).
