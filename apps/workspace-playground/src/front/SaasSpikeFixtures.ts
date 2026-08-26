import type { JobThreadEntry, JobThreadFixture } from "./JobThreadView"
import type { ExplorerDataSource, ExplorerItem, Facets } from "@hachej/boring-data-explorer/shared"

export interface SaasCompany {
  id: string
  name: string
  sector: string
  fundId: string
  stage: string
  headquarters: string
  ownership: string
  lastUpdate: string
  summary: string
  metrics: readonly { label: string; value: string }[]
  documentIds: readonly string[]
  threadIds: readonly string[]
}

export interface SaasFund {
  id: string
  name: string
  strategy: string
  vintage: string
  aum: string
  status: string
  lastUpdate: string
  summary: string
}

export interface SaasArtifact {
  id: string
  name: string
  path: readonly string[]
  kind: "PDF" | "Document" | "Spreadsheet"
  updatedAt: string
  summary: string
  companyId?: string
  fundId?: string
}

export interface SaasThread {
  id: string
  title: string
  subject: string
  status: "Needs you" | "Working" | "Complete"
  updatedAt: string
  companyIds: readonly string[]
  fundId?: string
  artifactIds: readonly string[]
  job: JobThreadFixture
}

export const SAAS_FUNDS: readonly SaasFund[] = [
  {
    id: "forge-industrial",
    name: "Forge Industrial Partners",
    strategy: "Industrial software & automation",
    vintage: "2024",
    aum: "$640M",
    status: "Investing",
    lastUpdate: "Today",
    summary: "Control and growth investments in software-led industrial businesses across North America.",
  },
  {
    id: "northstar-ventures",
    name: "Northstar Ventures III",
    strategy: "Enterprise & applied AI",
    vintage: "2023",
    aum: "$420M",
    status: "Investing",
    lastUpdate: "Yesterday",
    summary: "Early growth investments in durable enterprise workflows and applied intelligence.",
  },
  {
    id: "lantern-health",
    name: "Lantern Health Fund",
    strategy: "Care delivery & life sciences",
    vintage: "2022",
    aum: "$315M",
    status: "Harvesting",
    lastUpdate: "Aug 22",
    summary: "Healthcare companies with measurable clinical or operational leverage.",
  },
  {
    id: "arbor-climate",
    name: "Arbor Climate I",
    strategy: "Climate infrastructure",
    vintage: "2024",
    aum: "$280M",
    status: "Investing",
    lastUpdate: "Aug 20",
    summary: "Asset-light tools that accelerate deployment and operation of climate infrastructure.",
  },
  {
    id: "meridian-growth",
    name: "Meridian Growth II",
    strategy: "Vertical SaaS",
    vintage: "2021",
    aum: "$510M",
    status: "Monitoring",
    lastUpdate: "Aug 18",
    summary: "Concentrated growth positions in category-leading vertical software companies.",
  },
]

function companyArtifact(
  id: string,
  name: string,
  companyName: string,
  companyId: string,
  fundId: string,
  kind: SaasArtifact["kind"],
  summary: string,
): SaasArtifact {
  return {
    id,
    name,
    path: ["Companies", companyName],
    kind,
    updatedAt: "Aug 20, 12:00",
    summary,
    companyId,
    fundId,
  }
}

