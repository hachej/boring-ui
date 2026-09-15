# Research and source register

Initial research reviewed on **2026-09-11**; user profiling and solution exploration extended on **2026-09-12**. Individual review dates are recorded below. This is focused web research for an expert-to-software agent, not a systematic literature review.

## Contents

- [Method](#method)
- [Synthesis and limits](#synthesis-and-limits)
- [Maintenance](#maintenance)
- [Sources](#sources)

## Method

Searches covered product discovery, expert knowledge elicitation, jobs-to-be-done, story mapping, requirements engineering, validation, delivery, and the tools an expert-facing agent needs. Primary sources were preferred: method originators, original research, government practice guidance, standards bodies, upstream code, and official provider documentation. Both web search engines were used; targeted primary pages supplied the strongest material. Some broad searches returned weak results, which were excluded.

Pages were opened and relevant sections inspected. For ACTA, the abstract and selected scanned method pages were reviewed, not the entire paper. Boring UI files were read through GitHub and linked to the inspected default-branch revision. Search-engine crawl dates were not treated as publication dates.

The knowledge base paraphrases a small set of principles and adds original Boring PM procedures, examples, schemas, and decision rules. No copyrighted articles or book chapters are reproduced. The source register distinguishes research evidence from practitioner guidance and vendor capability documentation.

## Synthesis and limits

The combined approach is to understand the person and actual work, expose expert judgment, compare solutions for the intended users and available support, trace decisions into testable behavior, and validate through use. This combined agent protocol has **not** been empirically validated. Numeric defaults, workflow stages, gate definitions, profile fields and adaptation rules, solution-fit criteria, tool priorities, and the fictional product example are Boring PM design proposals.

The Mom Test's official site was reviewed as additional context, but only its public overview was accessible in this pass; specific book rules are not treated as verified evidence here. No claim is made to have surveyed all PM methods, read every referenced book, or tested the third-party integrations.

Keep public method sources separate from project evidence. Tool access in the authoring session is also separate from capability in a future Boring PM deployment.

## Maintenance

Recheck provider/framework contracts before implementation and after version changes. Review method links when revising the corresponding module. Keep stable source IDs; record replacements rather than silently assigning an old ID to a different work. The machine-readable register is [sources.json](sources.json).

## Sources

### S01

**[The Four Big Risks](https://www.svpg.com/four-big-risks/)** — Marty Cagan / Silicon Valley Product Group. Type: `author_practitioner`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Distinguishes value, usability, feasibility, and business viability risks.

Limit: A practitioner framework; not causal proof that a specific discovery process produces success.

### S02

**[Using in-depth interviews](https://www.gov.uk/service-manual/user-research/using-in-depth-interviews)** — GOV.UK Service Manual / User research community. Type: `public_service_guidance`. Reviewed: 2026-09-12. Access: `full_page`.

Principle: Use a discussion guide, neutral questions, concrete examples, and clarification.

Limit: Qualitative interview guidance; an interview account is not independent behavioral observation.

### S03

**[Contextual research and observation](https://www.gov.uk/service-manual/user-research/contextual-research-and-observation)** — GOV.UK Service Manual / User research community. Type: `public_service_guidance`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Observe tasks in context, including real tools, documents, and barriers.

Limit: Observed situations may not represent all users or cases.

### S04

**[Applied cognitive task analysis (ACTA): a practitioner's toolkit for understanding cognitive task demands](https://pubmed.ncbi.nlm.nih.gov/9819578/)** — Laura G. Militello and Robert J. B. Hutton. Type: `research_paper`. Reviewed: 2026-09-11. Access: `abstract_and_selected_paper_pages`.

Principle: A task diagram, knowledge audit, and simulation interview help expose cognitive demands for design.

Limit: 1998 study in particular settings; Boring PM's adapted questions and agent implementation have not been validated by this study.

Original paper: DOI 10.1080/001401398186108; [selected PDF pages](https://web.mit.edu/16.459/www/Militello98.pdf). Scanned paper introduction and method sections; PDF pages 3–4 (1-based), plus PubMed abstract.

### S05

**[Customer Interviews: How to Recruit, What to Ask, and How to Synthesize What You Learn](https://www.producttalk.org/customer-interviews/)** — Teresa Torres / Product Talk. Type: `author_practitioner`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Select participants relevant to the product's user or customer roles and recover specific accounts.

Limit: Recruitment and story-based interviewing practices do not establish prevalence or willingness to buy by themselves.

### S06

**[Jobs to Be Done Theory](https://www.christenseninstitute.org/theory/jobs-to-be-done/)** — Clayton Christensen Institute. Type: `theory_originator_institution`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Understand desired progress and the circumstances and functional, social, and emotional forces behind choices.

Limit: A useful explanatory lens, not a complete requirements or market-validation process.

### S07

**[Opportunity Solution Trees: Visualize Your Discovery to Stay Aligned and Drive Outcomes](https://www.producttalk.org/opportunity-solution-trees/)** — Teresa Torres / Product Talk. Type: `author_practitioner`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Connect an outcome with opportunities, alternative solutions, and tests.

Limit: Do not invent opportunities to fill a tree. A provisional map is not validated demand.

### S08

**[Discovering Solutions: Quickly Determine Which Ideas Will Work (And Which Won't)](https://www.producttalk.org/discovering-solutions/)** — Teresa Torres / Product Talk. Type: `author_practitioner`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Interviewing uncovers opportunities; assumption testing evaluates proposed solutions.

Limit: Method description includes course promotion; use the conceptual distinction without treating it as comparative experimental evidence.

### S09

**[The New User Story Backlog is a Map](https://jpattonassociates.com/the-new-backlog/)** — Jeff Patton. Type: `author_practitioner`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Keep the user's overall activity visible while organizing smaller deliverable stories.

Limit: A mapping technique does not determine the correct product scope automatically.

### S10

**[Set Boundaries — Shape Up](https://basecamp.com/shapeup/1.2-chapter-03)** — Ryan Singer / Basecamp. Type: `author_practitioner`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Set an appetite for the work and adjust scope to fit it.

Limit: Basecamp's team sizes and cycle lengths are contextual; Boring PM does not mandate them.

### S11

**[RICE: Simple prioritization for product managers](https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/)** — Sean McBride / Intercom. Type: `author_practitioner`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Compare reach, impact, confidence, and effort with consistent units.

Limit: Scores depend on input quality and do not override essential dependencies or uncertainty.

### S12

**[Appendix C: How to Write a Good Requirement](https://www.nasa.gov/reference/appendix-c-how-to-write-a-good-requirement/)** — NASA Systems Engineering Handbook. Type: `engineering_guidance`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Use clear, singular, verifiable statements and explicitly manage assumptions and unresolved values.

Limit: Adapt the rigor to software scope; this repository does not claim NASA certification or standards compliance.

### S13

**[4.2 Technical Requirements Definition](https://www.nasa.gov/reference/4-2-technical-requirements-definition/)** — NASA Systems Engineering Handbook. Type: `engineering_guidance`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Check stakeholder alignment, traceability, assumptions, technical feasibility, and verifiability.

Limit: The source describes systems engineering; Boring PM's small-product artifact chain is an adaptation.

### S14

**[Example Mapping](https://cucumber.io/docs/bdd/example-mapping/)** — Cucumber Open Source Project. Type: `official_method_documentation`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Separate a story's rules, concrete examples, and unresolved questions.

Limit: Examples clarify behavior but do not prove code exists or works.

### S15

**[Gherkin Reference](https://cucumber.io/docs/gherkin/reference/)** — Cucumber Open Source Project. Type: `official_technical_documentation`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Scenarios describe context, an event, and observable expected results.

Limit: Text scenarios need step definitions, assertions, and execution before they provide test evidence.

### S16

**[Using moderated usability testing](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing)** — GOV.UK Service Manual / User research community. Type: `public_service_guidance`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Observe actual or likely users attempting relevant tasks with prototypes or services.

Limit: A small usability study identifies issues; it does not demonstrate broad demand or long-term impact.

### S17

**[Measuring the success of your service](https://www.gov.uk/service-manual/measuring-success/measuring-the-success-of-your-service)** — GOV.UK Service Manual / Performance analysis community. Type: `public_service_guidance`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Combine performance data and user research, including complete journey assessment.

Limit: Metrics need a task-specific definition, comparable baseline, and interpretation.

### S18

**[WCAG 2 Overview](https://www.w3.org/WAI/standards-guidelines/wcag/)** — W3C Web Accessibility Initiative. Type: `official_standard_overview`. Reviewed: 2026-09-11. Access: `page_and_official_search_result`.

Principle: Introduces the WCAG standards and resources for accessible web content.

Limit: This overview is not a complete conformance audit; consult selected normative criteria during implementation.

### S19

**[Boring UI README](https://github.com/hachej/boring-ui/blob/75b3d051157a32c3f960fa452da54704451fb049/README.md)** — hachej/boring-ui. Type: `upstream_repository_documentation`. Reviewed: 2026-09-11. Access: `github_file`.

Principle: Describes the chat/workbench architecture, Pi resources, plugins, packages, and app-owned hosting.

Limit: Snapshot-specific. A documented framework capability is not a tested Boring PM integration.

### S20

**[Boring Ask User README](https://github.com/hachej/boring-ui/blob/75b3d051157a32c3f960fa452da54704451fb049/plugins/ask-user/README.md)** — hachej/boring-ui. Type: `upstream_repository_documentation`. Reviewed: 2026-09-11. Access: `github_file`.

Principle: Documents ask_user forms, answers, persistence, and host composition.

Limit: Capabilities require correct host installation and context. Limits and delivery behavior must be rechecked in the target version.

### S21

**[Boring UI Plugin CLI README](https://github.com/hachej/boring-ui/blob/75b3d051157a32c3f960fa452da54704451fb049/packages/plugin-cli/README.md)** — hachej/boring-ui. Type: `upstream_repository_documentation`. Reviewed: 2026-09-11. Access: `github_file`.

Principle: Distinguishes package creation from local runtime scaffolding and lists plugin verification commands.

Limit: Manifest verification is not runtime proof. Dependencies and host support remain required.

### S22

**[Boring UI package-plugin template manifest](https://github.com/hachej/boring-ui/blob/75b3d051157a32c3f960fa452da54704451fb049/packages/plugin-cli/templates/plugin/package.json)** — hachej/boring-ui. Type: `upstream_repository_source`. Reviewed: 2026-09-11. Access: `github_file`.

Principle: Shows a real package manifest with Pi and Boring resources and built entrypoints.

Limit: The monorepo template contains workspace dependencies; it is not a standalone production app.

### S23

**[Canva Model Context Protocol](https://www.canva.dev/docs/mcp/)** — Canva Developers. Type: `official_technical_documentation`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Offers design creation/editing, discovery, assets, exports, and collaboration through a remote MCP service.

Limit: Custom integration access and authentication need verification. A connector in this chat does not automatically exist in Boring PM.

### S24

**[MCP tools and rate limits](https://www.canva.dev/docs/mcp/tools/)** — Canva Developers. Type: `official_technical_documentation`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Tool availability and output behavior depend on plans, permissions, and content licensing.

Limit: Check current tools rather than assuming the connected client's surface equals the full provider API.

### S25

**[MCP](https://support.craft.do/en/integrate/mcp)** — Craft Help Center. Type: `official_technical_documentation`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Documents AI access to Craft content and space-specific MCP connections.

Limit: Exact tool discovery and permitted document scope must be checked in the chosen connection.

### S26

**[Craft API](https://support.craft.do/en/integrate/api)** — Craft Help Center. Type: `official_technical_documentation`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Supports document search and mutation, tasks, and collection management through configured connections.

Limit: API support does not prove a given MCP client exposes every action or that an integration is already installed.

### S27

**[Tools and prompts — Figma MCP server](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)** — Figma Developer Docs. Type: `official_technical_documentation`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Documents design context, screenshots, component mapping, and native design operations.

Limit: Capabilities differ by client and server; generated code still requires adaptation and verification.

### S28

**[gh repo create](https://cli.github.com/manual/gh_repo_create)** — GitHub CLI manual. Type: `official_technical_documentation`. Reviewed: 2026-09-11. Access: `full_page`.

Principle: Documents creating public repositories and pushing an existing local repository with --source and --push.

Limit: Requires an authenticated CLI and appropriate account permissions; unavailable in the authoring workspace.

### S29

**[Understanding users who do not use digital services](https://www.gov.uk/service-manual/user-research/understanding-users-who-dont-use-digital-services)** — GOV.UK Service Manual / User research community. Type: `public_service_guidance`. Reviewed: 2026-09-12. Access: `full_page`.

Principle: Distinguishes digital skills, confidence, access, and support needs; cautions that users can misjudge their own ability.

Limit: Government service guidance about assisted digital support; Boring PM does not adopt its scale or claim a validated automated skills assessment.

### S30

**[Compare and Contrast Decisions](https://www.producttalk.org/glossary-discovery-compare-and-contrast-decisions/)** — Product Talk. Type: `author_practitioner`. Reviewed: 2026-09-12. Access: `full_page`.

Principle: Generate alternatives for one opportunity, identify their critical assumptions, and compare evidence from testing those assumptions.

Limit: Practitioner guidance; the candidate count, fit criteria, and recommendation protocol in Boring PM are original design choices, not comparative efficacy results.

### S31

**[User Interviews 101](https://www.nngroup.com/articles/user-interviews/)** — Maria Rosala and Kara Pernice / Nielsen Norman Group. Type: `author_practitioner`. Reviewed: 2026-09-12. Access: `full_page`.

Principle: Use flexible, concrete interview questions and distinguish reported attitudes or behavior from observation of actual task performance.

Limit: UX practice guidance; an interview-based profile is provisional and does not establish that a proposed product will be usable.
