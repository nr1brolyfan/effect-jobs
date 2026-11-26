import type { Trace, TraceFrame } from "./DocsTrace.js"

const retry: Trace = {
  title: "Durable retry simulation",
  nodes: [
    {
      title: "PostgreSQL",
      icon: "database",
      fields: ["Job", "State", "Available at", "Finalized attempts", "Lease"]
    },
    { title: "Worker", icon: "worker", fields: ["Process", "Work"] },
    { title: "Mail provider", icon: "provider", fields: ["Delivery key", "Last result"] }
  ],
  scenarios: [
    {
      title: "Restart between attempts",
      frames: [
        {
          label: "t = 0 s · job committed",
          detail: "The order and its job are durable. The worker has not claimed it.",
          nodes: [
            ["J07", "Pending", "0 s", "0", "—"],
            ["A", "Waiting"],
            ["J07", "—"]
          ]
        },
        {
          label: "t = 1 s · worker A claims J07",
          detail: "Claiming creates a lease, not a finalized attempt.",
          nodes: [
            ["J07", "Active", "0 s", "0", "A · until 91 s"],
            ["A", "Running J07"],
            ["J07", "—"]
          ],
          packet: { from: 0, to: 1, label: "Claim J07" }
        },
        {
          label: "t = 2 s · provider rejects before delivery",
          detail:
            "The handler can safely report Retry. Until finalization commits, PostgreSQL still says Active.",
          nodes: [
            ["J07", "Active", "0 s", "0", "A · until 91 s"],
            ["A", "Retry"],
            ["J07", "Not sent"]
          ],
          packet: { from: 2, to: 1, label: "Try later", tone: "amber" }
        },
        {
          label: "t = 2 s · retry committed",
          detail:
            "The 5 s backoff is persisted as availableAt = 7 s. The attempt count advances once and the lease is cleared.",
          nodes: [
            ["J07", "RetryScheduled", "7 s", "1", "—"],
            ["A", "Idle"],
            ["J07", "Not sent"]
          ],
          packet: { from: 1, to: 0, label: "Retry at 7 s", tone: "amber" }
        },
        {
          label: "t = 3 s · worker restarts",
          detail:
            "A is gone. Worker B can read the same row, but an early drain can't claim J07 before 7 s.",
          nodes: [
            ["J07", "RetryScheduled", "7 s", "1", "—"],
            ["B", "Too early to claim"],
            ["J07", "Not sent"]
          ]
        },
        {
          label: "t = 7 s · worker B claims J07",
          detail:
            "The job ID is unchanged, but the lease is new. The worker reuses the same external delivery key.",
          nodes: [
            ["J07", "Active", "7 s", "1", "B · until 97 s"],
            ["B", "Running J07"],
            ["J07", "Not sent"]
          ],
          packet: { from: 0, to: 1, label: "Claim J07" }
        },
        {
          label: "t = 8 s · provider accepts delivery",
          detail:
            "A provider receipt is not itself a job-state transition. The worker still needs to finalize.",
          nodes: [
            ["J07", "Active", "7 s", "1", "B · until 97 s"],
            ["B", "Finalizing"],
            ["J07", "Accepted"]
          ],
          packet: { from: 2, to: 1, label: "Accepted", tone: "green" }
        },
        {
          label: "t = 8 s · completion committed",
          detail:
            "PostgreSQL now records Completed and two finalized attempts. No worker-local retry timer was needed.",
          nodes: [
            ["J07", "Completed", "7 s", "2", "—"],
            ["B", "Idle"],
            ["J07", "Accepted"]
          ],
          packet: { from: 1, to: 0, label: "Complete", tone: "green" }
        }
      ]
    }
  ]
}