export const SAAS_ARTIFACTS: readonly SaasArtifact[] = [
  {
    id: "acme-q2-filing",
    name: "Q2 2026 filing.pdf",
    path: ["Companies", "Acme Corp"],
    kind: "PDF",
    updatedAt: "Today, 09:42",
    summary: "Quarterly filing with revenue mix, backlog movement, and updated customer concentration disclosures.",
    companyId: "acme-corp",
    fundId: "forge-industrial",
  },
  {
    id: "acme-diligence-notes",
    name: "Diligence notes.md",
    path: ["Companies", "Acme Corp"],
    kind: "Document",
    updatedAt: "Yesterday, 16:10",
    summary: "Working notes from management calls, product references, and the open diligence question list.",
    companyId: "acme-corp",
    fundId: "forge-industrial",
  },
  {
    id: "acme-customer-cohorts",
    name: "Customer cohorts.csv",
    path: ["Companies", "Acme Corp"],
    kind: "Spreadsheet",
    updatedAt: "Aug 21, 11:26",
    summary: "Fixture cohort export covering logo retention and net revenue retention by customer vintage.",
    companyId: "acme-corp",
    fundId: "forge-industrial",
  },
  {
    id: "northline-product-brief",
    name: "Product brief.pdf",
    path: ["Companies", "Northline Robotics"],
    kind: "PDF",
    updatedAt: "Aug 22, 14:05",
    summary: "Overview of the autonomous inspection platform, deployment footprint, and current roadmap.",
    companyId: "northline-robotics",
    fundId: "forge-industrial",
  },
  {
    id: "luma-board-pack",
    name: "July board pack.pdf",
    path: ["Companies", "Luma Health"],
    kind: "PDF",
    updatedAt: "Aug 19, 08:55",
    summary: "Monthly operating review with patient growth, provider utilization, and runway scenarios.",
    companyId: "luma-health",
    fundId: "lantern-health",
  },
  companyArtifact(
    "northline-deployment-plan",
    "Deployment plan.md",
    "Northline Robotics",
    "northline-robotics",
    "forge-industrial",
    "Document",
    "Site-by-site deployment plan with implementation capacity, milestones, and operating dependencies.",
  ),
  companyArtifact(
    "luma-outcomes-cohorts",
    "Patient outcomes cohorts.csv",
    "Luma Health",
    "luma-health",
    "lantern-health",
    "Spreadsheet",
    "Fixture cohort export for engagement, clinical adherence, and program completion by customer.",
  ),
  companyArtifact(
    "kestrel-security-review",
    "Security review.pdf",
    "Kestrel AI",
    "kestrel-ai",
    "northstar-ventures",
    "PDF",
    "Enterprise security review covering data boundaries, model controls, and audit readiness.",
  ),
  companyArtifact(
    "kestrel-pipeline",
    "Enterprise pipeline.csv",
    "Kestrel AI",
    "kestrel-ai",
    "northstar-ventures",
    "Spreadsheet",
    "Opportunity-level pipeline fixture with sales stage, contract value, and expected close window.",
  ),
  companyArtifact(
    "fieldnote-customer-references",
    "Customer references.md",
    "Fieldnote",
    "fieldnote",
    "meridian-growth",
    "Document",
    "Reference-call notes from specialty contractors using Fieldnote across planning and field operations.",
  ),
  companyArtifact(
    "fieldnote-operating-model",
    "Q2 operating model.csv",
    "Fieldnote",
    "fieldnote",
    "meridian-growth",
    "Spreadsheet",
    "Fixture operating model with bookings, retention, hiring, and cash-efficiency assumptions.",
  ),
  companyArtifact(
    "daybreak-network-coverage",
    "Research network coverage.pdf",
    "Daybreak Bio",
    "daybreak-bio",
    "lantern-health",
    "PDF",
    "Map of participating oncology sites, patient access, and study capacity by geography.",
  ),
  companyArtifact(
    "daybreak-operations-metrics",
    "Clinical operations metrics.csv",
    "Daybreak Bio",
    "daybreak-bio",
    "lantern-health",
    "Spreadsheet",
    "Site activation, enrollment, and study-cycle metrics for the current research network.",
  ),
  companyArtifact(
    "tidegrid-asset-performance",
    "Asset performance review.pdf",
    "Tidegrid",
    "tidegrid",
    "arbor-climate",
    "PDF",
    "Fleet performance review covering dispatch availability, savings, and customer-level variance.",
  ),
  companyArtifact(
    "tidegrid-contract-pipeline",
    "Contract pipeline.csv",
    "Tidegrid",
    "tidegrid",
    "arbor-climate",
    "Spreadsheet",
    "Commercial pipeline fixture by asset class, managed megawatts, and expected activation date.",
  ),
  companyArtifact(
    "parcelworks-retention",
    "Retention analysis.pdf",
    "Parcelworks",
    "parcelworks",
    "meridian-growth",
    "PDF",
    "Logo and revenue retention analysis segmented by retailer size and implementation cohort.",
  ),
  companyArtifact(
    "parcelworks-pricing",
    "Pricing study.md",
    "Parcelworks",
    "parcelworks",
    "meridian-growth",
    "Document",
    "Pricing research and packaging recommendations for exception management and returns automation.",
  ),
  companyArtifact(
    "cinder-taxonomy",
    "Emissions taxonomy.pdf",
    "Cinder Carbon",
    "cinder-carbon",
    "arbor-climate",
    "PDF",
    "Product taxonomy and calculation boundaries across operational and supplier emissions data.",
  ),
  companyArtifact(
    "cinder-pipeline",
    "Pipeline update.csv",
    "Cinder Carbon",
    "cinder-carbon",
    "arbor-climate",
    "Spreadsheet",
    "Sales pipeline fixture with manufacturer segment, supplier count, and implementation scope.",
  ),
  companyArtifact(
    "quarry-architecture-review",
    "Architecture review.pdf",
    "Quarry Labs",
    "quarry-labs",
    "northstar-ventures",
    "PDF",
    "Technical review of governed event pipelines, workload isolation, and implementation complexity.",
  ),
  companyArtifact(
    "quarry-customer-cohorts",
    "Customer cohorts.csv",
    "Quarry Labs",
    "quarry-labs",
    "northstar-ventures",
    "Spreadsheet",
    "Customer retention and expansion by implementation cohort and data-volume band.",
  ),
  companyArtifact(
    "harbor-site-economics",
    "Site economics.pdf",
    "Harbor Clinical",
    "harbor-clinical",
    "lantern-health",
    "PDF",
    "Contribution economics and utilization ranges for community-based clinical trial sites.",
  ),
  companyArtifact(
    "harbor-trial-pipeline",
    "Trial pipeline.csv",
    "Harbor Clinical",
    "harbor-clinical",
    "lantern-health",
    "Spreadsheet",
    "Fixture opportunity pipeline by sponsor, therapeutic area, site count, and start window.",
  ),
  companyArtifact(
    "switchyard-reliability",
    "Reliability benchmark.pdf",
    "Switchyard",
    "switchyard",
    "forge-industrial",
    "PDF",
    "Benchmark of monitored-line uptime, alert precision, and avoided production interruptions.",
  ),
  companyArtifact(
    "switchyard-forecast",
    "2026 forecast.csv",
    "Switchyard",
    "switchyard",
    "forge-industrial",
    "Spreadsheet",
    "Fixture forecast with bookings, deployment timing, renewals, and capacity assumptions.",
  ),
  {
    id: "forge-ic-memo",
    name: "Investment committee memo.md",
    path: ["Funds", "Forge Industrial Partners"],
    kind: "Document",
    updatedAt: "Aug 23, 17:30",
    summary: "Portfolio construction memo with industrial software exposure, reserves, and current watch items.",
    fundId: "forge-industrial",
  },
  {
    id: "northstar-quarterly-review",
    name: "Q2 portfolio review.pdf",
    path: ["Funds", "Northstar Ventures III"],
    kind: "PDF",
    updatedAt: "Aug 20, 10:15",
    summary: "Quarterly review of company performance, follow-on pacing, and ownership targets.",
    fundId: "northstar-ventures",
  },
  {
    id: "market-map",
    name: "Vertical SaaS market map.csv",
    path: ["Shared", "Research"],
    kind: "Spreadsheet",
    updatedAt: "Aug 18, 15:40",
    summary: "Landscape of tracked vertical SaaS businesses by end market, scale, and ownership.",
  },
]

