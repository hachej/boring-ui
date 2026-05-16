# Feedback Pipeline

Docs that don't collect feedback drift. This file covers the full feedback loop: widgets, comment systems, analytics, triage, response SLAs, and how the signal feeds back into future phase runs.‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

---

## Feedback surface taxonomy

Readers give feedback in six main ways. Each has different friction and value:

| Surface | Friction | Value | Example |
|---------|:--------:|:-----:|---------|
| "Was this helpful?" 👍/👎 | very low | low (no context) | Most doc sites |
| "Report issue" link | low | medium | GitHub issue template |
| Inline comments (Giscus/Utterances) | medium | medium | Discussion per page |
| Feedback form | medium | high | Open-text form |
| Email / support | high | highest | Real conversation |
| Analytics (indirect) | zero | medium | Bounce rate, search queries, scroll depth |

Offer at least 2–3 feedback surfaces. The `<Layout feedback>` prop (built into Nextra) gives the free tier; add others for deeper signal.

---

## Nextra's built-in feedback prop

The minimum:

```tsx filename="app/layout.tsx"
<Layout
  feedback={{
    content: '💭 Help us improve',
    labels: 'docs-feedback,triage',
    link: `https://github.com/myorg/repo/issues/new?title=Docs%20feedback&labels=docs-feedback`
  }}
>
```

This adds a "Help us improve" link to every page. When clicked:
- Default: opens a GitHub issue with title pre-filled.
- `link` override: routes to a custom endpoint.

See [ADVANCED-NEXTRA.md § 16](ADVANCED-NEXTRA.md#16-feedback-link-wiring) for the custom URL patterns.

---

## "Was this helpful?" (thumbs widget)

A per-page yes/no vote. Cheapest useful feedback.

### Implementation

```tsx filename="components/helpful.tsx"
'use client'
import { useState } from 'react'
import { usePathname } from 'next/navigation'

export function Helpful() {
  const pathname = usePathname()
  const [voted, setVoted] = useState<null | 'yes' | 'no'>(null)
  const [reason, setReason] = useState('')

  async function vote(v: 'yes' | 'no') {
    setVoted(v)
    await fetch('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ page: pathname, vote: v })
    })
  }

  async function submitReason() {
    await fetch('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ page: pathname, vote: voted, reason })
    })
    setReason('')
  }

  if (voted) {
    return (
      <div>
        Thanks for the feedback.
        {voted === 'no' && (
          <div>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              placeholder="What went wrong? (optional)" />
            <button onClick={submitReason}>Send</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      Was this helpful?
      <button onClick={() => vote('yes')}>👍 Yes</button>
      <button onClick={() => vote('no')}>👎 No</button>
    </div>
  )
}
```

Mount at the bottom of every page via `mdx-components.tsx` — override the `wrapper` to append the widget.

### The endpoint

```ts filename="app/api/feedback/route.ts"
export async function POST(req: Request) {
  const { page, vote, reason } = await req.json()

  // Option A: Slack webhook
  await fetch(process.env.SLACK_WEBHOOK_URL!, {
    method: 'POST',
    body: JSON.stringify({
      text: `📊 Feedback on \`${page}\`: ${vote === 'yes' ? '👍' : '👎'}${reason ? `\n> ${reason}` : ''}`
    })
  })

  // Option B: GitHub issue (on 'no' with reason)
  if (vote === 'no' && reason) {
    // call gh API to file an issue
  }

  // Option C: append to a log / DB
  // ...

  return Response.json({ ok: true })
}
```

### Storage choice

- **Ephemeral**: Slack webhook. Fast signal, no persistence. Good for small teams.
- **Log**: append-only file or Vercel Blob. Query-able later.​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
- **DB**: Supabase, Turso, Postgres. Enables dashboards, aggregation over time.

For docs feedback, start with Slack. Move to DB if volume justifies it.

---

## Inline comments (Giscus / Utterances)

Per-page threaded discussion backed by GitHub Discussions or Issues.

### Giscus setup (recommended — backed by GitHub Discussions)

1. Enable Discussions on your docs repo.
2. Install the Giscus GitHub App: https://giscus.app.
3. Get config from giscus.app.
4. Mount component:

```tsx filename="components/giscus.tsx"
'use client'
import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'

export function Giscus() {
  const ref = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (!ref.current || ref.current.hasChildNodes()) return
    const script = document.createElement('script')
    script.src = 'https://giscus.app/client.js'
    script.setAttribute('data-repo', 'myorg/docs')
    script.setAttribute('data-repo-id', 'R_xxxxxxxxx')
    script.setAttribute('data-category', 'General')
    script.setAttribute('data-category-id', 'DIC_xxxxxxxxx')
    script.setAttribute('data-mapping', 'pathname')
    script.setAttribute('data-theme', resolvedTheme === 'dark' ? 'transparent_dark' : 'light')
    script.setAttribute('data-lang', 'en')
    script.setAttribute('crossorigin', 'anonymous')
    script.async = true
    ref.current.appendChild(script)
  }, [resolvedTheme])

  return <div ref={ref} />
}
```

Append to each page via `mdx-components.tsx` wrapper.

### Pros of inline comments

- Threaded discussions tied to specific pages.
- Community members answer each other.
- Persistent record you can mine later.

### Cons

- Spam / low-quality comments require moderation.
- Requires GitHub account to comment (Giscus).
- Small projects: empty comment sections signal neglect.

### When to use

- Projects with >1k daily doc readers.
- Teams willing to spend 15min/day moderating.

Skip for small projects — empty comments hurt.

---

## Utterances (alternative: issues-backed)

Similar but backed by Issues instead of Discussions. Each comment = one issue. Gets noisy fast on popular pages. Use Giscus instead when you have a choice.

---

## Cusdis (private comments)

If you want comments without requiring a GitHub account:

```tsx
<script async defer
  src="https://cusdis.com/js/widget/lastest.js"
  data-host="https://cusdis.com"
  data-app-id="your-app-id"
  data-page-id={pathname}
  data-page-url={window.location.href}
  data-page-title={document.title}