const outcomeStart: TraceFrame = {
  label: "J19 is waiting",
  detail: "Compare how the same queued job ends up stored under different observations.",
  nodes: [
    ["J19 · Pending", "0"],
    ["Waiting", "—"],
    ["Not called", "—"]
  ]
}
const outcomeClaim: TraceFrame = {
  label: "Claim committed",
  detail: "The job is Active. The worker hasn't finalized anything yet.",
  nodes: [
    ["J19 · Active", "0"],
    ["Lease owned", "—"],
    ["Not called", "—"]
  ],
  packet: { from: 0, to: 1, label: "Claim J19" }
}
const outcomes: Trace = {
  title: "Job outcome simulation",
  nodes: [
    {
      title: "PostgreSQL",
      icon: "database",
      fields: ["Stored row", "Finalized attempts"]
    },
    { title: "Worker", icon: "worker", fields: ["Phase", "Observation"] },
    { title: "Mail provider", icon: "provider", fields: ["Request", "Evidence"] }
  ],
  scenarios: [
    {
      title: "Provider busy",
      frames: [
        outcomeStart,
        outcomeClaim,
        {
          label: "Provider rejects the request",
          detail:
            "The response establishes that no message was accepted. The handler reports Retry.",
          nodes: [
            ["J19 · Active", "0"],
            ["Finalizing", "Retry"],
            ["Rejected", "No delivery"]
          ],
          packet: { from: 2, to: 1, label: "Busy", tone: "amber" }
        },
        {
          label: "Retry committed",
          detail:
            "Attempts remain, so the row is RetryScheduled. With no attempt budget left, this could instead be Dead.",
          nodes: [
            ["J19 · RetryScheduled", "1"],
            ["Idle", "Retry confirmed"],
            ["Rejected", "No delivery"]
          ],
          packet: { from: 1, to: 0, label: "Retry", tone: "amber" }
        }
      ]
    },
    {
      title: "Permanent rejection",
      frames: [
        outcomeStart,
        outcomeClaim,
        {
          label: "Provider rejects an invalid address",
          detail:
            "Repeating the same request won't repair the address. The handler reports Dead.",
          nodes: [
            ["J19 · Active", "0"],
            ["Finalizing", "Dead"],
            ["Rejected", "Invalid address"]
          ],
          packet: { from: 2, to: 1, label: "Rejected", tone: "amber" }
        },
        {
          label: "Dead committed",
          detail:
            "The rejection is final for this job. Any operator action needs independent evidence and a corrected input or application decision.",
          nodes: [
            ["J19 · Dead", "1"],
            ["Idle", "Terminal"],
            ["Rejected", "No delivery"]
          ],
          packet: { from: 1, to: 0, label: "Dead", tone: "amber" }
        }
      ]
    },
    {
      title: "Invalid payload",
      frames: [
        outcomeStart,
        outcomeClaim,
        {
          label: "Payload decode fails",
          detail:
            "The worker never invokes the handler. It isolates the bad artifact rather than retrying delivery.",
          nodes: [
            ["J19 · Isolated", "1"],
            ["Handler not invoked", "Invalid artifact"],
            ["Not called", "—"]
          ],
          packet: { from: 1, to: 0, label: "Isolate", tone: "amber" }
        }
      ]
    },
    {
      title: "Lost response",
      frames: [
        outcomeStart,
        outcomeClaim,
        {
          label: "Delivery response is lost",
          detail:
            "The provider could have accepted the message. The absence of a response is not evidence of failure.",
          nodes: [
            ["J19 · Active", "0"],
            ["Running", "No response"],
            ["Request received", "Unknown to worker"]
          ],
          packet: { from: 1, to: 2, label: "Send J19" }
        },
        {
          label: "OutcomeUnknown is not a stored state",
          detail:
            "There is no confirmed finalization. The lease remains until expiry; reconcile with the provider before repeating a non-idempotent effect.",
          nodes: [
            ["J19 · Active", "0"],
            ["Stopped", "OutcomeUnknown"],
            ["Request received", "Unknown to worker"]
          ]
        }
      ]
    }
  ]
}

const rolloutStart: TraceFrame = {
  label: "Existing deployment",
  detail:
    "Two v1 jobs still need execution. One of them is currently waiting for its retry time.",
  nodes: [["v1"], ["v1", "v1: 2 · v2: 0"], ["v1"]]
}
const migrations: Trace = {
  title: "Payload rollout simulation",
  nodes: [
    { title: "Producer", icon: "producer", fields: ["Enqueues"] },
    {
      title: "PostgreSQL",
      icon: "database",
      fields: ["Storage schema", "Jobs still needed"]
    },
    { title: "Worker fleet", icon: "worker", fields: ["Installed handlers"] }
  ],
  scenarios: [
    {
      title: "Workers first",
      frames: [
        rolloutStart,
        {
          label: "Apply compatible DDL, if required",
          detail:
            "The migration changes the storage layout. It does not rewrite v1 jobs.",
          nodes: [["v1"], ["v1 + additive change", "v1: 2 · v2: 0"], ["v1"]]
        },
        {
          label: "Install both handlers",
          detail:
            "Roll out workers with support for v1 and v2 before switching the producer.",
          nodes: [["v1"], ["v1 + additive change", "v1: 2 · v2: 0"], ["v1 + v2"]]
        },
        {
          label: "Switch the producer to v2",
          detail:
            "Old retries retain their original contract. New jobs can be claimed immediately by upgraded consumers.",
          nodes: [["v2"], ["v1 + additive change", "v1: 2 · v2: 1"], ["v1 + v2"]],
          packet: { from: 0, to: 1, label: "Enqueue v2" }
        },
        {
          label: "Drain both versions",
          detail:
            "Wait for all old jobs that can still run, including retries and work recoverable from an expired lease.",
          nodes: [["v2"], ["v1 + additive change", "v1: 0 · v2: 1"], ["v1 + v2"]],
          packet: { from: 1, to: 2, label: "Claim v1", tone: "green" }
        },
        {
          label: "Retire v1 deliberately",
          detail:
            "After checking zero outstanding v1 work and any operational replay needs, remove the old handler.",
          nodes: [["v2"], ["v1 + additive change", "v1: 0 · v2: 1"], ["v2"]]
        }
      ]
    },
    {
      title: "Producer first",
      frames: [
        rolloutStart,
        {
          label: "v2 arrives too soon",
          detail:
            "Assume storage is already compatible. Enqueue can succeed without any v2 consumer running.",
          nodes: [["v2"], ["Compatible", "v1: 2 · v2: 1"], ["v1 only"]],
          packet: { from: 0, to: 1, label: "Enqueue v2", tone: "amber" }
        },
        {
          label: "v2 remains pending",
          detail:
            "The v1 worker filters out unsupported versions when claiming. A ready v2 job is not the same as an eligible v1 claim.",
          nodes: [["v2"], ["Compatible", "v1: 0 · v2: 1"], ["v1 only"]]
        },
        {
          label: "Restore worker coverage",
          detail:
            "Install v2 support without losing v1. The pending job becomes eligible without rewriting its payload.",
          nodes: [["v2"], ["Compatible", "v1: 0 · v2: 1"], ["v1 + v2"]],
          packet: { from: 1, to: 2, label: "Claim v2", tone: "green" }
        }
      ]
    }
  ]
}