export const SAAS_COMPANIES: readonly SaasCompany[] = [
  {
    id: "acme-corp",
    name: "Acme Corp",
    sector: "Industrial software",
    fundId: "forge-industrial",
    stage: "Growth equity",
    headquarters: "Chicago, IL",
    ownership: "18.4%",
    lastUpdate: "Today",
    summary: "Workflow and operations software for distributed industrial maintenance teams.",
    metrics: [{ label: "ARR", value: "$48.2M" }, { label: "YoY growth", value: "31%" }, { label: "NRR", value: "118%" }],
    documentIds: ["acme-q2-filing", "acme-diligence-notes", "acme-customer-cohorts"],
    threadIds: ["acme-diligence", "forge-portfolio-review"],
  },
  {
    id: "northline-robotics",
    name: "Northline Robotics",
    sector: "Robotics",
    fundId: "forge-industrial",
    stage: "Series C",
    headquarters: "Pittsburgh, PA",
    ownership: "13.1%",
    lastUpdate: "Yesterday",
    summary: "Autonomous inspection systems for energy and heavy-industry environments.",
    metrics: [{ label: "ARR", value: "$21.6M" }, { label: "YoY growth", value: "44%" }, { label: "Deployments", value: "286" }],
    documentIds: ["northline-product-brief", "northline-deployment-plan"],
    threadIds: ["forge-portfolio-review"],
  },
  {
    id: "luma-health",
    name: "Luma Health",
    sector: "Digital health",
    fundId: "lantern-health",
    stage: "Series B",
    headquarters: "Boston, MA",
    ownership: "16.8%",
    lastUpdate: "Aug 22",
    summary: "Hybrid care platform for chronic-condition coaching and clinical monitoring.",
    metrics: [{ label: "ARR", value: "$16.8M" }, { label: "Patients", value: "84k" }, { label: "Runway", value: "24 mo" }],
    documentIds: ["luma-board-pack", "luma-outcomes-cohorts"],
    threadIds: ["lantern-thesis"],
  },
  {
    id: "kestrel-ai",
    name: "Kestrel AI",
    sector: "Applied AI",
    fundId: "northstar-ventures",
    stage: "Series B",
    headquarters: "New York, NY",
    ownership: "11.5%",
    lastUpdate: "Aug 21",
    summary: "Decision-support models for regulated commercial underwriting workflows.",
    metrics: [{ label: "ARR", value: "$13.4M" }, { label: "YoY growth", value: "76%" }, { label: "Customers", value: "38" }],
    documentIds: ["kestrel-security-review", "kestrel-pipeline"],
    threadIds: ["northstar-portfolio-review"],
  },
  {
    id: "fieldnote",
    name: "Fieldnote",
    sector: "Construction SaaS",
    fundId: "meridian-growth",
    stage: "Growth equity",
    headquarters: "Austin, TX",
    ownership: "9.7%",
    lastUpdate: "Aug 20",
    summary: "Planning and field-collaboration software for specialty contractors.",
    metrics: [{ label: "ARR", value: "$61.0M" }, { label: "YoY growth", value: "24%" }, { label: "NRR", value: "112%" }],
    documentIds: ["fieldnote-customer-references", "fieldnote-operating-model"],
    threadIds: ["meridian-portfolio-review"],
  },
  {
    id: "daybreak-bio",
    name: "Daybreak Bio",
    sector: "Life sciences",
    fundId: "lantern-health",
    stage: "Series C",
    headquarters: "San Diego, CA",
    ownership: "12.2%",
    lastUpdate: "Aug 19",
    summary: "Clinical data infrastructure for distributed oncology research networks.",
    metrics: [{ label: "ARR", value: "$19.1M" }, { label: "Sites", value: "127" }, { label: "Runway", value: "19 mo" }],
    documentIds: ["daybreak-network-coverage", "daybreak-operations-metrics"],
    threadIds: ["lantern-thesis"],
  },
  {
    id: "tidegrid",
    name: "Tidegrid",
    sector: "Energy software",
    fundId: "arbor-climate",
    stage: "Series B",
    headquarters: "Denver, CO",
    ownership: "14.0%",
    lastUpdate: "Aug 18",
    summary: "Grid orchestration software for commercial distributed-energy assets.",
    metrics: [{ label: "ARR", value: "$11.9M" }, { label: "MW managed", value: "940" }, { label: "YoY growth", value: "58%" }],
    documentIds: ["tidegrid-asset-performance", "tidegrid-contract-pipeline"],
    threadIds: ["climate-allocation"],
  },
  {
    id: "parcelworks",
    name: "Parcelworks",
    sector: "Logistics SaaS",
    fundId: "meridian-growth",
    stage: "Growth equity",
    headquarters: "Atlanta, GA",
    ownership: "10.6%",
    lastUpdate: "Aug 17",
    summary: "Shipment exception and returns automation for multi-channel retailers.",
    metrics: [{ label: "ARR", value: "$54.7M" }, { label: "YoY growth", value: "21%" }, { label: "NRR", value: "109%" }],
    documentIds: ["parcelworks-retention", "parcelworks-pricing"],
    threadIds: ["meridian-portfolio-review"],
  },
  {
    id: "cinder-carbon",
    name: "Cinder Carbon",
    sector: "Carbon accounting",
    fundId: "arbor-climate",
    stage: "Series A",
    headquarters: "Seattle, WA",
    ownership: "17.2%",
    lastUpdate: "Aug 16",
    summary: "Operational emissions data and supplier workflows for mid-market manufacturers.",
    metrics: [{ label: "ARR", value: "$6.3M" }, { label: "YoY growth", value: "89%" }, { label: "Customers", value: "71" }],
    documentIds: ["cinder-taxonomy", "cinder-pipeline"],
    threadIds: ["climate-allocation"],
  },
  {
    id: "quarry-labs",
    name: "Quarry Labs",
    sector: "Data infrastructure",
    fundId: "northstar-ventures",
    stage: "Series A",
    headquarters: "Toronto, ON",
    ownership: "15.4%",
    lastUpdate: "Aug 15",
    summary: "Governed event pipelines for high-volume enterprise analytics teams.",
    metrics: [{ label: "ARR", value: "$8.8M" }, { label: "YoY growth", value: "67%" }, { label: "Customers", value: "42" }],
    documentIds: ["quarry-architecture-review", "quarry-customer-cohorts"],
    threadIds: ["northstar-portfolio-review"],
  },
  {
    id: "harbor-clinical",
    name: "Harbor Clinical",
    sector: "Clinical operations",
    fundId: "lantern-health",
    stage: "Series B",
    headquarters: "Raleigh, NC",
    ownership: "8.9%",
    lastUpdate: "Aug 14",
    summary: "Site operations and patient logistics for community-based clinical trials.",
    metrics: [{ label: "ARR", value: "$14.2M" }, { label: "YoY growth", value: "37%" }, { label: "Sites", value: "93" }],
    documentIds: ["harbor-site-economics", "harbor-trial-pipeline"],
    threadIds: ["lantern-thesis"],
  },
  {
    id: "switchyard",
    name: "Switchyard",
    sector: "Industrial IoT",
    fundId: "forge-industrial",
    stage: "Series B",
    headquarters: "Milwaukee, WI",
    ownership: "12.7%",
    lastUpdate: "Aug 13",
    summary: "Edge monitoring and reliability analytics for discrete manufacturing lines.",
    metrics: [{ label: "ARR", value: "$17.5M" }, { label: "YoY growth", value: "39%" }, { label: "Sites", value: "214" }],
    documentIds: ["switchyard-reliability", "switchyard-forecast"],
    threadIds: ["forge-portfolio-review"],
  },
]

