import { useMemo, useState, type ReactNode } from "react"
import { Button, Chip, StatusBadge, Textarea } from "@hachej/boring-ui-kit"
import { JobThreadView } from "./JobThreadView"
import {
  SAAS_ARTIFACTS,
  SAAS_COMPANIES,
  SAAS_FUNDS,
  SAAS_THREADS,
  type SaasArtifact,
  type SaasCompany,
  type SaasFund,
  type SaasThread,
} from "./SaasSpikeFixtures"

type SaasSection = "overview" | "companies" | "funds" | "threads" | "artifacts"

interface SaasLocation {
  section: SaasSection
  recordId?: string
}

type IconName = SaasSection | "chat" | "close" | "chevron" | "file" | "folder" | "spark" | "arrow"

const navItems: readonly { id: SaasSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "companies", label: "Companies" },
  { id: "funds", label: "Funds" },
  { id: "threads", label: "Threads" },
  { id: "artifacts", label: "Artifacts" },
]

function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  const paths: Record<IconName, ReactNode> = {
    overview: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>,
    companies: <><path d="M3 13.5v-10h7v10" /><path d="M10 7h3v6.5M5.5 5.5h2M5.5 8h2M5.5 10.5h2M2 13.5h12" /></>,
    funds: <><path d="M2.5 6h11M3.5 6V4l4.5-2 4.5 2v2M4.5 7.5v4M8 7.5v4M11.5 7.5v4M2.5 13.5h11" /></>,
    threads: <><path d="M3 3.5h10v7H7l-3.5 2.5v-2.5H3z" /><path d="M5.5 6h5M5.5 8h3.5" /></>,
    artifacts: <><path d="M3.5 2.5h5l4 4v7h-9z" /><path d="M8.5 2.5v4h4M5.5 9h5M5.5 11h4" /></>,
    chat: <><path d="M2.5 3.5h11v8h-6L4 14v-2.5H2.5z" /><path d="M5.5 6.5h5M5.5 8.5h3.5" /></>,
    close: <><path d="M4 4l8 8M12 4l-8 8" /></>,
    chevron: <><path d="M6 3.5L10.5 8 6 12.5" /></>,
    file: <><path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" /></>,
    folder: <><path d="M2.5 4h4l1.2 1.5h5.8v7.5h-11z" /></>,
    spark: <><path d="M8 1.8l1.1 3.1L12.2 6 9.1 7.1 8 10.2 6.9 7.1 3.8 6l3.1-1.1zM12.5 10l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" /></>,
    arrow: <><path d="M3 8h10M9 4l4 4-4 4" /></>,
  }
  return <svg viewBox="0 0 16 16" aria-hidden="true" className={className} {...common}>{paths[name]}</svg>
}

function fundFor(company: SaasCompany): SaasFund | undefined {
  return SAAS_FUNDS.find((fund) => fund.id === company.fundId)
}

function statusTone(status: SaasThread["status"]): "warning" | "info" | "success" {
  if (status === "Needs you") return "warning"
  if (status === "Complete") return "success"
  return "info"
}

function PageHeader({ eyebrow, title, description, trailing }: { eyebrow: string; title: string; description: string; trailing?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </header>
  )
}