const protectionStart: TraceFrame = {
  label: "A protected field needs to travel with the job",
  detail:
    "In this example the producer must persist a private note. Only synthetic labels are shown; the lab performs no cryptography.",
  nodes: [
    ["Note (plaintext)", "K1"],
    ["—", "—", "—"],
    ["K1", "—"]
  ]
}
const protectionSeal: TraceFrame = {
  label: "The app codec seals the note",
  detail:
    "The envelope includes ciphertext and a stable keyed fingerprint. Routing metadata is still visible.",
  nodes: [
    ["Sealed note", "K1"],
    ["J31 · Pending", "Envelope · K1", "Fingerprint F1"],
    ["K1", "—"]
  ],
  packet: { from: 0, to: 1, label: "K1 envelope" }
}
const encryption: Trace = {
  title: "Payload protection simulation",
  nodes: [
    { title: "Producer", icon: "producer", fields: ["Input", "Seal key"] },
    {
      title: "PostgreSQL",
      icon: "database",
      fields: ["Visible metadata", "Encoded note", "Projection"]
    },
    { title: "Worker", icon: "worker", fields: ["Open keys", "Decoded note"] }
  ],
  scenarios: [
    {
      title: "Rotate with overlap",
      frames: [
        protectionStart,
        protectionSeal,
        {
          label: "Load K2 before writing with it",
          detail:
            "Deploy workers that can open both versions. Switch new seals to K2 only after worker coverage is ready.",
          nodes: [
            ["New notes seal with K2", "K2"],
            ["J31 · Pending", "Envelope · K1", "Fingerprint F1"],
            ["K1 + K2", "—"]
          ]
        },
        {
          label: "An old job still opens with K1",
          detail:
            "The worker opens the persisted envelope before decoding the domain field and invoking the handler. PostgreSQL never needs the open key.",
          nodes: [
            ["New notes seal with K2", "K2"],
            ["J31 · Active", "Envelope · K1", "Fingerprint F1"],
            ["K1 + K2", "Available to handler"]
          ],
          packet: { from: 1, to: 2, label: "K1 envelope", tone: "green" }
        }
      ]
    },
    {
      title: "Remove K1 too soon",
      frames: [
        protectionStart,
        protectionSeal,
        {
          label: "K1 disappears while J31 is pending",
          detail:
            "The row still carries a K1 envelope. A new seal key does not rewrite old ciphertext.",
          nodes: [
            ["New notes seal with K2", "K2"],
            ["J31 · Pending", "Envelope · K1", "Fingerprint F1"],
            ["K2 only", "—"]
          ]
        },
        {
          label: "The worker cannot open the old envelope",
          detail:
            "A bounded codec failure prevents handler invocation. Keep key problems out of external delivery retries and do not expose plaintext in diagnostics.",
          nodes: [
            ["New notes seal with K2", "K2"],
            ["J31 · Active at claim", "Envelope · K1", "Fingerprint F1"],
            ["K2 only", "Open failed"]
          ],
          packet: { from: 1, to: 2, label: "K1 envelope", tone: "amber" }
        }
      ]
    }
  ]
}

export const traces = { retry, outcomes, migrations, encryption }