interface ThreadCopy {
  title: string
  status: string
  request: string
  research: string
  review: string
  update: string
  metric: string
  current: number
  target: number
}

function threadJob(copy: ThreadCopy): JobThreadFixture {
  const worker = "diligence-worker"
  const reviewer = "investment-reviewer"
  const entries: readonly JobThreadEntry[] = [
    { kind: "post", id: `${copy.title}-request`, turnOrdinal: 1, seq: 1, agentTypeId: "owner", phase: "settled", body: copy.request, relativeTime: "2h ago" },
    { kind: "post", id: `${copy.title}-research`, turnOrdinal: 2, seq: 7, agentTypeId: worker, phase: "settled", body: copy.research, relativeTime: "1h ago", toolCall: "read_artifacts" },
    { kind: "marker", id: `${copy.title}-handoff`, turnOrdinal: 2, seq: 7, markerOrdinal: 1, variant: "handoff", text: "Diligence worker → Investment reviewer: pressure-test the evidence" },
    { kind: "post", id: `${copy.title}-review`, turnOrdinal: 3, seq: 3, agentTypeId: reviewer, phase: "settled", body: copy.review, relativeTime: "48m ago" },
    { kind: "post", id: `${copy.title}-update`, turnOrdinal: 4, seq: 10, agentTypeId: worker, phase: "settled", body: copy.update, relativeTime: "24m ago" },
  ]
  return {
    title: copy.title,
    status: copy.status,
    objective: { metric: copy.metric, baseline: 0, current: copy.current, target: copy.target },
    participants: [
      { agentTypeId: "owner", name: "You", role: "owner" },
      { agentTypeId: worker, name: "Diligence Worker", role: "worker", sessionId: "sess_diligence" },
      { agentTypeId: reviewer, name: "Investment Reviewer", role: "reviewer", sessionId: "sess_review" },
    ],
    entries,
  }
}

