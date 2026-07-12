# GTM Call Kits — customs + analytics validation, outreach, pricing

Companion to [GTM-STRATEGY.md](GTM-STRATEGY.md). That doc sets the strategy;
this doc is the execution kit for the first two Motion-1 lighthouse targets
(customs pre-filing, analytics agent) plus the outreach sequences and a
pricing sanity check for the placeholder in GTM-STRATEGY.md's "Pricing
placeholder" section. Drafted 2026-07-12. Treat every script/question below
as a hypothesis to be killed by the first 5 real calls, not a final asset.

---

## 1. Customs pre-filing wedge — buyer validation kit

**Target:** owner/ops lead at a small French *commissionnaire en douane*
(customs broker), 10–50 déclarations/mois. Not a global forwarder (TLF
Overseas majors), not a one-person shop.

### Opener (10–15 sec, phone or post-LinkedIn-connect call)

> "Bonjour [Prénom], je vous appelle vite fait — on construit un agent qui
> pré-classe les codes SH et pré-remplit les déclarations à partir des
> factures/packing lists, avant que votre déclarant ne les valide. Je ne
> vous vends rien aujourd'hui, je cherche à comprendre comment ça se passe
> chez vous aujourd'hui. Vous avez 10 minutes ?"

### Discovery questions (6–8)

1. Sur une déclaration standard, combien de temps passe votre déclarant à
   trouver/vérifier le code SH (classification tarifaire) ? Et sur un
   article "limite" (ambigu) ?
2. Qui fait la classification chez vous — le déclarant lui-même, un
   classificateur dédié, ou c'est sous-traité/vérifié par un tiers ?
3. La mise à jour tarifaire 2026 (refonte SH / TARIC) — ça vous a demandé
   combien de temps de mise à jour interne ? Qui l'a fait, et sur quoi
   vous êtes-vous appuyés (BOD, Douane.gouv, éditeur logiciel) ?
4. Avec la fin de la franchise de minimis et le forfait ~2 €/ligne annoncé
   sur les petits envois, combien de lignes de déclaration ça représente
   pour vous par mois, et est-ce que ça change votre rentabilité par
   dossier ?
5. Quel logiciel de dédouanement utilisez-vous aujourd'hui (Delta G/H,
   Conex, AP+, Cargo Wise, autre) ? Est-ce qu'il vous aide sur la
   classification ou juste sur la transmission ?
6. Sur les erreurs de classification — combien vous coûte un redressement
   ou un contrôle a posteriori dans une année type ?
7. Si un outil vous proposait une classification SH pré-remplie avec le
   raisonnement (numéro SH + justification + sources tarifaires), qui
   validerait cette proposition avant transmission — vous, ou directement
   le système actuel ?
8. Est-ce que vous avez déjà testé un outil IA (interne ou éditeur) pour
   la classification ou la déclaration ? Qu'est-ce qui a marché / pas
   marché ?

### Pricing test

Frame as a range, not a quote: *"Sur ce type de brief, nos clients sont
plutôt dans une fourchette de 500 à 1 500 €/mois selon le volume de
déclarations et le niveau d'intégration avec votre logiciel de
dédouanement — est-ce que ça reste dans une enveloppe réaliste pour vous,
ou c'est hors budget ?"* Listen for: instant "hors budget" (kill), "faut
voir le ROI" (proceed to pilot framing), "on paie déjà plus cher pour X"
(strong signal, probe what X is).

### Disqualifiers (kill fast, don't burn a pilot slot)

- **They'd only buy if we file the declaration ourselves.** We are not a
  registered customs representative (RDE) and are not seeking that
  license — we pre-classify/pre-fill, a human declarant validates and
  files. If the prospect's ask is "do the filing for us," we're gated;
  qualify them out or redirect to the classification-assist framing only.
- **They classify fewer than ~10 declarations/month.** Too small to
  justify a €500+/mo retainer or to generate the volume of edge cases
  needed to prove the agent's value; refer to Motion 3 content instead of
  a paid pilot.
- **They're fully outsourced to a group-level customs desk** (no local
  classification decision-maker) — wrong buyer, not a wrong ICP.

### Where to find 10 of them

