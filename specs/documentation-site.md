# Documentation and landing site

Status: proposed implementation contract for owner approval before dispatch.
Planning does not authorize execution, commits, push, publication or deployment.

## Product direction

Build an English, dark-first technical website for the current effect-jobs alpha.
Use Astro, Starlight and MDX for documentation, with a bespoke landing page.
The appearance must be polished, clean and system-oriented, with deliberate
typography, restrained color, generous spacing and smooth purposeful motion.
No light theme is required in the first delivery.

The first delivery is an integrated local preview, not a deployed site. Existing
React/Effect Atom/StyleX dashboard behavior must remain intact. No new product
features, library API changes, package publication or dependency workarounds.

## Placement and compatibility

Keep the site in apps/website. Route / to the landing page and /docs/** to docs.
Preserve /demo as the read-only demo and /jobs as a local-only operator surface.
Documentation must build without database credentials or executing jobs. Do not
expose private operator APIs, source payloads or secrets through static output.
Do not reimplement the dashboard in Astro or apply site-wide CSS to its mount.

The foundation owner must inspect the existing custom build and HTTP routes
before installing dependencies. Preserve current dashboard/client/StyleX outputs,
build consumers and all origin/private-route guards. Prefer additive Astro output
in apps/website/dist/site, leaving existing output contracts unchanged. Record
the actual integration contract before other authors need it. If current stable
Astro/Starlight cannot normally coexist with pinned React/tooling, report the
specific incompatibility; no force installs, overrides or hidden downgrades.

## File ownership contracts

- Foundation: apps/website/astro.config._, content.config._, site TypeScript
  configuration; apps/website/src/styles/site/**; src/components/docs/**;
  root/shared token definitions and routing/build integration. Sole owner of
  affected package manifests, bun.lock and shared configuration/navigation.
- Landing: apps/website/src/pages/index.astro and src/components/landing/**.
- Start/tutorial: apps/website/src/content/docs/start/** and concepts/**.
- Transactions: apps/website/src/content/docs/persistence/**.
- Execution: apps/website/src/content/docs/execution/** and operations/**.
- Reference/examples: apps/website/src/content/docs/reference/**,
  apps/website/examples/docs/** and dedicated example qualification code.

Paths are relative to apps/website unless stated otherwise. Foundation owns
src/content.config.ts (not a root-level duplicate). Existing path collisions must
be resolved in the shared contract before dispatch, not by concurrent edits.
Authors do not edit one another's files or shared registrars. Tests have named
owners too; new shared script hooks are requested from the foundation owner.

## Navigation and content map

- /docs/start/why-background-jobs: request latency, durable asynchronous work,
  what a queue solves and what it does not solve.
- /docs/start/installation: exact supported versions, required backend peers.
- /docs/start/first-job: complete executable vertical slice with explicit Layers.
- /docs/start/tutorial: build a report-generation workflow incrementally.
- /docs/concepts/model: definition, payload, queue, producer, consumer, handler.
- /docs/concepts/lifecycle: actual states, transitions and failure outcomes.
- /docs/persistence/postgresql: setup, schema ownership and migrations.
- /docs/persistence/transactions: same-client atomic application writes/enqueue.
- /docs/persistence/deduplication: semantic identity and conflicts.
- /docs/persistence/drizzle: exact supported public native integration.
- /docs/execution/workers: explicit scoped runtime, concurrency and finite drains.
- /docs/execution/retries: retry policy versus idempotent external effects.
- /docs/execution/recovery: leases, fencing, expiry and unknown outcomes.
- /docs/operations/telemetry: existing supported instrumentation only.
- /docs/operations/troubleshooting: symptoms, causes and concrete checks.
- /docs/reference/**: public exports, grouped by responsibility.

Foundation supplies /docs as a compact entry point linking the guided path and
reference. No multiple-release versioning in this first delivery. Alpha status,
supported runtime/backend scope and qualification limits are discoverable without
repeating disclaimers on every page. Internal workflow reports are not user docs.

## Editorial and executable examples

Use one synthetic report-generation/delivery domain throughout. No real provider
credentials, email delivery or cloud resources are needed for examples. Introduce
a realistic problem before the solution: slow request, crash between application
write and enqueue, duplicated request, interrupted worker, ambiguous external
outcome. Then show the smallest useful code, visual or table and the result.
Avoid long prose and repeated paragraphs; use concise connective explanation.
Reference entries need not invent a story. Never omit essential correctness or
security constraints merely to shorten a page.

All executable-looking examples must correspond to actual current public APIs.
Use public imports, explicit service requirements, realistic resource ownership
and honest error channels. No copied library internals, fabricated API, production
claims, placeholder no-op presented as a working integration, or silent replay
of unknown outcomes. Mark partial snippets as partial and link their complete
checked example. Reference owner owns complete executable files; content authors
request named examples rather than writing competing mini-applications.

Initially use built-in Markdown/MDX and standard Starlight components. Foundation
alone exports optional components from src/components/docs/index.ts. Proposed
additions are CodeExample (sourcePath and optional region), LifecycleDiagram
(named scenario), and standard callouts. Content must remain useful before those
components exist. CodeExample embedding must be validated against checked source,
not an independently maintained unchecked copy. Foundation/API owner freeze exact
props and snippet extraction before consumers adopt custom components.

## Landing storyboard

1. Short precise product promise, primary documentation CTA and secondary demo CTA.
2. Hero visualization of multiple jobs arriving, waiting, being claimed by bounded
   workers, succeeding and retrying. Distinct readable paths, not decorative noise.
3. Small synchronized code panel showing the operation behind a selected event.
4. Focused explanation of atomic enqueue and deduplication through code/diagram.
5. Reliability section distinguishing retries, fencing and unknown outcomes.
6. Concise supported stack/alpha boundary and final docs/demo entry points.

The illustration is deterministic educational simulation, not live telemetry or
fabricated lifecycle history. All state names/transitions follow actual library
contracts. Do not depict exactly-once external delivery or automatic unknown-outcome
replay. Support pause/resume and useful job selection without essential hover-only
information. Disclose illustrative status once, unobtrusively.

Prefer SVG/CSS and small React islands when interactivity warrants them; do not
add an animation framework without a concrete need and foundation-owned decision.
Use transform/opacity where appropriate, bounded visible job counts, no unbounded
timers/DOM growth, and stop animation while hidden/unmounted. No scroll-jacking.

Study Effect's Module of the Week visual explanations as design references.
Locate actual source/license before reuse; preserve required attribution and never
assume public source or artwork is freely reusable. Inspiration does not require
adding a runtime dependency or copying their implementation.

## Visual and accessibility contract

Dark neutral surfaces, high-contrast body text, muted secondary text and restrained
status accents. Color never carries state alone. Shared tokens for site/docs;
Starlight styling uses its supported CSS customization rather than forced StyleX.
Readable line lengths/code overflow, clear sidebar/TOC hierarchy and useful search.
Native navigation remains fast and keyboard/focus/browser-history behavior correct.
No page-transition system solely for visual smoothness.

Verify mobile, keyboard-only usage, focus visibility, zoom, contrast and
prefers-reduced-motion. Reduced-motion and no-JavaScript landing remain meaningful;
docs prose/code are statically readable. Motion is progressive enhancement, not
the sole explanation. Do not embed private dashboard data in screenshots.

## Overnight execution and acceptance

Create one parent with six bounded implementation children. Keep them unassigned
and blocked until owner approval. Freeze a safe current source snapshot including
uncommitted integrated changes, never only historical HEAD. Preserve .env and
owner data without copying credentials. Use existing project roster/settings.

After approval, foundation publishes shared path/token/build contracts first.
Independent MDX content and source example work can start immediately against this
specification; shell completion is not their prerequisite. Landing starts against
frozen tokens/components. Example and content owners exchange explicit named
snippet requests. Integration remains serial. Respect actual profile capacity;
do not change concurrency/model/runtime or create agents just to occupy slots.

Coordinator may finish routine authorized fixes and qualified isolated integration
without waking the owner. A real behavior/API/security decision blocks only its
dependent slice; other independent work continues. No unauthorised owner-checkout
writes, commit, push, PR, merge, deploy, other-project changes or unrelated backlog.

Acceptance: integrated local landing/docs preview, preserved /jobs and /demo
boundaries, normal reproducible install/build, source types/lint/format, working
internal links/anchors/search, checked complete examples and snippet consistency,
actual public-export reference coverage, browser evidence at desktop/mobile and
reduced-motion, keyboard and no-JS readability. Record exact versions and final
source hashes, raw failures/manual dispositions and applicable foreign exceptions.
Do not borrow previous qualification for changed bytes or rerun unaffected matrices.

Review follows current UPVE-1020: exactly one independent Reviewer for each complete
material implementation scope, including normative docs; no hidden subreviewers
or second/delta/final blanket review. Finite accepted findings return to original
authors with reproductions/affected checks. Final serial integration is verified,
not another blanket review. Traits assess eligible authored TypeScript, not MDX,
Markdown, Astro or generated/reference/dependency files. Runtime and browser checks
remain mandatory; no empty Traits selection presented as coverage.