export const SAAS_THREADS: readonly SaasThread[] = [
  {
    id: "acme-diligence",
    title: "Acme Corp diligence",
    subject: "Validate Q2 quality of revenue before Monday's partner meeting.",
    status: "Needs you",
    updatedAt: "12m ago",
    companyIds: ["acme-corp"],
    fundId: "forge-industrial",
    artifactIds: ["acme-q2-filing", "acme-diligence-notes", "acme-customer-cohorts"],
    job: threadJob({
      title: "Acme Corp diligence",
      status: "Waiting on you",
      request: "Read the latest Acme materials. Tell me whether the Q2 growth is durable and what I should press management on.",
      research: "The filing supports 31% ARR growth, but 42% of new ARR came from two expansions. Customer cohorts show stable logo retention and an NRR step-up concentrated in the 2024 vintage.",
      review: "The conclusion is directionally sound, but 'durable' is too strong without separating price uplift from seat expansion. The top-two expansion concentration is the real diligence item.",
      update: "I tightened the readout and added three management questions on expansion composition, renewal timing, and implementation capacity. The final memo is ready for your framing choice.",
      metric: "checks",
      current: 7,
      target: 9,
    }),
  },
  {
    id: "forge-portfolio-review",
    title: "Forge portfolio review",
    subject: "Prepare the industrial software watch list and reserve discussion.",
    status: "Working",
    updatedAt: "34m ago",
    companyIds: ["acme-corp", "northline-robotics", "switchyard"],
    fundId: "forge-industrial",
    artifactIds: ["forge-ic-memo", "northline-product-brief"],
    job: threadJob({
      title: "Forge portfolio review",
      status: "Working",
      request: "Build the short portfolio review: momentum, watch items, and where reserves may be needed.",
      research: "Acme leads on efficient growth, Northline leads on bookings but has deployment risk, and Switchyard's sales cycle stretched by 19 days. Existing reserves cover the base plan.",
      review: "Separate business risk from financing risk. Northline's deployments are operationally constrained; Switchyard is the only company with a plausible near-term reserve call.",
      update: "Updated the watch list and drafted a two-scenario reserve note for Switchyard. No action is recommended for Acme or Northline this quarter.",
      metric: "companies",
      current: 3,
      target: 3,
    }),
  },
  {
    id: "northstar-portfolio-review",
    title: "Northstar portfolio review",
    subject: "Compare applied-AI exposure and follow-on pacing.",
    status: "Complete",
    updatedAt: "Yesterday",
    companyIds: ["kestrel-ai", "quarry-labs"],
    fundId: "northstar-ventures",
    artifactIds: ["northstar-quarterly-review"],
    job: threadJob({
      title: "Northstar portfolio review",
      status: "Complete",
      request: "Compare Kestrel and Quarry on quality of growth and recommend follow-on priority.",
      research: "Kestrel has faster growth and clearer workflow ownership. Quarry has better gross retention but a longer enterprise implementation cycle and more services in revenue.",
      review: "Priority should reflect price and ownership, not growth alone. Kestrel is the stronger company; Quarry may be the better risk-adjusted follow-on at the current marks.",
      update: "Final comparison separates company quality from allocation attractiveness and includes ownership outcomes for both cases.",
      metric: "cases",
      current: 2,
      target: 2,
    }),
  },
  {
    id: "lantern-thesis",
    title: "Lantern healthcare thesis",
    subject: "Refresh the care-delivery thesis with current portfolio evidence.",
    status: "Needs you",
    updatedAt: "Aug 22",
    companyIds: ["luma-health", "daybreak-bio"],
    fundId: "lantern-health",
    artifactIds: ["luma-board-pack"],
    job: threadJob({
      title: "Lantern healthcare thesis",
      status: "Waiting on you",
      request: "Refresh our care-delivery thesis using Luma and Daybreak. Flag where the evidence is still thin.",
      research: "Luma supports the operating-leverage thesis through provider utilization; Daybreak supports distributed research access, but neither proves durable reimbursement advantage yet.",
      review: "Do not merge clinical workflow and reimbursement into one claim. The portfolio supports operational leverage, not a broad healthcare defensibility thesis.",
      update: "Reframed the thesis around operational leverage and left reimbursement as an explicit open question for the next expert call.",
      metric: "claims",
      current: 4,
      target: 5,
    }),
  },
  {
    id: "climate-allocation",
    title: "Climate allocation review",
    subject: "Compare deployment evidence across Arbor's software exposure.",
    status: "Working",
    updatedAt: "Aug 20",
    companyIds: ["tidegrid", "cinder-carbon"],
    fundId: "arbor-climate",
    artifactIds: ["tidegrid-asset-performance", "cinder-taxonomy", "market-map"],
    job: threadJob({
      title: "Climate allocation review",
      status: "Working",
      request: "Compare Tidegrid and Cinder on deployment evidence and tell me where another dollar has the strongest proof behind it.",
      research: "Tidegrid has stronger realized deployment evidence across 940 managed megawatts. Cinder is growing faster, but its supplier workflows are earlier and depend on customer-led adoption.",
      review: "Keep company quality separate from allocation timing. Tidegrid has the stronger proof today; Cinder may still have the larger upside if supplier activation holds.",
      update: "Built a staged allocation view: reserve near-term follow-on capacity for Tidegrid and make Cinder conditional on two supplier-activation milestones.",
      metric: "milestones",
      current: 4,
      target: 6,
    }),
  },
  {
    id: "meridian-portfolio-review",
    title: "Meridian portfolio review",
    subject: "Refresh retention and pricing evidence across vertical SaaS holdings.",
    status: "Complete",
    updatedAt: "Aug 18",
    companyIds: ["fieldnote", "parcelworks"],
    fundId: "meridian-growth",
    artifactIds: ["fieldnote-operating-model", "parcelworks-retention", "market-map"],
    job: threadJob({
      title: "Meridian portfolio review",
      status: "Complete",
      request: "Compare Fieldnote and Parcelworks on retention durability and pricing headroom for the quarterly review.",
      research: "Fieldnote has the stronger expansion profile at 112% NRR. Parcelworks is steadier by logo but its current packaging leaves less room for price without deeper workflow adoption.",
      review: "The evidence supports a pricing experiment at Fieldnote, not a broad portfolio conclusion. Parcelworks should prove returns-module engagement before changing packaging.",
      update: "Final review recommends one bounded Fieldnote pricing test and holds Parcelworks pricing until the next engagement cohort matures.",
      metric: "reviews",
      current: 2,
      target: 2,
    }),
  },
]

