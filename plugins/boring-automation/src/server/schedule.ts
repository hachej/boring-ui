// Schedule calculation and due-run triggering are intentionally deferred to the
// issue #590 seam-confirmation/scheduler slices. Slice 1 only establishes the
// plugin shell, persistence contract, and CRUD/run-metadata routes.
export {}
