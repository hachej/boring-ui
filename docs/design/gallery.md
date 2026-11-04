# Design system gallery

`npm run design:gallery` builds `.cache/design-system.html`: one self-contained page (inline JS and CSS, Geist and Geist Mono embedded as data URIs when the `@fontsource-variable` packages are found, else system fonts) that renders the real kit: registry blocks and the shadcn parts they use. Nothing is hand-drawn.

- Source: `lab/design-system/` (`build.mjs` bundles `gallery.tsx`; `kit.tsx` holds the labelled slots; `foundations.tsx`, `level1.tsx`, `sections.tsx` are the sections; `gallery.css` holds the default style v1 tokens).
- Sections: Foundations, Level 1 (generic), Chat, Tasks, PM and annotation, Agent layouts.
- Each component carries a label: the block name and the tokens it reads.
- A block that cannot render standalone shows a labelled placeholder with the reason. Those are listed in the page itself.
- Light and dark: the toggle in the header (or `?dark=1`). Embedded frames (the app shell, floating windows) get their own viewport through an iframe.
- Fictional data only.