// ---------------------------------------------------------------------------
// RE-COMPOSITION LAYER (owner correction, 2026-08-26)
//
// The spike no longer hand-rolls tables/tree/shell. It feeds the SAME fixture
// records above into the components that already exist:
//
//   - Companies / Funds  -> `DataExplorer` from `@hachej/boring-data-explorer`,
//     mounted as workbench workspace SOURCES via `createDataCatalogPlugin`.
//     That plugin takes an injected `ExplorerDataSource`, never a backend, so
//     the adapters below are the whole integration.
//   - Files              -> the real `filesystemPlugin` file tree against the
//     live playground agent API. Not fixture-fed; it browses the actual
//     `apps/workspace-playground/workspace` directory.
//
// HONEST LIMITATION, stated once: `DataExplorer` is a faceted LIST (leading
// badge, title, subtitle, trailing badges, right-aligned meta), not a columnar
// grid. There is no columnar table primitive anywhere in `packages/ui` or in
// either data plugin. So "Companies" reads as a searchable, facet-filtered list
// rather than the Company|Sector|Fund|Last-update table the bespoke version
// drew. That is a real loss of column scannability and a real gain of search +
// facets; it is the shape the existing building block actually has.
// ---------------------------------------------------------------------------


/**
 * Minimal in-memory `ExplorerDataSource`.
 *
 * `plugins/data-explorer/src/front/fixtureAdapters.ts` has the same helper, but
 * only its two prebuilt `createMock*Adapter()` factories are exported — the
 * generic `makeAdapter` is private. This is that helper, narrowed to what the
 * spike needs, so the spike stays on the plugin's public contract.
 */