></script>
```

Self-host if you want full control.

---

## Open-text feedback form

For capturing more detailed feedback than a thumb.

### Inline form at page bottom

```tsx filename="components/feedback-form.tsx"
'use client'
import { useState } from 'react'

export function FeedbackForm() {
  const [message, setMessage] = useState('')​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    await fetch('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ message, email, page: location.pathname })
    })
    setSent(true)
  }

  if (sent) return <p>Thanks for the feedback. We'll reply if you gave an email.</p>

  return (
    <form onSubmit={submit}>
      <textarea required value={message} onChange={e => setMessage(e.target.value)}
        placeholder="Any feedback on this page? What's unclear? What's missing?" />
      <input type="email" value={email} onChange={e => setEmail(e.target.value)}
        placeholder="Email (optional — we'll reply if you leave one)" />
      <button type="submit">Send</button>
    </form>
  )
}
```

Mount only on docs that need deep feedback (landing, key tutorials). Appending to every page is noise.

### Routes

- Slack webhook → team sees each submission in real time.
- Email → dedicated `docs@` inbox.
- Ticket system → Linear / Jira / Height auto-create ticket per submission.

---

## Analytics as implicit feedback

Explicit feedback surfaces a small fraction of readers. Analytics surfaces the other 99%.

### Signals to watch

| Signal | Tool | What it tells you |
|--------|------|--------------------|
| Page views | Plausible / GA / Umami | What's read |
| Bounce rate | GA / Plausible | Where readers give up |
| Scroll depth | GA events / custom | What pages people don't finish |
| Outbound clicks | Plausible events | Where you lose readers to competitors' docs |
| Search queries | Pagefind events | What content is missing (zero-result queries) |
| Time on page | GA | Engagement (careful — stalling isn't engagement) |
| 404s | Server logs | Broken inbound links |

### Pagefind zero-result queries

The most actionable signal for finding content gaps. Intercept Pagefind's search-submit event and log queries:

```tsx filename="components/search-logger.tsx"
'use client'
import { useEffect } from 'react'

export function SearchLogger() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onSearch = (e: CustomEvent) => {
      const { query, resultCount } = e.detail
      if (resultCount === 0) {
        fetch('/api/zero-result-search', {
          method: 'POST',
          body: JSON.stringify({ query })
        })
      }
    }
    window.addEventListener('pagefind-search', onSearch as EventListener)
    return () => window.removeEventListener('pagefind-search', onSearch as EventListener)
  }, [])
  return null
}
```

Aggregate zero-result queries monthly. Each one is a content gap.

### Privacy

Analytics choice affects reader trust:

- **GA4**: powerful, requires consent banners in EU.
- **Plausible / Fathom / Simple Analytics**: privacy-friendly, no consent banner, no PII.
- **PostHog**: product analytics, more PII than needed for docs.
- **Umami**: self-hosted, privacy-friendly.

For docs (not a product), **Plausible or Umami is almost always right**. Avoid GA4 unless your org requires it.

---

## Triage & response

Feedback without response is theater.

### SLAs by surface

| Surface | Response SLA | Triage rule |
|---------|--------------|-------------|
| 👎 with no comment | None | Aggregate weekly; rewrite pages with >5 👎 |
| 👎 with comment | 1 week | Reply if email given; file doc issue otherwise |
| Form submission (with email) | 3 business days | Personal reply, even if brief |
| GitHub issue (docs label) | 1 week | Normal issue triage |
| Inline comment | 48 hours | Reply from team or community |

Publish the SLA on the feedback pages. "We respond to feedback with email within 3 business days" sets expectations.​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

### Triage workflow

```
Feedback comes in
 ↓
