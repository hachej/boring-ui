# Fictional anchored highlights

After `npm run build`, run `node examples/highlights/server.mjs` and open the
printed loopback URL. Add `?locale=fr` for the new French highlight controls.
The inherited Markdown editor keeps its existing English labels.

The host creates one SQLite workspace provider and serves its ordinary resource
read/publication/lookup handler. The document and `field-notes.md.marks.json`
sidecar use that same provider. A fresh process seeds fictional exact, ambiguous
and missing marks; it uses no model or external service. Data is ephemeral.

Run the browser proof:

```sh
TMPDIR=/var/tmp CHROMIUM=/path/to/chrome-headless-shell \
  systemd-run --user --scope -q -p MemoryMax=8G npm run highlights:journey
```

The journey covers desktop and 390px, FR/EN, light/dark, persisted candidate
choice, comment editing, a refused stale second-tab save, source selection and
removal without changing document bytes. Evidence lives under
`.cache/evidence/D78/`; phone emulation is not real-device qualification.

The registry block owns only its default store and borrows its controller and
workspace client. Use the host's authorization and durable provider in an app;
the example's short-lived fictional bearer is not production authentication.
