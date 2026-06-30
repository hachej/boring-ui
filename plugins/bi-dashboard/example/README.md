# BI dashboard demo workspace

This directory is a tiny workspace fixture for the BI dashboard plugin.

- `data/people.csv` — sample tabular data.
- `dashboards/people.dashboard.json` — dashboard spec that reads the CSV through `data.v1.query.run`.
- `eval/bi-dashboard.yaml` — authoring eval prompt for dashboard generation.
- `.pi/extensions/bi-dashboard` — tiny workspace-local front extension that re-exports `@hachej/boring-bi-dashboard/front` for manual browser testing with external plugins enabled.

For live data queries in browser testing, the host must also load the trusted `@hachej/data-bridge` server plugin; the plugin-local eval runner does this automatically.
