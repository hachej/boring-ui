export type Tone = "success" | "warning" | "danger" | "neutral" | "info"

export interface PortLink {
  port: number
  text?: string
}

export interface VisualProof {
  url: string
  kind: "image" | "video" | "link"
  title: string
  author?: string
  postedAt?: string
  isAgentGenerated: boolean
  context?: string
}

export interface DiffFile {
  path: string
  additions: number
  deletions: number
  changeType?: string
  bucket?: string
  patch?: string
}

export interface DiffBucket {
  name: string
  additions: number
  deletions: number
  files: number
}

export interface DiffSummary {
  additions: number
  deletions: number
  changedFiles: number
  files: DiffFile[]
  buckets: DiffBucket[]
}

export interface PullRequest {
  number: number
  title: string
  url: string
  author: string
  headRefName: string
  baseRefName: string
  createdAt?: string
  updatedAt?: string
  isDraft: boolean
  reviewDecision?: string | null
  mergeStateStatus?: string | null
  labels: string[]
  topic: string
  statusTag: string
  statusTone: Tone
  checkSummary: { total: number; passed: number; pending: number; failed: number }
  diffSummary?: DiffSummary
  ports: PortLink[]
  visualProofs: VisualProof[]
}

export interface AssociatedPr {
  number: number
  title: string
  url: string
  statusTag?: string
  isDraft?: boolean
}

export interface IssueCard {
  number: number
  title: string
  url: string
  author: string
  createdAt?: string
  updatedAt?: string
  labels: string[]
  body?: string
  column: "to-plan" | "to-review" | "to-merge" | "bclaw-ready"
  difficulty?: "easy" | "needs-plan"
  bclawSessionId?: string
  associatedPrs?: AssociatedPr[]
}

export interface PrData {
  ok: boolean
  repo?: string
  generatedAt: string
  prs: PullRequest[]
  issues?: IssueCard[]
  error?: string
}