- **ODASCE** (odasce.asso.fr) — ~240 member companies/orgs, customs
  training/certification body tied to DGDDI; its member/alumni network
  skews toward exactly this profile (in-house customs staff at SMEs).
  Look for their annual member directory or training-cohort alumni lists;
  cold-message trainers/speakers listed on odasce.asso.fr as a warm path
  into their network.
- **TLF Overseas — Commission Douane** (e-tlf.com/nos-metiers/douane) —
  the professional body for *représentants en douane enregistrés* (RDE);
  its commission members and the TLF member directory (e-tlf.com/annuaire)
  list customs brokers, several of them small/regional firms distinct
  from the large multinational forwarders.
- **LinkedIn search strings (French, use in Sales Navigator or plain
  search):**
  - `"commissionnaire en douane" "déclarant" -groupe -international France`
  - `"commissionnaire agréé en douane" PME OR indépendant`
  - `"représentant en douane enregistré" OR "RDE" gérant OR fondateur`
  - `"déclarant en douane" "classification tarifaire" France`
  - `title:"responsable douane" OR title:"déclarant en douane" company size:1-50`
  - `"cabinet de courtage en douane" France -DHL -Kuehne -DB Schenker -Bolloré`
    (the `-` exclusions filter out the large forwarders whose in-house
    customs desks aren't the target buyer)

---

## 2. Analytics agent — buyer validation kit

**Target:** data lead (Head of Data / Analytics Engineer / Lead Data
Analyst) at a French mid-market SaaS or scale-up, Postgres or BigQuery +
dbt in the stack, 20–500 FTE.

### Opener

> "Bonjour [Prénom], je vois que vous êtes sur dbt/[Postgres|BigQuery] chez
> [company]. On construit un agent qui répond en langage naturel sur votre
> warehouse dbt-modélisé, hébergé en Europe, branché en MCP sur vos
> outils. Je ne vends rien là — je veux comprendre où ça vous fait mal
> aujourd'hui. 10 minutes ?"

### Discovery questions (6–8)

1. Sur une semaine type, combien d'heures votre équipe (ou vous) passe à
   répondre à des demandes SQL ad-hoc venant du business (sales, finance,
   ops) plutôt qu'à du travail de modélisation ?
2. Qui pose ces questions — combien de personnes non-techniques dépendent
   de vous pour un chiffre ponctuel ?
3. Vous avez Looker / un autre BI dessus ? Qu'est-ce qui manque
   structurellement — couverture des modèles, latence de mise à jour,
   coût des sièges, self-service réel ou pas ?
4. Est-ce que MCP (Model Context Protocol) vous dit quelque chose ? Vous
   avez déjà branché un assistant IA sur votre warehouse (Claude, Copilot,
   autre) ou c'est encore un sujet ouvert ?
5. L'hébergement en Europe / la souveraineté des données, c'est un
   critère de sélection formel chez vous (RGPD, clause contractuelle
   client, politique interne) ou un "nice to have" ?
6. Vos modèles dbt — combien de modèles, quel niveau de documentation
   (descriptions, tests) ? Un agent doit s'appuyer sur ce contexte pour
   être fiable.
7. Si un agent répondait correctement à 70-80% des questions ad-hoc en se
   basant sur vos modèles dbt documentés, qu'est-ce que ça libérerait
   comme temps d'équipe, et sur quoi ce temps irait ?
8. Vous avez déjà évalué/acheté un outil similaire (Snowflake Cortex
   Analyst, un wrapper text-to-SQL, un agent maison) ? Qu'est-ce qui a
   bloqué l'adoption ?

### Pricing test

*"Sur ce type de scope, la fourchette qu'on voit c'est plutôt 500 à
1 000 €/mois, hébergement et gouvernance inclus, plus l'usage LLM au coût
réel — ça matche avec ce que vous alloueriez à un outil qui remplace une
partie du temps analyste sur l'ad-hoc ?"* Listen for: "on a déjà un budget
BI de X" (compare against, not against build cost), "c'est le temps
analyste qui coûte cher, pas l'outil" (strong buy signal — reframe value
as headcount-hours, not tool cost).

### Disqualifiers

- **Already on Snowflake + Cortex Analyst (or an equivalent native
  text-to-SQL feature already licensed and live).** They've already
  solved the problem inside their existing platform; competing there is
  a feature fight, not a wedge.
