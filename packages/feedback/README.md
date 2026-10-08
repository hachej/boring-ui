# @hachej/boring-feedback

Feedback reports, storage, placement, and optional UI and native agent adapters.
This package is under development and is not yet qualified for npm release.

Import the capability you need. There is no root export.

- `@hachej/boring-feedback/format` defines report data.
- `@hachej/boring-feedback/store` reads and conditionally publishes reports.
- `@hachej/boring-feedback/page` captures page observations.
- `@hachej/boring-feedback/ui` supplies React controls.
- `@hachej/boring-feedback/agent` supplies the optional native Pi adapter.
- `@hachej/boring-feedback/preview` and `@hachej/boring-feedback/tickets` supply integrations.
- `@hachej/boring-feedback/source` and `@hachej/boring-feedback/source/jsx-dev-runtime` supply source attribution.

The host owns authorization, storage, and capture policy. Feedback cannot grant
access or establish publication evidence. See the included [feedback laws](INVARIANTS.md)
and the [design](https://github.com/hachej/boring-ui/blob/main/docs/architecture/FEEDBACK.md).

Install the optional peers required by the selected entry. The package manifest
lists pinned versions. Node.js 22.19.0 or later is required for Node adapters.
