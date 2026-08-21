export type FilePaneDocumentStatus =
  | { kind: "fallback" }
  | { kind: "checking" }
  | { kind: "updated"; source: "agent" | "disk" }
  | { kind: "conflict"; source: "agent" | "disk" }
  | { kind: "resolved"; action: "reloaded" | "overwritten" }