- **No dbt (or equivalent semantic/modeling layer) in the stack.** Without
  documented models, the agent has no reliable grounding — it becomes a
  raw text-to-SQL bet, not the "sits on top of your dbt semantics"
  differentiator; still buildable but off-thesis for this wedge, don't
  spend a lighthouse slot on it.
- **No one owns a >5-person ad-hoc-question queue.** If nobody's
  fielding recurring ad-hoc requests, there's no time being lost to
  reclaim — the ROI story collapses.

### Where to find 10 of them

- **dbt Slack, `#local-paris` channel** — join the public dbt Community
  Slack (getdbt.com/community, 65k+ members) and post/DM in `#local-paris`;
  this is the single highest-density pool of French dbt practitioners.
- **Paris dbt Meetup** (meetup.com/fr-fr/paris-dbt-meetup) and **Modern
  Data Stack France** (meetup.com/fr-fr/modern-data-stack-france) — pull
  the member/RSVP lists from past events; past speakers are the warmest
  targets (they self-identify as the data lead, not just an attendee).
- **LinkedIn search strings (French):**
  - `("head of data" OR "data lead" OR "lead analytics engineer") dbt France`
  - `"analytics engineer" dbt Postgres OR BigQuery France -CDI -recrute`
    (exclude recruiter/job-post noise)
  - `title:"responsable data" OR title:"data engineering manager" company size:11-500 France`
  - `"dbt Labs" OR "data build tool" "chez" France -formation`
  - `"looker" OR "metabase" "dbt" scale-up OR "série A" OR "série B" France`

---

## 3. Lighthouse outreach sequences (Motion 1) — LGM-ready, French

Both sequences are 3 touches: LinkedIn connection note (≤300 chars) →
LinkedIn follow-up message (after acceptance) → email (if no LinkedIn
reply within a few days, or as a parallel channel). Per the gated
golden-path rule in GTM-STRATEGY.md, the offer is always a **pre-built
walkthrough demo on their type of workflow** — never a live-build promise,
since the ≤15-min build claim is gated on P8's recorded evidence.
Variables: `{{firstName}}`, `{{company}}`, `{{workflow}}`.

### Sequence A — Ops-workflow angle (generic ICP: COO/Head of Ops/CTO)

**Touch 1 — LinkedIn invite (≤300 chars)**

```
Bonjour {{firstName}}, je vois que {{company}} a probablement des flux
comme {{workflow}} qui tournent encore à la main. On construit des agents
IA opérationnels, hébergés en Europe. Je vous montre un cas concret en
30 min si ça vous parle ?
```
(≈275 caractères)

**Touch 2 — LinkedIn follow-up (after acceptance)**

```
Merci {{firstName}} ! Pour être concret : on a un agent déjà construit
qui prend en charge {{workflow}} de bout en bout — je vous le montre
tourner sur un cas proche du vôtre en 30 min, sans engagement. C'est
un format démo, pas un pitch commercial. Un créneau cette semaine ou
la suivante vous irait ?
```

**Touch 3 — Email**

```
Objet : {{workflow}} chez {{company}} — 30 min pour vous montrer un agent qui le fait déjà

Bonjour {{firstName}},

On construit des agents IA qui prennent en charge des workflows
opérationnels comme {{workflow}} — hébergés en Europe, avec
gouvernance et traçabilité intégrées dès le départ.

Plutôt qu'un pitch, je préfère vous montrer directement : 30 minutes
où on part d'un agent déjà construit sur un cas proche du vôtre, et
on regarde ensemble ce que ça donnerait sur {{workflow}} chez
{{company}}.

Si ça vous parle, un lien pour choisir un créneau : [lien].

Bien à vous,
[Signature]
```

### Sequence B — Sovereignty angle (compliance-sensitive sectors: legal,
health-adjacent admin, public-sector suppliers)

**Touch 1 — LinkedIn invite (≤300 chars)**

```
Bonjour {{firstName}}, chez {{company}} la question de l'hébergement
souverain des données doit se poser, surtout avec de l'IA dans la
boucle. On construit des agents 100% hébergés en Europe, sans
dépendance US. Je vous montre le fonctionnement en 30 min ?
```
(≈280 caractères)

**Touch 2 — LinkedIn follow-up (after acceptance)**