Classified: bug / unclear / missing / off-topic / kudos
 ↓
Assigned:
 ├─ Bug (typo, broken link, wrong code)  → fix immediately
 ├─ Unclear (reader confused)             → rewrite in next polish pass
 ├─ Missing (content gap)                 → file issue, schedule
 ├─ Off-topic (support question)          → redirect to support channel
 └─ Kudos                                  → thank them, maybe add to testimonials
```

Tag feedback-sourced issues with `source:feedback` so you can measure % of docs improvements driven by readers vs internal reviews.

### Response templates

```
Hi <name>,

Thanks for flagging this. You're right — the section on <X> isn't clear about <Y>.
We've updated it; you can see the new version at <URL>.

The underlying reason is <brief reason>. We've added a callout to prevent others
hitting the same confusion.

Appreciate the feedback.

- <team>
```

Don't use boilerplate ("Thanks for reaching out!"). Specific > generic, always.

---

## Feedback → phase feedback loop

This is the reason we collect it: feedback should change the docs.

### Quarterly feedback review

Every 3 months:

1. Aggregate all feedback (👎 counts per page, form submissions, zero-result searches, issues with `docs-feedback` label).
2. Rank pages by negative-signal volume.
3. Schedule Phase 4 polish passes on the worst-performing pages.
4. For content gaps from zero-result queries, open issues assigned to Phase 2 (draft new page).
5. Update the glossary and FAQ (see [GLOSSARY-CRAFT.md](GLOSSARY-CRAFT.md)) with any terms/questions that appeared ≥3 times.

### Phase 10 (user-lens) enrichment

The Phase 10 agent's `phase10_user_lens.md` should include a section:

```markdown
## Actual reader feedback (last quarter)

Top 5 pages by 👎:
1. /guides/auth — 12 👎 / 43 👍
2. /reference/api/list-users — 8 👎 / 52 👍
3. ...

Top zero-result search queries:
1. "how do I cancel a subscription" (47 searches)
2. "what's the difference between X and Y" (31 searches)
3. ...

Most requested new content (via forms):
1. "Add a React hooks tutorial" (9 requests)
2. "SDK for Elixir" (4 requests)
```

This anchors Phase 10 in real reader behavior instead of the user-lens agent's speculative evaluation.

---

## Anti-patterns

- **Feedback widget with no backend** — collecting thumbs into the void.
- **Promising response but never responding** — worse than no form.
- **No triage** — feedback piles up, team tunes it out, readers learn it's useless.
- **Aggregate-only reporting** — knowing "/guides/auth has 12 👎" without knowing WHY.
- **Requiring email** — opt-in only.
- **Spam-prone surfaces** without moderation — inline comments without admin tooling.
- **Intrusive feedback popups** — mid-read modals. Bottom of page only.

---

## Recommended default stack

For a new docs site, start with this minimum viable pipeline:

1. **Nextra `feedback` prop** → GitHub issues with `docs-feedback` label.
2. **Plausible** for analytics (or Umami self-hosted).
3. **👍/👎 widget** → Slack webhook.
4. **Pagefind zero-result-search logger** → same Slack.
5. **Monthly review** of all three, driving a Phase 4 polish pass.

That's 1–2 days to set up. Adds enormous signal.

Upgrade later to:
- Giscus (if community engagement grows)
- Custom form (when Slack gets noisy)
- Dedicated ticketing (at 10+ feedback items/week)

---

## Integration with other references

- [LIFECYCLE.md](LIFECYCLE.md): feedback is the primary trigger for steady-state re-runs.
- [QUALITY-METRICS.md](QUALITY-METRICS.md): "was this helpful?" ratio per page is a tracked metric.
- [AUDIENCE.md](AUDIENCE.md): feedback reveals which personas you're actually serving (vs. who you think).
- [subagents/a11y-auditor.md](../subagents/a11y-auditor.md): feedback forms themselves need a11y attention.
