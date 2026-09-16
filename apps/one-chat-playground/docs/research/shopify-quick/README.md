# Shopify Quick — internal "folder + URL" hosting (2026-09-15)

## What it is
- Internal platform (July 2025): upload a folder of HTML, get an employee-only URL in seconds. 50,000+ sites, more than half of Shopify employees made one. Runs on **one $200/month VM**.

## Architecture
- Files in Google Cloud Storage buckets, served by nginx with a wildcard config through `gcsfuse`.
- Identity-Aware Proxy in front: every request is already a verified employee. No site owner, no permissions system; all sites are open to all employees.
- One shared backend (CloudSQL, Node then Go) exposing zero-config APIs: a Firebase-style database, file uploads, AI (LLM, images), data warehouse, websockets, identity.
- `quick deploy` wraps rsync; "the good old days of FTP". No build pipelines, frameworks or config.
- Agents ship with Quick skills, so a prompt can produce a site: "make me a site where my team can vote on lunch spots in real time".

## Lessons they state
- "A small, fixed set of capabilities is what keeps Quick simple to use." The platform succeeds through saying no.
- "When something is an internal tool, the complexities of the open web just disappear."
- Visible sites teach colleagues what is possible; an ecosystem (sites embedding sites, shared libraries) emerged on its own.

## What we took from it, and what we did not
- **Took:** every app is a folder with its own URL; a small fixed capability set; identity at the proxy, none in the app; hosting economics as a target; visibility between testers as a teaching device.
- **Did not take:** static folder + shared data API as our runtime. Quick can do it because every author is a trusted employee. Our authors are untrusted agents acting for users; Val Town's runtime history shows why a server runtime per app is kept. The ratified plan also puts product data behind the product's own operations.
- Shared platform capabilities (files, audio, mail, AI) as host services the app calls: yes, and the clinic example shows the template still lacks them.

## Source
- https://shopify.engineering/quick