```
Merci {{firstName}} ! Pour situer : nos agents tournent sur une
infrastructure hébergée en Europe, avec gouvernance et audit intégrés
et la possibilité de changer de modèle sous-jacent sans dépendre d'un
seul fournisseur US. Je vous fais une démo sur un agent déjà construit,
sur un cas proche de {{workflow}} chez {{company}} — 30 min, pas
d'engagement. Un créneau qui vous va ?
```

**Touch 3 — Email**

```
Objet : {{workflow}} chez {{company}} — un agent hébergé en Europe, démo en 30 min

Bonjour {{firstName}},

Pour les organisations comme {{company}}, la question n'est pas
seulement "est-ce que l'IA peut faire {{workflow}} ?" mais "où
tournent mes données pendant qu'elle le fait ?". Nos agents sont
hébergés en Europe, avec gouvernance, audit et traçabilité intégrés,
et sans dépendance obligatoire à un fournisseur américain.

Je peux vous montrer concrètement comment ça marche : 30 minutes,
un agent déjà construit sur un cas proche de {{workflow}}, et on
regarde ensemble ce que ça donnerait chez {{company}}.

Si ça vous intéresse : [lien pour choisir un créneau].

Bien à vous,
[Signature]
```

---

## 4. Pricing benchmarks — French/EU AI agencies, 2026

Quick web check (2026) on what French/EU agencies and "agent as a
service" providers actually charge, to sanity-check GTM-STRATEGY.md's
placeholder (setup per agent, fixed fee + managed retainer per hosted
agent-workspace/month).

| Provider / source | Setup (one-time) | Monthly |
| --- | --- | --- |
| **RedArrow** (French AI engineering agency) — chatbot FAQ tier | 6 000–10 000 € | 300–500 €/mo |
| **RedArrow** — commercial agent tier | 12 000–18 000 € | 600–900 €/mo |
| **RedArrow** — full automation tier | 20 000–30 000 € | 1 000–1 500 €/mo |
| **Hyperstack** (French agency, custom business agents) — complex multi-agent | 8 000–30 000 €+ | 500–3 000 €/mo+ |
| **Hyperstack** — CRM/ERP-integrated custom agent | 2 500–8 000 € | 100–800 €/mo |
| **Heeya** (French SaaS-tier agent product) — Standard/Premium plans | n/a (subscription only) | 19–99 €/mo |
| **Generic FR market composite** (multiple French agency blogs, 2026) — SME custom agent | 1 500–5 000 € | 500–2 000 €/mo |
| **Global/US benchmark** (agency pricing surveys, 2026) — multi-agent workflow build | $5,000–$25,000 | $1,000–$3,000/mo |

Sources: [RedArrow](https://redarrow.fr/blog/cout-agent-ia-entreprise/),
[Hyperstack](https://www.hyperstack.studio/blog/quel-est-le-prix-dun-agent-ia-en-2026),
[Heeya](https://heeya.fr/blog/prix-agent-ia-entreprise), aggregate FR
market figures cross-checked across Nerolia, Algomax and La Fabrique du
Net's 2026 AI-agency pricing pages, and a global agency-pricing survey
(digitalagencynetwork.com/ai-agency-pricing, thecrunch.io/ai-agents-price).

**Verdict:** the placeholder in GTM-STRATEGY.md (fixed setup fee + monthly
retainer per hosted agent-workspace, LLM usage passed through) is
in-market. A setup fee in the low-to-mid thousands (€2,000–€8,000, in
line with Hyperstack's CRM/ERP-integrated tier and the generic FR SME
composite) paired with a €500–€1,500/mo retainer sits squarely between
the lightweight SaaS-tier products (Heeya, ~€20–€100/mo, no real
integration) and RedArrow's higher "full automation" tier
(€20k–€30k setup, €1–1.5k/mo) — which is priced for deep multi-system
integration boring isn't attempting at pilot stage. Compliance/sovereignty
is explicitly called out by these agencies themselves (RedArrow flags
"conformité, souveraineté française, audits RGPD" as a price driver),
which supports pricing at the upper-middle of the FR SME band rather
than the bottom — the sovereignty positioning is a legitimate premium
lever, not just messaging. No FR/EU provider found pricing per-workspace
hosting as cleanly as boring's model proposes; most bundle setup and
maintenance into a single custom quote, which is itself a differentiation
opportunity (a transparent, productized two-line price is easier to sell
than a bespoke quote in every call above).