function fixtureAdapter(
  rows: readonly ExplorerItem[],
  extractFacets: (row: ExplorerItem) => Record<string, string>,
): ExplorerDataSource {
  const matches = (row: ExplorerItem, filters: Record<string, string[]>): boolean => {
    const values = extractFacets(row)
    for (const [key, selected] of Object.entries(filters)) {
      if (!selected.length) continue
      if (!selected.includes(values[key] ?? "")) return false
    }
    return true
  }
  return {
    async search(args) {
      let pool = [...rows]
      if (args.group) pool = pool.filter((row) => extractFacets(row)[args.group!.key] === args.group!.value)
      if (args.query) {
        const query = args.query.toLowerCase()
        pool = pool.filter((row) => (
          row.title.toLowerCase().includes(query) || (row.subtitle?.toLowerCase().includes(query) ?? false)
        ))
      }
      pool = pool.filter((row) => matches(row, args.filters))
      const slice = pool.slice(args.offset, args.offset + args.limit)
      return { items: slice, total: pool.length, hasMore: args.offset + slice.length < pool.length }
    },
    async fetchFacets(args) {
      const pool = rows.filter((row) => matches(row, args.filters))
      const facets: Facets = {}
      for (const row of pool) {
        for (const [key, value] of Object.entries(extractFacets(row))) {
          if (!value) continue
          const bucket = (facets[key] ??= [])
          const existing = bucket.find((entry) => entry.value === value)
          if (existing) existing.count += 1
          else bucket.push({ value, count: 1 })
        }
      }
      return facets
    },
  }
}

const fundNameById = new Map(SAAS_FUNDS.map((fund) => [fund.id, fund.name]))

const COMPANY_ROWS: readonly ExplorerItem[] = SAAS_COMPANIES.map((company) => ({
  id: company.id,
  title: company.name,
  subtitle: `${company.sector} · ${company.stage}`,
  leading: { code: company.name.slice(0, 2).toUpperCase(), tooltip: company.name },
  trailing: [{ code: fundNameById.get(company.fundId) ?? company.fundId, tooltip: "Fund" }],
  meta: company.lastUpdate,
}))

const FUND_ROWS: readonly ExplorerItem[] = SAAS_FUNDS.map((fund) => ({
  id: fund.id,
  title: fund.name,
  subtitle: `${fund.strategy} · ${fund.vintage} vintage`,
  leading: { code: fund.name.slice(0, 2).toUpperCase(), tooltip: fund.name },
  trailing: [{ code: fund.status, tooltip: "Status" }],
  meta: fund.aum,
}))

const companyById = new Map(SAAS_COMPANIES.map((company) => [company.id, company]))
const fundById = new Map(SAAS_FUNDS.map((fund) => [fund.id, fund]))

export const SAAS_COMPANY_ADAPTER: ExplorerDataSource = fixtureAdapter(COMPANY_ROWS, (row): Record<string, string> => {
  const company = companyById.get(row.id)
  if (!company) return {}
  return { sector: company.sector, stage: company.stage, fund: fundNameById.get(company.fundId) ?? "" }
})

