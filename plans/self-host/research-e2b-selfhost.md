# Research: E2B open-source/self-hosting as boring-ui agent sandbox backend

## Summary
E2B appears self-hostable today, but not as a simple Docker Compose/Kubernetes add-on: the official production path is Terraform-managed cloud infrastructure on GCP or AWS, running Nomad/Consul plus E2B API, client proxy, orchestrators, template builder, databases, object storage, DNS/TLS, and observability. For boring-ui, E2B is a strong isolation backend candidate when we can dedicate KVM/Firecracker-capable infrastructure; it is likely too heavy as the first default self-host path unless packaged behind a narrow adapter and treated as an advanced/managed deployment target.

Note: if the user typed “idb”, I assume they meant **E2B** in this context.

## Findings
1. **Self-hosting is real, but supported production targets are AWS and GCP only.** The E2B main README says self-hosting uses the `e2b-dev/infra` repo and Terraform, with AWS and GCP supported, Azure and “General Linux machine” unchecked. The infra README currently marks GCP supported, AWS beta, Azure and general Linux unsupported. [E2B README](https://github.com/e2b-dev/e2b/blob/HEAD/README.md), [Infra README](https://github.com/e2b-dev/infra/blob/main/README.md)

2. **No Kubernetes requirement in the open-source self-host guide; the stack uses Terraform + Nomad/Consul.** The AWS self-host architecture provisions node pools for Control Server, API, Client, Build, and ClickHouse, and the guide tells operators to inspect jobs in the Nomad UI. This is important for boring-ui: adopting E2B does not imply Kubernetes, but it does imply learning/operating Nomad/Consul unless we build our own packaging. [Self-host guide](https://github.com/e2b-dev/infra/blob/main/self-host.md)

3. **Core components are substantial.** E2B BYOC docs list Orchestrator, Edge Controller, Monitoring, and Storage; self-host/local docs expose more concrete services: API server, orchestrator + template manager, client proxy, Postgres, ClickHouse, Redis, optional Grafana/Loki/Tempo/Mimir/Memcached/OTel/Vector, plus object buckets for templates, kernels, builds, backups, snapshots, and logs. [BYOC docs](https://e2b.dev/docs/byoc), [DEV-LOCAL](https://github.com/e2b-dev/infra/blob/main/DEV-LOCAL.md), [Self-host guide](https://github.com/e2b-dev/infra/blob/main/self-host.md)

4. **KVM/Firecracker is a hard requirement for sandbox workers.** E2B says it uses Firecracker for sandboxes and the local guide requires Linux bare metal or a VM with nested virtualization and `/dev/kvm`; the orchestrator must run with `sudo` because it manages `/dev/kvm`, TAP networking, cgroups, and NBD devices. AWS deployment notes require regions/instance types that support bare metal or nested virtualization; default client workers are `m8i.4xlarge`. [DEV-LOCAL](https://github.com/e2b-dev/infra/blob/main/DEV-LOCAL.md), [Self-host guide](https://github.com/e2b-dev/infra/blob/main/self-host.md)

5. **General Linux/on-prem is not yet a polished supported target.** The local development guide explicitly says bare-metal Linux development is “a work in progress” and “not everything will function as expected.” A GitHub issue discussion states Docker hosting alone is insufficient and orchestrators need KVM-capable underlying machines. Treat single-node/on-prem E2B as experimental unless we invest engineering time. [DEV-LOCAL](https://github.com/e2b-dev/infra/blob/main/DEV-LOCAL.md), [Issue #864](https://github.com/e2b-dev/infra/issues/864)

6. **Persistence and snapshots are first-class and attractive for agents.** Pause/resume preserves both filesystem and memory state; paused sandboxes are documented as retained indefinitely, pause takes roughly 4 seconds per GiB RAM, and resume about 1 second. Snapshots capture filesystem + memory, survive sandbox deletion, and can spawn multiple new sandboxes from the captured state. [Persistence docs](https://e2b.dev/docs/sandbox/persistence), [Snapshot docs](https://e2b.dev/docs/sandbox/snapshots)

7. **API/SDK integration shape is clean for boring-ui.** JS/Python SDKs expose `Sandbox.create`, `commands`, `files`, `git`, `pty`, `kill`, `pause`, `connect`, `createSnapshot`, metrics, and URL helpers. Self-hosted deployments can be targeted by passing a custom `domain`; local development can set `api_url`/`sandbox_url`. This maps well to a boring-ui `SandboxBackend` adapter. [SDK reference](https://e2b.dev/docs/sdk-reference/js-sdk/v2.16.0/sandbox), [Self-host guide](https://github.com/e2b-dev/infra/blob/main/self-host.md), [DEV-LOCAL](https://github.com/e2b-dev/infra/blob/main/DEV-LOCAL.md)

8. **Security isolation is stronger than container-only approaches, but not free.** E2B’s isolation boundary is Firecracker microVMs, i.e. separate guest kernels per sandbox, with orchestrator-managed TAP networking/cgroups. This is a good fit for untrusted agent code, but it expands host privilege and kernel/Firecracker patching responsibilities for the operator. [DEV-LOCAL](https://github.com/e2b-dev/infra/blob/main/DEV-LOCAL.md), [Self-host guide](https://github.com/e2b-dev/infra/blob/main/self-host.md)

9. **Operational burden is high.** The production guide requires Packer, Terraform, Go, Docker Buildx, npm, Cloudflare DNS, PostgreSQL, AWS/GCP credentials, object buckets, secrets managers, AMI/image builds, ECR/artifact registries, TLS, database migrations, base-template builds, and optional observability. This is platform engineering, not an app-level dependency. [Self-host guide](https://github.com/e2b-dev/infra/blob/main/self-host.md)

10. **Cost floor is non-trivial for always-on self-hosting.** The AWS default architecture includes 3 control servers, API node(s), client Firecracker nodes, build nodes, and ClickHouse. Default client workers are `m8i.4xlarge`; third-party AWS pricing references put m8i.4xlarge around $0.85-$0.93/hour (~$618-$671/month in us-east-1) before the rest of the cluster, storage, traffic, NAT, Postgres, Cloudflare, and observability. E2B Cloud pricing offers usage-based hosted service with free credits and paid Pro/Enterprise tiers, so self-host is unlikely to save money at low volume. [Self-host guide](https://github.com/e2b-dev/infra/blob/main/self-host.md), [E2B billing docs](https://e2b.dev/docs/billing), [EC2Info m8i.4xlarge](https://ec2info.app/m8i.4xlarge)

11. **Licensing is permissive.** The `e2b-dev/infra` repository is Apache License 2.0, which is compatible with commercial/internal self-hosting and modification subject to standard notice/license obligations. [Infra LICENSE](https://github.com/e2b-dev/infra/blob/main/LICENSE)

12. **BYOC is not identical to fully disconnected self-host.** E2B BYOC docs describe customer VPC storage for templates/snapshots/logs and direct sensitive traffic to the customer VPC, but anonymized metrics are sent to E2B Cloud for observability/cluster management; onboarding involves E2B and an IAM role. The open-source self-host guide is more independent, but any boring-ui plan should distinguish “E2B BYOC managed by E2B” from “we operate open-source E2B ourselves.” [BYOC docs](https://e2b.dev/docs/byoc), [Self-host guide](https://github.com/e2b-dev/infra/blob/main/self-host.md)

## Recommendation for boring-ui self-host plan
- **Do not make E2B the default self-host sandbox path yet.** It is too infrastructure-heavy for ordinary boring-ui installs and requires KVM-capable Linux hosts.
- **Do build an optional E2B adapter.** Hide E2B behind a backend interface that supports create/connect/exec/files/pty/kill/pause/snapshot. Accept either E2B Cloud credentials or self-hosted `domain`/`api_url`/`sandbox_url`.
- **Target E2B for “secure remote sandbox” and enterprise deployments.** It is a strong choice where users can run AWS/GCP Terraform infrastructure or pay for E2B Cloud/BYOC.
- **For near-term local self-host, keep a lighter backend available** (container/gVisor/bwrap/nsjail/Firecracker-lite alternative depending on project decision), then document E2B as the high-isolation advanced backend.
- **If pursuing full self-host E2B, prototype on one KVM Linux host first** using `DEV-LOCAL.md`, then graduate to AWS/GCP Terraform only after validating API/SDK compatibility, snapshot behavior, template build flow, and operational runbooks.

## Sources
- Kept: E2B main README (https://github.com/e2b-dev/e2b/blob/HEAD/README.md) — official statement of SDK shape and self-host support matrix.
- Kept: E2B infra self-host guide (https://github.com/e2b-dev/infra/blob/main/self-host.md) — primary production deployment instructions, AWS/GCP requirements, Nomad architecture, Firecracker details.
- Kept: E2B infra README (https://github.com/e2b-dev/infra/blob/main/README.md) — official infra repo scope and provider status.
- Kept: E2B DEV-LOCAL (https://github.com/e2b-dev/infra/blob/main/DEV-LOCAL.md) — best source for single-node/local constraints, KVM/root requirements, service list, and local API endpoints.
- Kept: E2B BYOC docs (https://e2b.dev/docs/byoc) — components and managed BYOC data-flow model.
- Kept: E2B persistence docs (https://e2b.dev/docs/sandbox/persistence) — pause/resume behavior, retention, and performance notes.
- Kept: E2B snapshot docs (https://e2b.dev/docs/sandbox/snapshots) — snapshot semantics and agent-useful checkpoint/fork behavior.
- Kept: E2B JS SDK reference (https://e2b.dev/docs/sdk-reference/js-sdk/v2.16.0/sandbox) — integration surface for boring-ui adapter.
- Kept: E2B infra LICENSE (https://github.com/e2b-dev/infra/blob/main/LICENSE) — licensing.
- Kept: E2B billing docs (https://e2b.dev/docs/billing) — hosted-service pricing context.
- Kept: EC2Info m8i.4xlarge (https://ec2info.app/m8i.4xlarge) — rough AWS cost context for the default self-host client node type.
- Dropped: Beam “How to Self-Host a Code Execution Sandbox” — useful competitor commentary but vendor-authored and not needed for E2B facts.
- Dropped: DeepWiki pages for E2B internals — derivative summaries; primary repo/docs were available.
- Dropped: Duplicate pinned revisions of `self-host.md` — same guide, older snapshots.
- Dropped: SEO AWS pricing mirrors beyond EC2Info — redundant for rough cost floor.

## Gaps
- Exact production hardening requirements, upgrade process, backup/restore runbooks, and failure modes are not fully covered in public docs.
- Exact snapshot storage sizing/cost behavior under self-host was not quantified.
- General Linux production support status is ambiguous: local development exists, but official support matrix still leaves “General Linux machine” unchecked.
- Need hands-on validation before committing: run local KVM prototype, create sandbox, execute commands/files/pty, pause/resume, create snapshot, rebuild template, and test restart recovery.
