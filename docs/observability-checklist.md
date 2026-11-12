# Per-file observability checklist

Load this together with the **complete** `.ts` file and its actual callers. For
each applicable item record `OK / ISSUE / UNKNOWN / N/A`, scenario and `file:line`.
Missing tests alone do not establish a runtime bug; failed tools/empty captures
never establish PASS. A pure helper need not have a span.

- Identify the owned unit and terminal boundary, including early exits and cleanup.
- Construct safe values before child-span/export boundaries. Retain A/E/R and
  Fail/Die/Interrupt, including mixed Cause; identify app-owned instrumentation.
- Separate result, Exit, span status, attempt, invocation and durable state.
  Observe deadline only where its owner knows the deadline fired.
- Use constant log messages and safe annotations. Check healthy-poll noise and
  failure visibility at the configured threshold.
- Check explicit label subset **and ambient attributes**, deployment policy,
  cardinality budget and actual OTLP units. Hashing does not reduce cardinality.
- Separate permit wait, handler, protocol, total attempt, in-flight and DB-time lag.
  Balance entry/exit under failure, interruption, cleanup and reused Effects.
- Confirm finite calls, no extra authority writes/reads for logging, no replay,
  per-invocation storage and isolation across concurrent queues/drains.
- Verify exporter ownership, transport/admission/buffer/shutdown bounds. Distinguish
  asynchronous export failure from custom synchronous sink defects.
- Require nonempty capture, conversion/serialization, HTTP acceptance and stored
  queries separately, each with positive controls and synthetic canaries.

BAD: outer safe span assumed to sanitize a failed SQL child.
GOOD: protect the owned child before its end; state the app-span boundary.

BAD: count finalization calls as completed durable jobs.
GOOD: count actual acknowledged adapter transitions; retain Unknown separately.

BAD: inherit request IDs into labels or emit `_millis` with OTLP unit `1`.
GOOD: isolate updates, put approved deployment dimensions in resources, verify `ms`.