export const SAAS_FUND_ADAPTER: ExplorerDataSource = fixtureAdapter(FUND_ROWS, (row): Record<string, string> => {
  const fund = fundById.get(row.id)
  if (!fund) return {}
  return { strategy: fund.strategy, vintage: fund.vintage, status: fund.status }
})

export const SAAS_COMPANY_FACETS = [
  { key: "sector", label: "Sector" },
  { key: "fund", label: "Fund" },
  { key: "stage", label: "Stage" },
]

export const SAAS_FUND_FACETS = [
  { key: "strategy", label: "Strategy" },
  { key: "vintage", label: "Vintage" },
  { key: "status", label: "Status" },
]

// ---------------------------------------------------------------------------
// LIBRARY: saved views (owner refinement #2)
//
// The Library is a VIEW library, not a file list. Its entries follow the
// ratified `ViewDescriptor` vocabulary (`docs/plans/long-term/inbox/
// 2026-08-17-part1-chatgpt-synthesis.md`): a view is `{ kind, title, subject?,
// query?, state? }` and `kind` is the semantic shape the agent reasons in
// (collection / document / dashboard / kanban / chart), never a Dockview id.
//
// The architecture point the spike has to make VISIBLE: the rail TOOL and the
// Library ENTRY open the SAME component over the SAME fixture module. So the
// `collection` entries below carry the very panel id that
// `createDataCatalogPlugin` registers for the matching rail source — clicking
// either path lands on one panel instance, not two lookalikes.
// ---------------------------------------------------------------------------

export type SaasViewKind = "collection" | "document" | "dashboard" | "kanban" | "chart"

export interface SaasSavedView {
  id: string
  title: string
  kind: SaasViewKind
  /** Registered panel component id this view opens. */
  panel: string
  params?: Record<string, unknown>
  /** Why this entry exists, shown as the row's quiet subtitle. */
  note: string
}

export const SAAS_SAVED_VIEWS: readonly SaasSavedView[] = [
  {
    id: "view-companies",
    title: "Companies",
    kind: "collection",
    panel: "saas-companies-visualization",
    note: "same panel as the rail tool",
  },
  {
    id: "view-funds",
    title: "Funds",
    kind: "collection",
    panel: "saas-funds-visualization",
    note: "same panel as the rail tool",
  },
  {
    id: "view-portfolio-overview",
    title: "Portfolio overview",
    kind: "dashboard",
    panel: "saas-overview",
    note: "portfolio stat tiles",
  },
  {
    id: "view-diligence-pipeline",
    title: "Diligence pipeline",
    kind: "kanban",
    panel: "saas-kanban-placeholder",
    note: "placeholder — not built yet",
  },
]

// ---------------------------------------------------------------------------
// WORK > Automations, and the AGENTS roster (owner refinement #3).
// ---------------------------------------------------------------------------

export interface SaasAutomation {
  id: string
  title: string
  cadence: string
  lastRun: string
}

/**
 * Fixture rows, deliberately.
 *
 * `plugins/boring-automation` exists and its `AutomationCard`/`AutomationPanel`
 * are real, but (a) the plugin is not a `workspace-playground` dependency, so
 * using it means a dependency add + a `build:deps` change + a dev-server
 * restart, and (b) its components are panel-sized cards driven by `client.ts`
 * against a live automation backend — the wrong shape for a nav sub-group row
 * even if it were wired. So Automations are quiet nav rows here, and the
 * plugin stays un-integrated. Called out rather than hidden.
 */
export const SAAS_AUTOMATIONS: readonly SaasAutomation[] = [
  { id: "weekly-digest", title: "Weekly portfolio digest", cadence: "Mondays 07:00", lastRun: "2d ago" },
  { id: "filing-watch", title: "Filing watch — Forge Industrial", cadence: "On new filing", lastRun: "6h ago" },
  { id: "reserve-check", title: "Reserve pacing check", cadence: "Month end", lastRun: "12d ago" },
]

export interface SaasAgent {
  id: string
  name: string
  role: string
  status: "Idle" | "Working" | "Needs you"
  threadIds: readonly string[]
}

export const SAAS_AGENTS: readonly SaasAgent[] = [
  { id: "analyst", name: "Analyst", role: "Reads filings and builds the evidence base", status: "Working", threadIds: ["acme-diligence", "forge-portfolio-review"] },
  { id: "reviewer", name: "Reviewer", role: "Challenges conclusions before they reach you", status: "Needs you", threadIds: ["acme-diligence"] },
  { id: "scribe", name: "Scribe", role: "Drafts memos and meeting material", status: "Idle", threadIds: ["forge-portfolio-review"] },
]