function OverviewView({ navigate }: { navigate: (location: SaasLocation) => void }) {
  const sectorCount = new Set(SAAS_COMPANIES.map((company) => company.sector)).size
  const tiles: readonly { label: string; value: string; note: string; section: SaasSection }[] = [
    { label: "Companies tracked", value: String(SAAS_COMPANIES.length), note: `Across ${sectorCount} sectors`, section: "companies" },
    { label: "Funds", value: String(SAAS_FUNDS.length), note: "$2.2B fixture AUM", section: "funds" },
    { label: "Open threads", value: String(SAAS_THREADS.filter((thread) => thread.status !== "Complete").length), note: "2 active today", section: "threads" },
    { label: "Needs you", value: String(SAAS_THREADS.filter((thread) => thread.status === "Needs you").length), note: "Decisions waiting", section: "threads" },
  ]
  return (
    <div className="saas-spike-page">
      <PageHeader
        eyebrow="Portfolio intelligence"
        title="Good morning, Alex."
        description="Explore the portfolio directly, then bring an agent into the exact context where you need help."
      />
      <section aria-label="Portfolio summary" className="mt-8 grid overflow-hidden rounded-xl border border-border/70 bg-card sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile, index) => (
          <button
            key={tile.label}
            type="button"
            onClick={() => navigate({ section: tile.section })}
            className={[
              "group min-h-32 text-left px-5 py-5 transition-colors hover:bg-muted/45 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
              index > 0 ? "border-t border-border/60 xl:border-l xl:border-t-0" : "",
              index % 2 === 1 ? "sm:border-l" : "",
              index === 1 ? "sm:border-t-0" : "",
            ].join(" ")}
          >
            <span className="text-xs font-medium text-muted-foreground">{tile.label}</span>
            <span className="mt-3 block text-3xl font-semibold tracking-[-0.04em] text-foreground">{tile.value}</span>
            <span className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground/75">
              {tile.note}<Icon name="arrow" className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
          </button>
        ))}
      </section>
      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4 border-b border-border/70 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Recent threads</h2>
            <p className="mt-1 text-xs text-muted-foreground">Work moving across the portfolio</p>
          </div>
          <Button variant="ghost" size="xs" onClick={() => navigate({ section: "threads" })}>View all</Button>
        </div>
        <div className="divide-y divide-border/60">
          {SAAS_THREADS.slice(0, 4).map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => navigate({ section: "threads", recordId: thread.id })}
              className="group flex w-full items-center gap-4 px-1 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground/[0.06] text-muted-foreground"><Icon name="threads" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{thread.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{thread.subject}</span>
              </span>
              <StatusBadge tone={statusTone(thread.status)} className="shrink-0">{thread.status}</StatusBadge>
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground/70">{thread.updatedAt}</span>
              <Icon name="chevron" className="size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function CompaniesView({ openCompany }: { openCompany: (companyId: string) => void }) {
  return (
    <div className="saas-spike-page">
      <PageHeader eyebrow="Portfolio" title="Companies" description="The operating view of every tracked company, organized for fast scanning and drill-down." />
      <div className="mt-8 overflow-x-auto rounded-xl border border-border/70 bg-card">
        <div className="flex items-center justify-between gap-4 border-b border-border/70 px-4 py-3">
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{SAAS_COMPANIES.length}</span> active records</p>
          <span className="rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-xs text-muted-foreground">All sectors</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="bg-muted/30 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/75">
              <tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Sector</th><th className="px-4 py-3">Fund</th><th className="px-4 py-3 text-right">Last update</th><th className="w-10" /></tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {SAAS_COMPANIES.map((company) => (
                <tr
                  key={company.id}
                  onClick={() => openCompany(company.id)}
                  className="group cursor-pointer transition-colors hover:bg-muted/45"
                >
                  <td className="px-4 py-3.5 font-medium text-foreground"><button type="button" onClick={() => openCompany(company.id)} className="rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{company.name}</button></td>
                  <td className="px-4 py-3.5 text-muted-foreground">{company.sector}</td>
                  <td className="px-4 py-3.5 text-muted-foreground">{fundFor(company)?.name}</td>
                  <td className="px-4 py-3.5 text-right text-xs text-muted-foreground">{company.lastUpdate}</td>
                  <td className="pr-3 text-muted-foreground/40"><Icon name="chevron" className="size-3.5 transition-transform group-hover:translate-x-0.5" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CompanyView({ company, navigate, openChat }: { company: SaasCompany; navigate: (location: SaasLocation) => void; openChat: () => void }) {
  const fund = fundFor(company)
  const documents = company.documentIds.map((id) => SAAS_ARTIFACTS.find((item) => item.id === id)).filter((item): item is SaasArtifact => Boolean(item))
  const threads = company.threadIds.map((id) => SAAS_THREADS.find((item) => item.id === id)).filter((item): item is SaasThread => Boolean(item))
  return (
    <div className="saas-spike-page">
      <PageHeader
        eyebrow={`${company.sector} · ${company.stage}`}
        title={company.name}
        description={company.summary}
        trailing={<Button size="sm" onClick={openChat}><Icon name="spark" />Ask about {company.name}</Button>}
      />
      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-10">
          <section>
            <h2 className="text-sm font-semibold text-foreground">Key metrics</h2>
            <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-lg border border-border/70">
              {company.metrics.map((metric, index) => (
                <div key={metric.label} className={`px-4 py-4 ${index > 0 ? "border-l border-border/60" : ""}`}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">{metric.label}</p>
                  <p className="mt-2 text-xl font-semibold tracking-[-0.025em] text-foreground">{metric.value}</p>
                </div>
              ))}
            </div>
          </section>
          <section>
            <div className="border-b border-border/70 pb-3">
              <h2 className="text-sm font-semibold text-foreground">Documents</h2>
              <p className="mt-1 text-xs text-muted-foreground">Artifacts available to you and the agent</p>
            </div>
            {documents.length > 0 ? <div className="divide-y divide-border/60">
              {documents.map((document) => (
                <button key={document.id} type="button" onClick={() => navigate({ section: "artifacts", recordId: document.id })} className="group flex w-full items-center gap-3 px-1 py-3.5 text-left hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                  <span className="grid size-8 place-items-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground"><Icon name="file" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{document.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{document.kind} · {document.updatedAt}</span></span>
                  <Icon name="chevron" className="size-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div> : <p className="py-6 text-sm text-muted-foreground">No fixture documents attached.</p>}
          </section>
          <section>
            <div className="border-b border-border/70 pb-3">
              <h2 className="text-sm font-semibold text-foreground">Threads about this company</h2>
              <p className="mt-1 text-xs text-muted-foreground">Agent work that carries this company as context</p>
            </div>
            {threads.length > 0 ? <div className="divide-y divide-border/60">
              {threads.map((thread) => (
                <button key={thread.id} type="button" onClick={() => navigate({ section: "threads", recordId: thread.id })} className="group flex w-full items-center gap-3 px-1 py-3.5 text-left hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                  <span className="grid size-8 place-items-center rounded-full bg-foreground/[0.06] text-muted-foreground"><Icon name="threads" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{thread.title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{thread.subject}</span></span>
                  <StatusBadge tone={statusTone(thread.status)}>{thread.status}</StatusBadge>
                  <Icon name="chevron" className="size-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div> : <p className="py-6 text-sm text-muted-foreground">No threads yet. Open Chat to start in this company context.</p>}
          </section>
        </div>
        <aside>
          <h2 className="border-b border-border/70 pb-3 text-sm font-semibold text-foreground">Company details</h2>
          <dl className="divide-y divide-border/60 text-sm">
            <div className="py-3"><dt className="text-xs text-muted-foreground">Fund</dt><dd className="mt-1"><button type="button" className="font-medium text-foreground hover:underline" onClick={() => fund && navigate({ section: "funds", recordId: fund.id })}>{fund?.name}</button></dd></div>
            <div className="py-3"><dt className="text-xs text-muted-foreground">Headquarters</dt><dd className="mt-1 text-foreground">{company.headquarters}</dd></div>
            <div className="py-3"><dt className="text-xs text-muted-foreground">Ownership</dt><dd className="mt-1 text-foreground">{company.ownership}</dd></div>
            <div className="py-3"><dt className="text-xs text-muted-foreground">Last update</dt><dd className="mt-1 text-foreground">{company.lastUpdate}</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  )
}

function FundsView({ openFund }: { openFund: (fundId: string) => void }) {
  return (
    <div className="saas-spike-page">
      <PageHeader eyebrow="Portfolio" title="Funds" description="Fund-level exposure, pacing, and the companies behind each strategy." />
      <div className="mt-8 overflow-x-auto rounded-xl border border-border/70 bg-card">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <thead className="bg-muted/30 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/75"><tr><th className="px-4 py-3">Fund</th><th className="px-4 py-3">Strategy</th><th className="px-4 py-3">Vintage</th><th className="px-4 py-3">AUM</th><th className="px-4 py-3 text-right">Companies</th><th className="w-10" /></tr></thead>
          <tbody className="divide-y divide-border/60">
            {SAAS_FUNDS.map((fund) => (
              <tr key={fund.id} onClick={() => openFund(fund.id)} className="group cursor-pointer hover:bg-muted/45">
                <td className="px-4 py-4"><button type="button" onClick={() => openFund(fund.id)} className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"><span className="font-medium text-foreground hover:underline">{fund.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{fund.status}</span></button></td>
                <td className="px-4 py-4 text-muted-foreground">{fund.strategy}</td><td className="px-4 py-4 text-muted-foreground">{fund.vintage}</td><td className="px-4 py-4 font-medium text-foreground">{fund.aum}</td>
                <td className="px-4 py-4 text-right tabular-nums text-muted-foreground">{SAAS_COMPANIES.filter((company) => company.fundId === fund.id).length}</td><td className="pr-3 text-muted-foreground/40"><Icon name="chevron" className="size-3.5 transition-transform group-hover:translate-x-0.5" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FundView({ fund, navigate, openChat }: { fund: SaasFund; navigate: (location: SaasLocation) => void; openChat: () => void }) {
  const companies = SAAS_COMPANIES.filter((company) => company.fundId === fund.id)
  return (
    <div className="saas-spike-page">
      <PageHeader eyebrow={`${fund.vintage} vintage · ${fund.status}`} title={fund.name} description={fund.summary} trailing={<Button size="sm" onClick={openChat}><Icon name="spark" />Ask about this fund</Button>} />
      <dl className="mt-8 grid grid-cols-3 overflow-hidden rounded-lg border border-border/70">
        {[{ label: "Strategy", value: fund.strategy }, { label: "Fixture AUM", value: fund.aum }, { label: "Companies", value: String(companies.length) }].map((item, index) => <div key={item.label} className={`px-4 py-4 ${index > 0 ? "border-l border-border/60" : ""}`}><dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">{item.label}</dt><dd className="mt-2 text-sm font-semibold text-foreground">{item.value}</dd></div>)}
      </dl>
      <section className="mt-10">
        <div className="border-b border-border/70 pb-3"><h2 className="text-sm font-semibold text-foreground">Portfolio companies</h2><p className="mt-1 text-xs text-muted-foreground">Open a company without leaving the deterministic portfolio flow</p></div>
        <div className="divide-y divide-border/60">
          {companies.map((company) => <button key={company.id} type="button" onClick={() => navigate({ section: "companies", recordId: company.id })} className="group flex w-full items-center gap-4 px-1 py-4 text-left hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"><span className="min-w-0 flex-1"><span className="font-medium text-foreground">{company.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{company.sector} · {company.stage}</span></span><span className="text-xs text-muted-foreground">{company.metrics[0]?.value} ARR</span><span className="w-20 text-right text-xs text-muted-foreground">{company.lastUpdate}</span><Icon name="chevron" className="size-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" /></button>)}
        </div>
      </section>
    </div>
  )
}

function ThreadsView({ openThread, openChat }: { openThread: (threadId: string) => void; openChat: () => void }) {
  return (
    <div className="saas-spike-page">
      <PageHeader eyebrow="Agent work" title="Threads" description="Jobs continue across companies, funds, and source artifacts while the portfolio remains explorable." trailing={<Button size="sm" onClick={openChat}>Start thread</Button>} />
      <div className="mt-8 overflow-hidden rounded-xl border border-border/70 bg-card divide-y divide-border/60">
        {SAAS_THREADS.map((thread) => (
          <button key={thread.id} type="button" onClick={() => openThread(thread.id)} className="group flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground/[0.06] text-muted-foreground"><Icon name="threads" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{thread.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{thread.subject}</span></span>
            <span className="hidden max-w-40 truncate text-xs text-muted-foreground xl:block">{thread.companyIds.length} {thread.companyIds.length === 1 ? "company" : "companies"}</span>
            <StatusBadge tone={statusTone(thread.status)}>{thread.status}</StatusBadge><span className="w-16 text-right text-xs text-muted-foreground/70">{thread.updatedAt}</span><Icon name="chevron" className="size-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
    </div>
  )
}

function ThreadView({ thread, navigate }: { thread: SaasThread; navigate: (location: SaasLocation) => void }) {
  const artifacts = thread.artifactIds.map((id) => SAAS_ARTIFACTS.find((artifact) => artifact.id === id)).filter((artifact): artifact is SaasArtifact => Boolean(artifact))
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-muted/20 px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Artifacts touched</span>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
          {artifacts.map((artifact) => <Button key={artifact.id} variant="ghost" size="xs" className="min-w-0 max-w-48" onClick={() => navigate({ section: "artifacts", recordId: artifact.id })}><Icon name="file" /><span className="truncate">{artifact.name}</span></Button>)}
        </div>
        <Button variant="ghost" size="xs" onClick={() => navigate({ section: "artifacts" })}>Explore all</Button>
      </div>
      <div className="min-h-0 flex-1"><JobThreadView fixture={thread.job} /></div>
    </div>
  )
}

interface ArtifactBranch {
  name: string
  children: readonly { name: string; artifacts: readonly SaasArtifact[] }[]
}

function artifactBranches(): readonly ArtifactBranch[] {
  const branches = new Map<string, Map<string, SaasArtifact[]>>()
  for (const artifact of SAAS_ARTIFACTS) {
    const [root = "Other", folder = "General"] = artifact.path
    const folders = branches.get(root) ?? new Map<string, SaasArtifact[]>()
    const files = folders.get(folder) ?? []
    files.push(artifact)
    folders.set(folder, files)
    branches.set(root, folders)
  }
  return [...branches].map(([name, children]) => ({ name, children: [...children].map(([childName, artifacts]) => ({ name: childName, artifacts })) }))
}

function ArtifactsView({ selected, openArtifact }: { selected?: SaasArtifact; openArtifact: (artifactId: string) => void }) {
  const branches = useMemo(artifactBranches, [])
  return (
    <div className="grid h-full min-h-0 grid-cols-[250px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto border-r border-border/70 bg-[color:var(--surface-workbench-left)] px-2 py-4">
        <div className="px-2 pb-3"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">Artifact library</p><p className="mt-1 text-xs text-muted-foreground">Fixture workspace</p></div>
        {branches.map((branch) => <div key={branch.name} className="mt-2"><div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-foreground/85"><Icon name="folder" className="size-3.5 text-muted-foreground" />{branch.name}</div>{branch.children.map((child) => <div key={child.name} className="ml-3 border-l border-border/70 pl-1"><div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground"><Icon name="folder" className="size-3" />{child.name}</div>{child.artifacts.map((artifact) => <button key={artifact.id} type="button" onClick={() => openArtifact(artifact.id)} data-active={selected?.id === artifact.id ? "true" : undefined} className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[active=true]:bg-foreground/[0.07] data-[active=true]:font-medium data-[active=true]:text-foreground"><Icon name="file" className="size-3.5 shrink-0" /><span className="truncate">{artifact.name}</span></button>)}</div>)}</div>)}
      </aside>
      <div className="min-h-0 overflow-y-auto bg-background">
        {selected ? <div className="mx-auto max-w-3xl px-8 py-10"><PageHeader eyebrow={`${selected.kind} · ${selected.updatedAt}`} title={selected.name} description={selected.summary} /><div className="mt-8 rounded-xl border border-border/70 bg-card p-8"><div className="mx-auto max-w-xl"><div className="flex items-center justify-between border-b border-border/70 pb-4"><span className="text-xs font-semibold text-foreground">Document preview</span><StatusBadge>Fixture</StatusBadge></div><h2 className="mt-8 text-xl font-semibold tracking-[-0.02em] text-foreground">{selected.name.replace(/\.[^.]+$/, "")}</h2><p className="mt-4 text-sm leading-7 text-muted-foreground">{selected.summary}</p><div className="mt-8 space-y-3"><span className="block h-2 w-full rounded-full bg-muted" /><span className="block h-2 w-[92%] rounded-full bg-muted" /><span className="block h-2 w-[76%] rounded-full bg-muted" /><span className="mt-6 block h-2 w-[88%] rounded-full bg-muted" /><span className="block h-2 w-[64%] rounded-full bg-muted" /></div><p className="mt-10 text-xs text-muted-foreground/70">Placeholder preview — the artifact browser is fixture-only.</p></div></div></div> : <div className="grid h-full place-items-center p-8 text-center"><div><span className="mx-auto grid size-10 place-items-center rounded-lg border border-border/70 bg-muted/30 text-muted-foreground"><Icon name="artifacts" /></span><h1 className="mt-4 text-sm font-semibold text-foreground">Explore artifacts</h1><p className="mt-1 max-w-xs text-sm leading-6 text-muted-foreground">Choose a file from the tree to inspect it without asking an agent.</p></div></div>}
      </div>
    </div>
  )
}

function breadcrumb(location: SaasLocation): readonly string[] {
  if (!location.recordId) return [navItems.find((item) => item.id === location.section)?.label ?? "Overview"]
  if (location.section === "companies") return ["Companies", SAAS_COMPANIES.find((item) => item.id === location.recordId)?.name ?? "Company"]
  if (location.section === "funds") return ["Funds", SAAS_FUNDS.find((item) => item.id === location.recordId)?.name ?? "Fund"]
  if (location.section === "threads") return ["Threads", SAAS_THREADS.find((item) => item.id === location.recordId)?.title ?? "Thread"]
  if (location.section === "artifacts") return ["Artifacts", SAAS_ARTIFACTS.find((item) => item.id === location.recordId)?.name ?? "File"]
  return ["Overview"]
}

function ChatColumn({ location, onClose, navigate }: { location: SaasLocation; onClose: () => void; navigate: (location: SaasLocation) => void }) {
  const [draft, setDraft] = useState("")
  const company = location.section === "companies" && location.recordId ? SAAS_COMPANIES.find((item) => item.id === location.recordId) : undefined
  const fund = location.section === "funds" && location.recordId ? SAAS_FUNDS.find((item) => item.id === location.recordId) : undefined
  const artifact = location.section === "artifacts" && location.recordId ? SAAS_ARTIFACTS.find((item) => item.id === location.recordId) : undefined
  const thread = location.section === "threads" && location.recordId ? SAAS_THREADS.find((item) => item.id === location.recordId) : undefined
  const contextLabel = company?.name ?? fund?.name ?? artifact?.name ?? thread?.title
  const title = company ? `Thread: ${company.name} diligence` : fund ? `Thread: ${fund.name} brief` : artifact ? `Ask about ${artifact.name}` : thread ? thread.title : "Chat"
  const suggestions = company
    ? ["Summarize latest filings", "What changed since last update?", "Draft questions for management"]
    : fund
      ? ["Summarize portfolio risk", "Compare company momentum", "Draft the quarterly review"]
      : artifact
        ? ["Summarize this document", "Extract the key risks", "Compare with prior materials"]
        : thread
          ? ["Summarize where we are", "What needs my decision?", "Show the supporting evidence"]
          : ["Review portfolio changes", "Show everything that needs me", "Start Acme diligence"]
  return (
    <aside className="flex min-h-0 flex-col border-l border-border/70 bg-[color:var(--surface-chat)]" data-boring-workspace-part="saas-contextual-chat">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3"><span className="grid size-7 place-items-center rounded-full bg-foreground/[0.07] text-foreground"><Icon name="spark" className="size-3.5" /></span><div className="min-w-0 flex-1"><h2 className="truncate text-[13px] font-semibold text-foreground">{title}</h2><p className="text-[11px] text-muted-foreground">Context follows your current view</p></div><Button variant="ghost" size="icon-xs" aria-label="Close chat" onClick={onClose}><Icon name="close" /></Button></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {contextLabel ? <Chip className="max-w-full"><Icon name={company ? "companies" : fund ? "funds" : artifact ? "file" : "threads"} className="size-3" /><span className="truncate">{contextLabel}</span></Chip> : null}
        {location.section === "overview" && !location.recordId ? <div className="mt-1"><p className="text-sm font-medium text-foreground">Continue a thread</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Pick up existing work, or start with the whole portfolio in view.</p><div className="mt-4 divide-y divide-border/60 border-y border-border/60">{SAAS_THREADS.slice(0, 3).map((item) => <button key={item.id} type="button" onClick={() => navigate({ section: "threads", recordId: item.id })} className="group flex w-full items-center gap-2 py-3 text-left"><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{item.title}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{item.updatedAt}</span></span><StatusBadge tone={statusTone(item.status)} className="text-[10px]">{item.status}</StatusBadge><Icon name="chevron" className="size-3 text-muted-foreground/40" /></button>)}</div><Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => setDraft("Start a new thread about ")}>Start a new thread</Button></div> : <div className="mt-8"><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70"><span className="size-1.5 rounded-full bg-success" />Agent ready</div><p className="mt-3 text-sm leading-6 text-foreground">I have the current record and its linked artifacts in context. What would you like to understand or produce?</p></div>}
        <div className="mt-8"><p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Suggested</p><div className="mt-2 flex flex-col gap-2">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => setDraft(suggestion)} className="rounded-lg border border-border/70 bg-background px-3 py-2.5 text-left text-xs leading-5 text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{suggestion}</button>)}</div></div>
      </div>
      <div className="shrink-0 border-t border-border/70 p-3"><div className="rounded-xl border border-border/80 bg-background focus-within:ring-2 focus-within:ring-ring/30"><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} placeholder="Ask in this context…" className="min-h-20 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0 dark:bg-transparent" /><div className="flex items-center justify-between gap-2 px-2 pb-2"><span className="text-[10px] text-muted-foreground/65">Fixture · composer visual only</span><Button size="icon-xs" disabled aria-label="Send fixture message"><Icon name="arrow" className="size-3" /></Button></div></div></div>
    </aside>
  )
}

export function SaasSpike() {
  const [location, setLocation] = useState<SaasLocation>({ section: "overview" })
  const [chatOpen, setChatOpen] = useState(false)
  const crumbs = breadcrumb(location)
  const navigate = (next: SaasLocation) => setLocation(next)
  const company = location.section === "companies" && location.recordId ? SAAS_COMPANIES.find((item) => item.id === location.recordId) : undefined
  const fund = location.section === "funds" && location.recordId ? SAAS_FUNDS.find((item) => item.id === location.recordId) : undefined
  const thread = location.section === "threads" && location.recordId ? SAAS_THREADS.find((item) => item.id === location.recordId) : undefined
  const artifact = location.section === "artifacts" && location.recordId ? SAAS_ARTIFACTS.find((item) => item.id === location.recordId) : undefined

  let content: ReactNode
  if (location.section === "overview") content = <OverviewView navigate={navigate} />
  else if (location.section === "companies") content = company ? <CompanyView company={company} navigate={navigate} openChat={() => setChatOpen(true)} /> : <CompaniesView openCompany={(recordId) => navigate({ section: "companies", recordId })} />
  else if (location.section === "funds") content = fund ? <FundView fund={fund} navigate={navigate} openChat={() => setChatOpen(true)} /> : <FundsView openFund={(recordId) => navigate({ section: "funds", recordId })} />
  else if (location.section === "threads") content = thread ? <ThreadView thread={thread} navigate={navigate} /> : <ThreadsView openThread={(recordId) => navigate({ section: "threads", recordId })} openChat={() => setChatOpen(true)} />
  else content = <ArtifactsView selected={artifact} openArtifact={(recordId) => navigate({ section: "artifacts", recordId })} />

  return (
    <div className={`saas-spike-shell ${chatOpen ? "saas-spike-shell--chat-open" : ""}`} data-chat-open={chatOpen ? "true" : "false"} data-boring-workspace-part="saas-spike">
      <aside className="flex min-h-0 flex-col border-r border-border/70 bg-[color:var(--surface-workbench-left)] px-2 py-3">
        <div className="flex h-10 items-center gap-2 px-2"><span className="grid size-6 place-items-center rounded-md bg-foreground text-[11px] font-bold text-background">M</span><span className="text-sm font-semibold tracking-[-0.015em] text-foreground">Meridian</span></div>
        <nav aria-label="Main navigation" className="mt-5 flex flex-col gap-0.5">{navItems.map((item) => <button key={item.id} type="button" aria-current={location.section === item.id ? "page" : undefined} onClick={() => navigate({ section: item.id })} className="group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-[current=page]:bg-foreground/[0.07] aria-[current=page]:font-medium aria-[current=page]:text-foreground"><Icon name={item.id} className="size-3.5 shrink-0" /><span className="truncate">{item.label}</span>{item.id === "threads" && SAAS_THREADS.some((value) => value.status === "Needs you") ? <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">2</span> : null}</button>)}</nav>
        <div className="mt-auto border-t border-border/60 pt-3"><div className="flex items-center gap-2 px-2 py-2"><span className="grid size-7 place-items-center rounded-full bg-foreground/[0.09] text-[10px] font-semibold text-foreground">AK</span><span className="min-w-0"><span className="block truncate text-xs font-medium text-foreground">Alex Kim</span><span className="block truncate text-[10px] text-muted-foreground">Investment team</span></span></div></div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/70 px-4"><div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">{crumbs.map((crumb, index) => <span key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-1.5">{index > 0 ? <span className="text-muted-foreground/40">/</span> : null}{index === 0 && crumbs.length > 1 ? <button type="button" onClick={() => navigate({ section: location.section })} className="truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{crumb}</button> : <span className={index === crumbs.length - 1 ? "truncate font-medium text-foreground" : "truncate"}>{crumb}</span>}</span>)}</div><span className="hidden rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:inline-flex">Fixture data</span><Button variant={chatOpen ? "secondary" : "outline"} size="sm" aria-pressed={chatOpen} onClick={() => setChatOpen((current) => !current)}><Icon name="chat" />{chatOpen ? "Close chat" : "Chat"}</Button></header>
        <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
      </main>
      {chatOpen ? <ChatColumn location={location} onClose={() => setChatOpen(false)} navigate={navigate} /> : null}
    </div>
  )
}
