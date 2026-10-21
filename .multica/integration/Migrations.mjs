// apps/playground-worker/src/persistence/MigrationRegistry.ts
import { createHash } from "node:crypto";

// apps/playground-worker/src/persistence/LegacyOperatorsV4.ts
import { relations, tables } from "effect-jobs/PostgreSqlSchema";
var operatorChecks = {
  state: "state=ANYARRAY['Pending','Active','RetryScheduled','Completed','Dead','Isolated','Cancelled']",
  terminal: "state=ANYARRAY['Completed','Dead','Cancelled']=completed_atISNOTNULL"
};
var operatorMigration = (mapping = tables()) => {
  const { jobs } = relations(mapping);
  const oldState = "state=ANYARRAY['Pending','Active','RetryScheduled','Completed','Dead','Isolated']";
  const oldTerminal = "state=ANYARRAY['Completed','Dead']=completed_atISNOTNULL";
  const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
  return `DO $operator_migration$
DECLARE c record; state_name text; terminal_name text; state_count integer := 0; terminal_count integer := 0;
BEGIN
  LOCK TABLE ${jobs} IN ACCESS EXCLUSIVE MODE;
  FOR c IN SELECT conname, regexp_replace(pg_get_expr(conbin,conrelid), '[[:space:]()]|::text', '', 'g') AS expression
    FROM pg_catalog.pg_constraint WHERE conrelid=${literal(jobs)}::regclass AND contype='c'
  LOOP
    IF c.expression IN (${literal(oldState)},${literal(operatorChecks.state)}) THEN
      state_name := c.conname; state_count := state_count + 1;
    ELSIF c.expression IN (${literal(oldTerminal)},${literal(operatorChecks.terminal)}) THEN
      terminal_name := c.conname; terminal_count := terminal_count + 1;
    END IF;
  END LOOP;
  IF state_count <> 1 OR terminal_count <> 1 THEN
    RAISE EXCEPTION 'unsupported operator CHECK constraints';
  END IF;
  EXECUTE format('ALTER TABLE ${jobs} DROP CONSTRAINT %I, DROP CONSTRAINT %I', state_name, terminal_name);
  EXECUTE format('ALTER TABLE ${jobs} ADD CONSTRAINT %I CHECK (state IN (''Pending'',''Active'',''RetryScheduled'',''Completed'',''Dead'',''Isolated'',''Cancelled'')), ADD CONSTRAINT %I CHECK ((state IN (''Completed'',''Dead'',''Cancelled'')) = (completed_at IS NOT NULL))', state_name, terminal_name);
END $operator_migration$;`;
};

// apps/playground-worker/src/persistence/commands/RepairSchema.ts
import { Effect as Effect4, Schema as Schema6 } from "effect";

// packages/playground-contracts/dist/Repairs.js
import { Context as Context3, Effect as Effect3, Schema as Schema5 } from "effect";
import { JobId as JobId3 } from "effect-jobs/JobId";
import { Counter as Counter2 } from "effect-jobs/JobLifecycle";
import { EpochMillis as EpochMillis3 } from "effect-jobs/JobPolicy";

// packages/playground-contracts/dist/Sandbox.js
import { Schema } from "effect";
import { EpochMillis } from "effect-jobs/JobPolicy";
var opaque = Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128)));
var SandboxId = opaque.pipe(Schema.brand("playground/SandboxId"));
var Generation = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })));
var SandboxRef = Schema.Struct({ sandboxId: SandboxId, generation: Generation });
var Capabilities = Schema.Struct({
  runScenario: Schema.Boolean,
  resetSandbox: Schema.Boolean,
  retryJob: Schema.Boolean,
  cancelJob: Schema.Boolean,
  redriveJob: Schema.Boolean
});
var SandboxView = Schema.Struct({
  ref: SandboxRef,
  expiresAt: EpochMillis,
  capacity: Schema.Struct({
    mode: Schema.Literals(["local", "bounded"]),
    retainedJobs: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))),
    admittedCommands: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })))
  }).pipe(Schema.optional),
  capabilities: Capabilities
});
var limits = Object.freeze({
  pageSize: 50,
  jobsPerSandbox: 100,
  scenarioBatch: 10,
  sandboxLifetimeMillis: 36e5,
  reconciliationMillis: 5e3
});

// packages/playground-contracts/dist/Scenarios.js
import { Schema as Schema2 } from "effect";
import { JobId } from "effect-jobs/JobId";
var ScenarioId = Schema2.Literals([
  "success",
  "delayed-success",
  "isolated",
  "retry-then-success",
  "terminal-failure",
  "unknown-outcome",
  "deduplication"
]);
var RequestId = Schema2.String.pipe(Schema2.check(Schema2.isMinLength(1), Schema2.isMaxLength(128)));
var ScenarioCommand = Schema2.Struct({
  sandbox: SandboxRef,
  requestId: RequestId,
  scenario: ScenarioId,
  count: Schema2.Int.pipe(Schema2.check(Schema2.isBetween({ minimum: 1, maximum: 10 })))
});
var ScenarioResult = Schema2.Union([
  Schema2.TaggedStruct("Committed", {
    sandbox: SandboxRef,
    requestId: RequestId,
    jobIds: Schema2.Array(JobId).pipe(Schema2.check(Schema2.isMinLength(1), Schema2.isMaxLength(10)))
  }),
  Schema2.TaggedStruct("OutcomeUnknown", { sandbox: SandboxRef, requestId: RequestId })
]);
var ResetCommand = Schema2.Struct({ sandbox: SandboxRef, requestId: RequestId });
var ResetResult = Schema2.Union([
  Schema2.TaggedStruct("Committed", {
    previous: SandboxRef,
    current: SandboxRef,
    requestId: RequestId
  }),
  Schema2.TaggedStruct("OutcomeUnknown", { previous: SandboxRef, requestId: RequestId })
]).pipe(Schema2.check(Schema2.makeFilter((result) => result._tag === "OutcomeUnknown" || result.previous.sandboxId === result.current.sandboxId && result.current.generation === result.previous.generation + 1)));
var ReceiptRequest = Schema2.Struct({ sandbox: SandboxRef, requestId: RequestId });

// packages/playground-contracts/dist/Operators.js
import { Context as Context2, Effect as Effect2, Schema as Schema4 } from "effect";
import { JobId as JobId2 } from "effect-jobs/JobId";
import { Counter, JobState } from "effect-jobs/JobLifecycle";
import { EpochMillis as EpochMillis2 } from "effect-jobs/JobPolicy";

// packages/playground-contracts/dist/Services.js
import { Context, Effect, Redacted, Schema as Schema3 } from "effect";
var PublicErrorCode = Schema3.Literals([
  "invalid-request",
  "not-found",
  "sandbox-expired",
  "stale-generation",
  "limit-reached",
  "capability-unavailable",
  "unavailable"
]);
var PublicError = Schema3.Struct({ code: PublicErrorCode });
var PlaygroundError = class extends Schema3.TaggedError()("PlaygroundError", { code: PublicErrorCode }) {
};
var SandboxAuthority = class extends Context.Service()("playground/SandboxAuthority") {
};
var JobsRead = class extends Context.Service()("playground/JobsRead") {
};
var Scenarios = class extends Context.Service()("playground/Scenarios") {
};
var Changes = class extends Context.Service()("playground/Changes") {
};

// packages/playground-contracts/dist/Operators.js
var JobOperatorAction = Schema4.Literals(["retry-now", "cancel", "redrive"]);
var guard = {
  sandbox: SandboxRef,
  requestId: RequestId,
  jobId: JobId2,
  expectedState: JobState,
  expectedLifecycleVersion: Counter
};
var JobOperatorCommand = Schema4.Union([
  Schema4.Struct({ ...guard, action: Schema4.Literals(["retry-now", "cancel"]) }),
  Schema4.Struct({
    ...guard,
    action: Schema4.Literal("redrive"),
    confirmDuplicateEffects: Schema4.Literal(true)
  })
]);
var JobOperatorReason = Schema4.Literals([
  "invalid-input",
  "not-found",
  "state-version-conflict",
  "not-eligible",
  "already-due",
  "invalid-artifact",
  "unsupported-catalog",
  "arithmetic-bound",
  "public-read-only",
  "active-execution",
  "terminal-state",
  "investigation-required",
  "exhausted-budget",
  "unavailable",
  "limit-reached"
]);
var JobOperatorResult = Schema4.Union([
  Schema4.TaggedStruct("Committed", {
    sandbox: SandboxRef,
    requestId: RequestId,
    action: JobOperatorAction,
    sourceJobId: JobId2,
    sourceState: JobState,
    sourceLifecycleVersion: Counter,
    resultJobId: JobId2,
    resultState: JobState,
    resultLifecycleVersion: Counter,
    observedAt: EpochMillis2
  }),
  Schema4.TaggedStruct("Rejected", {
    sandbox: SandboxRef,
    requestId: RequestId,
    action: JobOperatorAction,
    jobId: JobId2,
    reason: JobOperatorReason
  }),
  Schema4.TaggedStruct("OutcomeUnknown", { sandbox: SandboxRef, requestId: RequestId })
]);
var JobOperatorReceiptRequest = Schema4.Struct({
  sandbox: SandboxRef,
  requestId: RequestId
});
var eligibility = Schema4.Struct({
  enabled: Schema4.Boolean,
  reason: JobOperatorReason.pipe(Schema4.NullOr)
});
var JobOperatorEligibility = Schema4.Struct({
  retryNow: eligibility,
  cancel: eligibility,
  redrive: eligibility
});
var Operators = class extends Context2.Service()("playground/Operators") {
};

// packages/playground-contracts/dist/Repairs.js
var scalars = (value) => Array.from(value).every((scalar) => scalar.codePointAt(0) < 55296 || scalar.codePointAt(0) > 57343);
var canonicalJson = (input, maximum = 65536) => {
  const seen = /* @__PURE__ */ new Set();
  let length = 0;
  const emit = (text) => {
    length += new TextEncoder().encode(text).length;
    if (length > maximum) {
      throw new Error("JSON size exceeded");
    }
    return text;
  };
  const quote = (text) => {
    if (text.length > maximum || !scalars(text)) {
      throw new Error("Invalid JSON string");
    }
    return emit(JSON.stringify(text));
  };
  const visit = (value, depth) => {
    if (depth > 32) {
      throw new Error("JSON depth exceeded");
    }
    if (value === null) {
      return emit("null");
    }
    if (typeof value === "boolean") {
      return emit(String(value));
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return emit(JSON.stringify(value));
    }
    if (typeof value === "string") {
      return quote(value);
    }
    if (typeof value !== "object" || value === null || seen.has(value)) {
      throw new Error("Invalid JSON");
    }
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error("Invalid JSON container");
    }
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    for (const key of keys) {
      if (array && key === "length") {
        continue;
      }
      const descriptor = descriptors[key];
      if (typeof key !== "string" || !scalars(key) || !descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("Invalid JSON descriptor");
      }
    }
    let result;
    if (array) {
      if (keys.length !== value.length + 1) {
        throw new Error("Invalid JSON array");
      }
      emit("[]");
      const entries = [];
      for (let index = 0; index < value.length; index++) {
        if (index > 0) {
          emit(",");
        }
        const descriptor = descriptors[String(index)];
        if (!descriptor) {
          throw new Error("Sparse JSON array");
        }
        entries.push(visit(descriptor.value, depth + 1));
      }
      result = `[${entries.join(",")}]`;
    } else {
      emit("{}");
      result = `{${keys.sort().map((key, index) => {
        if (index > 0) {
          emit(",");
        }
        return `${quote(key)}${emit(":")}${visit(descriptors[key].value, depth + 1)}`;
      }).join(",")}}`;
    }
    seen.delete(value);
    return result;
  };
  return visit(input, 0);
};
var JsonValue = Schema5.declare((input) => {
  try {
    canonicalJson(input);
    return true;
  } catch {
    return false;
  }
});
var Reason = Schema5.String.pipe(Schema5.check(Schema5.makeFilter((value) => value.length >= 1 && value.length <= 512 && value.trim().length > 0 && !value.includes("\0") && new TextEncoder().encode(value).length <= 1024)));
var JobResolutionState = Schema5.Literals(["Open", "InProgress", "Resolved"]);
var JobProblem = Schema5.Struct({
  rootJobId: JobId3,
  state: JobResolutionState,
  version: Counter2,
  updatedAt: EpochMillis3,
  activeSuccessorJobId: JobId3.pipe(Schema5.NullOr),
  outcomeKnowledge: Schema5.Literals(["KnownFailure", "Unknown"]),
  resolution: Schema5.Struct({
    kind: Schema5.Literals(["SuccessorCompleted", "OperatorReconciled", "ManualClose"]),
    reason: Reason.pipe(Schema5.NullOr),
    observedAt: EpochMillis3,
    successorJobId: JobId3.pipe(Schema5.NullOr)
  }).pipe(Schema5.NullOr)
});
var JobRepairReason = Schema5.Literals([
  ...JobOperatorReason.literals,
  "invalid-payload",
  "resolution-conflict",
  "repair-in-progress",
  "already-resolved",
  "request-conflict",
  "encrypted-correction-unavailable",
  "lineage-conflict"
]);
var Investigation = Schema5.Union([
  Schema5.TaggedStruct("KnownFailure", {}),
  Schema5.TaggedStruct("ConfirmedNotApplied", { reason: Reason }),
  Schema5.TaggedStruct("AcceptDuplicateRisk", { reason: Reason }),
  Schema5.TaggedStruct("Unconfirmed", {})
]);
var guard2 = {
  sandbox: SandboxRef,
  requestId: RequestId,
  jobId: JobId3,
  expectedState: Schema5.Literals(["Dead", "Isolated"]),
  expectedLifecycleVersion: Counter2,
  expectedResolutionVersion: Counter2,
  reason: Reason,
  confirmDuplicateEffects: Schema5.Literal(true),
  investigation: Investigation
};
var JobRepairCommand = Schema5.Union([
  Schema5.Struct({ ...guard2, action: Schema5.Literal("redrive") }),
  Schema5.Struct({
    ...guard2,
    action: Schema5.Literal("corrected-redrive"),
    payload: JsonValue
  })
]);
var JobRepairReceiptRequest = Schema5.Struct({
  sandbox: SandboxRef,
  requestId: RequestId
});
var JobRepairResult = Schema5.Union([
  Schema5.TaggedStruct("Committed", {
    sandbox: SandboxRef,
    requestId: RequestId,
    action: Schema5.Literals(["redrive", "corrected-redrive"]),
    sourceJobId: JobId3,
    sourceState: Schema5.Literals(["Dead", "Isolated"]),
    sourceLifecycleVersion: Counter2,
    resultJobId: JobId3,
    observedAt: EpochMillis3,
    problem: JobProblem
  }),
  Schema5.TaggedStruct("Rejected", {
    sandbox: SandboxRef,
    requestId: RequestId,
    jobId: JobId3,
    reason: JobRepairReason
  }),
  Schema5.TaggedStruct("OutcomeUnknown", { sandbox: SandboxRef, requestId: RequestId })
]);
var JobResolutionCommand = Schema5.Struct({
  sandbox: SandboxRef,
  requestId: RequestId,
  rootJobId: JobId3,
  expectedResolutionVersion: Counter2,
  reason: Reason,
  action: Schema5.Literals(["reconcile-applied", "manual-close"]),
  confirmUnknownOutcome: Schema5.Literal(true).pipe(Schema5.optional)
});
var JobResolutionResult = Schema5.Union([
  Schema5.TaggedStruct("Committed", {
    sandbox: SandboxRef,
    requestId: RequestId,
    problem: JobProblem,
    observedAt: EpochMillis3
  }),
  Schema5.TaggedStruct("Rejected", {
    sandbox: SandboxRef,
    requestId: RequestId,
    rootJobId: JobId3,
    reason: JobRepairReason
  }),
  Schema5.TaggedStruct("OutcomeUnknown", { sandbox: SandboxRef, requestId: RequestId })
]);
var Repairs = class extends Context3.Service()("playground/Repairs") {
};

// apps/playground-worker/src/persistence/authority/Schema.ts
var relations2 = (schema) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error("Invalid playground schema");
  }
  const table = (name) => `"${schema}"."${name}"`;
  return {
    sandboxes: table("sandboxes"),
    associations: table("associations"),
    receipts: table("command_receipts"),
    admission: table("command_admission"),
    audit: table("command_audit"),
    ledger: table("provider_ledger"),
    jobs: table("jobs")
  };
};
var proposal = (schema) => {
  const t = relations2(schema);
  return `CREATE TABLE ${t.sandboxes} (
    sandbox_id text PRIMARY KEY,
    generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
    expires_at bigint NOT NULL,
    credential_hash text NOT NULL UNIQUE,
    viewer_until bigint NOT NULL DEFAULT 0,
    next_generation_at bigint NOT NULL DEFAULT 0,
    retained_jobs integer NOT NULL DEFAULT 0 CHECK (retained_jobs BETWEEN 0 AND 100)
  );
  CREATE TABLE ${t.associations} (
    sandbox_id text NOT NULL REFERENCES ${t.sandboxes}(sandbox_id),
    generation bigint NOT NULL,
    job_id text NOT NULL UNIQUE REFERENCES ${t.jobs}(id),
    relations jsonb NOT NULL,
    PRIMARY KEY (sandbox_id,generation,job_id)
  );
  CREATE TABLE ${t.admission} (
    sandbox_id text NOT NULL REFERENCES ${t.sandboxes}(sandbox_id),
    generation bigint NOT NULL, operation text NOT NULL, request_id text NOT NULL,
    PRIMARY KEY (sandbox_id,generation,operation,request_id)
  );
  CREATE TABLE ${t.receipts} (
    sandbox_id text NOT NULL, generation bigint NOT NULL,
    operation text NOT NULL, request_id text NOT NULL, receipt jsonb NOT NULL,
    PRIMARY KEY (sandbox_id,generation,operation,request_id),
    FOREIGN KEY (sandbox_id,generation,operation,request_id)
      REFERENCES ${t.admission}(sandbox_id,generation,operation,request_id)
  );
  CREATE TABLE ${t.audit} (
    sandbox_id text NOT NULL REFERENCES ${t.sandboxes}(sandbox_id),
    generation bigint NOT NULL, operation text NOT NULL, reason text NOT NULL,
    count integer NOT NULL CHECK (count BETWEEN 0 AND 10), observed_at bigint NOT NULL
  );
  CREATE TABLE ${t.ledger} (
    sandbox_id text NOT NULL, generation bigint NOT NULL,
    job_id text NOT NULL UNIQUE REFERENCES ${t.jobs}(id),
    signature text NOT NULL, accepted boolean NOT NULL, invocations integer NOT NULL,
    PRIMARY KEY (sandbox_id,generation,job_id),
    FOREIGN KEY (sandbox_id,generation,job_id)
      REFERENCES ${t.associations}(sandbox_id,generation,job_id)
  );
  CREATE INDEX ON ${t.associations}(sandbox_id,generation);
  CREATE INDEX ON ${t.sandboxes}(viewer_until);`;
};

// apps/playground-worker/src/persistence/commands/RepairSchema.ts
var relations3 = (schema) => ({
  ...relations2(schema),
  admission: `"${schema}"."repair_admission"`,
  receipts: `"${schema}"."repair_receipts"`,
  problems: `"${schema}"."job_problems"`,
  members: `"${schema}"."job_repair_members"`,
  edges: `"${schema}"."job_repairs"`,
  audit: `"${schema}"."repair_audit"`,
  payloads: `"${schema}"."job_payloads"`
});
var proposal2 = (schema) => {
  const t = relations3(schema);
  const legacy = `"${schema}"."operator_redrives"`;
  return `LOCK TABLE ${t.jobs},${t.associations},${legacy} IN ACCESS EXCLUSIVE MODE;
CREATE TABLE ${t.admission} (
    sandbox_id text NOT NULL REFERENCES ${t.sandboxes}(sandbox_id),
    generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
    operation text NOT NULL CHECK (operation IN ('Repair','Resolution')),
    request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
    command_digest text NOT NULL CHECK (command_digest ~ '^[a-f0-9]{64}$'),
    actor_category text NOT NULL CHECK (actor_category IN ('LocalOperator','SyntheticSeed')),
    PRIMARY KEY(sandbox_id,generation,operation,request_id)
  );
CREATE TABLE ${t.receipts} (
    sandbox_id text NOT NULL, generation bigint NOT NULL, operation text NOT NULL,
    request_id text NOT NULL, command_digest text NOT NULL, receipt jsonb NOT NULL,
    CHECK (octet_length(receipt::text) <= 16384),
    PRIMARY KEY(sandbox_id,generation,operation,request_id),
    FOREIGN KEY(sandbox_id,generation,operation,request_id) REFERENCES ${t.admission}(sandbox_id,generation,operation,request_id)
  );
CREATE TABLE ${t.problems} (
    sandbox_id text NOT NULL REFERENCES ${t.sandboxes}(sandbox_id),
    generation bigint NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
    root_job_id text NOT NULL, problem jsonb NOT NULL,
    CHECK (problem->>'rootJobId'=root_job_id),
    CHECK (problem->>'state' IN ('Open','InProgress','Resolved')),
    CHECK ((problem->>'version')::bigint BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY(sandbox_id,generation,root_job_id)
  );
CREATE TABLE ${t.members} (
    sandbox_id text NOT NULL, generation bigint NOT NULL,
    job_id text NOT NULL, live_job_id text, root_job_id text NOT NULL,
    CHECK(live_job_id IS NULL OR live_job_id=job_id),
    PRIMARY KEY(sandbox_id,generation,job_id),
    FOREIGN KEY(sandbox_id,generation,root_job_id) REFERENCES ${t.problems}(sandbox_id,generation,root_job_id),
    FOREIGN KEY(sandbox_id,generation,live_job_id) REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE SET NULL (live_job_id)
  );
CREATE INDEX ON ${t.members}(sandbox_id,generation,root_job_id,job_id);
CREATE INDEX ON ${t.members}(live_job_id) WHERE live_job_id IS NOT NULL;
CREATE TABLE ${t.edges} (
    sandbox_id text NOT NULL, generation bigint NOT NULL, request_id text NOT NULL,
    operation text NOT NULL DEFAULT 'Repair' CHECK(operation='Repair'),
    root_job_id text NOT NULL, original_source_job_id text NOT NULL, source_job_id text,
    result_job_id text NOT NULL, live_result_job_id text,
    action text NOT NULL CHECK(action IN ('redrive','corrected-redrive')),
    observed_at bigint NOT NULL, reason text NOT NULL, changes jsonb,
    CHECK(source_job_id IS NULL OR source_job_id=original_source_job_id),
    CHECK(live_result_job_id IS NULL OR live_result_job_id=result_job_id),
    CHECK(original_source_job_id<>result_job_id),
    PRIMARY KEY(sandbox_id,generation,request_id),
    UNIQUE(sandbox_id,generation,result_job_id),
    FOREIGN KEY(sandbox_id,generation,operation,request_id) REFERENCES ${t.receipts}(sandbox_id,generation,operation,request_id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(sandbox_id,generation,root_job_id) REFERENCES ${t.problems}(sandbox_id,generation,root_job_id),
    FOREIGN KEY(sandbox_id,generation,source_job_id) REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE SET NULL (source_job_id),
    FOREIGN KEY(sandbox_id,generation,live_result_job_id) REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE SET NULL (live_result_job_id)
  );
CREATE INDEX ON ${t.edges}(sandbox_id,generation,root_job_id,result_job_id);
CREATE INDEX ON ${t.edges}(source_job_id) WHERE source_job_id IS NOT NULL;
CREATE INDEX ON ${t.edges}(live_result_job_id) WHERE live_result_job_id IS NOT NULL;
CREATE TABLE ${t.audit} (
    sandbox_id text NOT NULL, generation bigint NOT NULL, identity text NOT NULL,
    root_job_id text NOT NULL, successor_job_id text, observed_lifecycle_version bigint,
    action text NOT NULL, fact jsonb NOT NULL, observed_at bigint NOT NULL,
    PRIMARY KEY(sandbox_id,generation,identity,action),
    FOREIGN KEY(sandbox_id,generation,root_job_id) REFERENCES ${t.problems}(sandbox_id,generation,root_job_id)
  );
CREATE INDEX ON ${t.audit}(sandbox_id,generation,root_job_id,observed_at,identity);
CREATE UNIQUE INDEX ON ${t.audit}(sandbox_id,generation,root_job_id,successor_job_id,observed_lifecycle_version) NULLS NOT DISTINCT WHERE action='reconciliation';

-- Validate exact historical acceptance before generic lineage backfill. Fail
-- ambiguity instead of deriving history from matching producer identity.
DO $repair$ BEGIN
  IF EXISTS(SELECT 1 FROM ${legacy} e LEFT JOIN ${relations2(schema).receipts} r
    ON r.sandbox_id=e.sandbox_id AND r.generation=e.generation AND r.request_id=e.request_id AND r.operation='Operator'
    WHERE r.receipt->'result'->>'_tag' IS DISTINCT FROM 'Committed'
      OR r.receipt->'result'->>'action' IS DISTINCT FROM 'redrive'
      OR r.receipt->'result'->>'sourceJobId' IS DISTINCT FROM e.source_job_id
      OR r.receipt->'result'->>'resultJobId' IS DISTINCT FROM e.successor_job_id
      OR (r.receipt->'result'->>'sourceLifecycleVersion')::bigint IS DISTINCT FROM e.source_lifecycle_version
      OR r.receipt->'result'->>'sourceState' IS DISTINCT FROM e.source_state
      OR r.receipt->'result'->'sandbox'->>'sandboxId' IS DISTINCT FROM e.sandbox_id
      OR (r.receipt->'result'->'sandbox'->>'generation')::bigint IS DISTINCT FROM e.generation
      OR r.receipt->'result'->>'requestId' IS DISTINCT FROM e.request_id)
    THEN RAISE EXCEPTION 'Invalid historical redrive receipt'; END IF;
  IF EXISTS(SELECT 1 FROM ${legacy} GROUP BY sandbox_id,generation,source_job_id HAVING count(*)>1)
    THEN RAISE EXCEPTION 'Ambiguous historical repair branch'; END IF;
END $repair$;
CREATE TEMP TABLE repair_backfill ON COMMIT DROP AS
WITH RECURSIVE chain AS (
  SELECT e.sandbox_id,e.generation,e.source_job_id AS root_job_id,e.source_job_id AS job_id,ARRAY[e.source_job_id] AS path
  FROM ${legacy} e WHERE NOT EXISTS(SELECT 1 FROM ${legacy} p WHERE p.sandbox_id=e.sandbox_id AND p.generation=e.generation AND p.successor_job_id=e.source_job_id)
  UNION ALL
  SELECT c.sandbox_id,c.generation,c.root_job_id,e.successor_job_id,c.path||e.successor_job_id
  FROM chain c JOIN ${legacy} e ON e.sandbox_id=c.sandbox_id AND e.generation=c.generation AND e.source_job_id=c.job_id
  WHERE NOT e.successor_job_id=ANY(c.path)
) SELECT * FROM chain;
DO $repair$ BEGIN
  IF EXISTS(SELECT 1 FROM ${legacy} e WHERE NOT EXISTS(SELECT 1 FROM repair_backfill b WHERE b.sandbox_id=e.sandbox_id AND b.generation=e.generation AND b.job_id=e.successor_job_id))
    THEN RAISE EXCEPTION 'Cyclic historical repair chain'; END IF;
  IF EXISTS(SELECT 1 FROM ${legacy} e JOIN ${t.jobs} j ON j.id=e.successor_job_id
    WHERE j.original_source_job_id IS NOT NULL AND (j.original_source_job_id<>e.source_job_id OR j.redrive_kind<>'Redrive'))
    THEN RAISE EXCEPTION 'Conflicting historical core lineage'; END IF;
END $repair$;
UPDATE ${t.jobs} j SET original_source_job_id=e.source_job_id,source_job_id=e.source_job_id,redrive_kind='Redrive'
FROM ${legacy} e WHERE j.id=e.successor_job_id AND j.original_source_job_id IS NULL;
INSERT INTO ${t.problems}(sandbox_id,generation,root_job_id,problem)
SELECT DISTINCT ON (b.sandbox_id,b.generation,b.root_job_id) b.sandbox_id,b.generation,b.root_job_id,
  jsonb_build_object('rootJobId',b.root_job_id,'state','InProgress','version',1,'updatedAt',e.observed_at,
    'activeSuccessorJobId',e.successor_job_id,'outcomeKnowledge','Unknown','resolution',NULL)
FROM repair_backfill b JOIN ${legacy} e ON e.sandbox_id=b.sandbox_id AND e.generation=b.generation AND e.successor_job_id=b.job_id
WHERE NOT EXISTS(SELECT 1 FROM ${legacy} n WHERE n.sandbox_id=e.sandbox_id AND n.generation=e.generation AND n.source_job_id=e.successor_job_id)
ORDER BY b.sandbox_id,b.generation,b.root_job_id;
INSERT INTO ${t.members}(sandbox_id,generation,root_job_id,job_id,live_job_id)
SELECT sandbox_id,generation,root_job_id,job_id,job_id FROM repair_backfill;

-- Retain durable identities while releasing the old restrictive live references.
ALTER TABLE ${legacy} ADD COLUMN original_source_job_id text;
ALTER TABLE ${legacy} ADD COLUMN original_successor_job_id text;
ALTER TABLE ${legacy} ADD COLUMN root_job_id text;
ALTER TABLE ${legacy} ADD COLUMN redrive_kind text NOT NULL DEFAULT 'Redrive' CHECK(redrive_kind='Redrive');
ALTER TABLE ${legacy} ADD COLUMN reason text;
UPDATE ${legacy} SET original_source_job_id=source_job_id,original_successor_job_id=successor_job_id;
UPDATE ${legacy} e SET root_job_id=b.root_job_id FROM repair_backfill b
WHERE b.sandbox_id=e.sandbox_id AND b.generation=e.generation AND b.job_id=e.source_job_id;
ALTER TABLE ${legacy} ALTER COLUMN original_source_job_id SET NOT NULL;
ALTER TABLE ${legacy} ALTER COLUMN original_successor_job_id SET NOT NULL;
ALTER TABLE ${legacy} ALTER COLUMN root_job_id SET NOT NULL;
ALTER TABLE ${legacy} ADD UNIQUE(sandbox_id,generation,original_successor_job_id);
ALTER TABLE ${legacy} ADD CHECK(original_source_job_id<>original_successor_job_id);
ALTER TABLE ${legacy} ADD FOREIGN KEY(sandbox_id,generation,root_job_id) REFERENCES ${t.problems}(sandbox_id,generation,root_job_id);
ALTER TABLE ${legacy} ALTER COLUMN source_job_id DROP NOT NULL;
ALTER TABLE ${legacy} ALTER COLUMN successor_job_id DROP NOT NULL;
DO $repair$ DECLARE c record; n integer:=0; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='${legacy}'::regclass AND contype='f' AND confrelid='${t.associations}'::regclass LOOP
    EXECUTE format('ALTER TABLE ${legacy} DROP CONSTRAINT %I',c.conname); n:=n+1;
  END LOOP;
  IF n<>2 THEN RAISE EXCEPTION 'Unexpected historical lineage constraints'; END IF;
END $repair$;
ALTER TABLE ${legacy} ADD CHECK(source_job_id IS NULL OR source_job_id=original_source_job_id);
ALTER TABLE ${legacy} ADD CHECK(successor_job_id IS NULL OR successor_job_id=original_successor_job_id);
ALTER TABLE ${legacy} ADD FOREIGN KEY(sandbox_id,generation,source_job_id) REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE SET NULL (source_job_id);
ALTER TABLE ${legacy} ADD FOREIGN KEY(sandbox_id,generation,successor_job_id) REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE SET NULL (successor_job_id);
CREATE INDEX ON ${legacy}(source_job_id) WHERE source_job_id IS NOT NULL;`;
};

// apps/playground-worker/src/persistence/commands/OperatorSchema.ts
var proposal3 = (schema) => {
  const t = relations2(schema);
  const lineage = `"${schema}"."operator_redrives"`;
  return `ALTER TABLE ${t.admission} ADD COLUMN operator_command text;
ALTER TABLE ${t.admission} ADD CONSTRAINT operator_command_required
  CHECK ((operation='Operator') = (operator_command IS NOT NULL));
ALTER TABLE ${t.admission} ADD CONSTRAINT operator_command_bounded
  CHECK (operator_command IS NULL OR octet_length(operator_command) BETWEEN 1 AND 4096);
CREATE TABLE ${lineage} (
  sandbox_id text NOT NULL,
  generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  operation text NOT NULL DEFAULT 'Operator' CHECK (operation='Operator'),
  source_job_id text NOT NULL,
  source_state text NOT NULL CHECK (source_state IN ('Dead','Isolated')),
  source_lifecycle_version bigint NOT NULL CHECK (source_lifecycle_version BETWEEN 0 AND 9007199254740991),
  successor_job_id text NOT NULL UNIQUE,
  observed_at bigint NOT NULL CHECK (observed_at BETWEEN 1 AND 253402300799999),
  PRIMARY KEY (sandbox_id,generation,request_id),
  CHECK (source_job_id<>successor_job_id),
  FOREIGN KEY (sandbox_id,generation,source_job_id)
    REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE RESTRICT,
  FOREIGN KEY (sandbox_id,generation,successor_job_id)
    REFERENCES ${t.associations}(sandbox_id,generation,job_id) ON DELETE RESTRICT,
  FOREIGN KEY (sandbox_id,generation,operation,request_id)
    REFERENCES ${t.receipts}(sandbox_id,generation,operation,request_id) ON DELETE RESTRICT
);`;
};

// apps/playground-worker/src/persistence/MigrationRegistry.ts
import * as Jobs from "effect-jobs/PostgreSqlSchema";

// apps/playground-worker/src/persistence/LegacyJobsV1.ts
import { indexPrefix, relations as relations4, tables as tables2 } from "effect-jobs/PostgreSqlSchema";
var migration = (mapping = tables2()) => {
  const { jobs, payloads } = relations4(mapping);
  const prefix = indexPrefix(mapping);
  return `CREATE TABLE ${jobs} (
  id text PRIMARY KEY,
  operation text NOT NULL, operation_id text NOT NULL, slot text NOT NULL,
  queue text NOT NULL, kind text NOT NULL, version integer NOT NULL,
  policy jsonb NOT NULL, initial_available_at bigint,
  state text NOT NULL CHECK (state IN ('Pending','Active','RetryScheduled','Completed','Dead','Isolated')),
  available_at bigint NOT NULL, updated_at bigint NOT NULL,
  attempts_made bigint NOT NULL DEFAULT 0 CHECK (attempts_made >= 0),
  stalled_count bigint NOT NULL DEFAULT 0 CHECK (stalled_count >= 0),
  lifecycle_version bigint NOT NULL DEFAULT 0 CHECK (lifecycle_version >= 0),
  lease_token text, lease_expires_at bigint, completed_at bigint, last_failure_code text, cleanup_at bigint,
  UNIQUE (operation, operation_id, slot), UNIQUE (lease_token),
  CHECK ((state = 'Active') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state = 'Active' OR (lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((state IN ('Completed','Dead')) = (completed_at IS NOT NULL))
);
CREATE TABLE ${payloads} (
  job_id text PRIMARY KEY REFERENCES ${jobs}(id) ON DELETE CASCADE,
  format_version integer NOT NULL,
  payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 65536),
  projection bytea NOT NULL CHECK (octet_length(projection) BETWEEN 1 AND 65536)
);
CREATE INDEX "${prefix}_due" ON ${jobs} (queue, kind, version, available_at, id)
  WHERE state IN ('Pending','RetryScheduled');
CREATE INDEX "${prefix}_expired" ON ${jobs} (lease_expires_at, id) WHERE state = 'Active';
CREATE INDEX "${prefix}_terminal" ON ${jobs} (cleanup_at, id) WHERE state IN ('Completed','Dead');`;
};

// apps/playground-worker/src/demo/Traffic.ts
var maxRetainedJobs = 2e4;

// apps/playground-worker/src/persistence/authority/LocalPrivateSchema.ts
var proposal4 = (schema) => {
  const t = relations2(schema);
  return `ALTER TABLE ${t.sandboxes} DROP CONSTRAINT sandboxes_check;
    ALTER TABLE ${t.sandboxes} ALTER COLUMN retained_jobs TYPE bigint;
    ALTER TABLE ${t.sandboxes} ADD CONSTRAINT sandboxes_retained_jobs_check
      CHECK (retained_jobs BETWEEN 0 AND 9007199254740991
        AND (NOT demo_owned OR retained_jobs<=${maxRetainedJobs}));`;
};

// apps/playground-worker/src/demo/Schema.ts
var proposal5 = (schema) => {
  const t = relations2(schema);
  return `ALTER TABLE ${t.sandboxes} ADD COLUMN demo_owned boolean NOT NULL DEFAULT false;
    ALTER TABLE ${t.sandboxes} DROP CONSTRAINT sandboxes_retained_jobs_check;
    ALTER TABLE ${t.sandboxes} ADD CHECK (retained_jobs BETWEEN 0 AND 3000);
    CREATE TABLE "${schema}"."demo_control" (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      current_id text REFERENCES ${t.sandboxes}(sandbox_id),
      candidate_id text REFERENCES ${t.sandboxes}(sandbox_id),
      rotate_at bigint NOT NULL DEFAULT 0,
      next_tick bigint NOT NULL DEFAULT 0,
      sequence bigint NOT NULL DEFAULT 0
    );
    INSERT INTO "${schema}"."demo_control"(singleton) VALUES(true);`;
};
var volumeProposal = (schema) => {
  const t = relations2(schema);
  return `ALTER TABLE ${t.sandboxes} DROP CONSTRAINT sandboxes_retained_jobs_check;
    ALTER TABLE ${t.sandboxes} ADD CHECK (retained_jobs BETWEEN 0 AND ${maxRetainedJobs} AND (demo_owned OR retained_jobs<=100));`;
};

// apps/playground-worker/src/persistence/SyntheticTenantBackfill.ts
import { Effect as Effect9, Schema as Schema12 } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as Codec2 from "effect-jobs/JobPayloadCodec";
import { JobId as JobId5 } from "effect-jobs/JobId";
import { CatalogIdentity as CatalogIdentity2 } from "effect-jobs/JobIdentity";

// packages/playground-contracts/dist/Jobs.js
import { Schema as Schema7 } from "effect";
import { JobId as JobId4 } from "effect-jobs/JobId";
import { CatalogIdentity, ProducerIdentity } from "effect-jobs/JobIdentity";
import { Counter as Counter3, JobState as JobState2 } from "effect-jobs/JobLifecycle";
import { EpochMillis as EpochMillis4, PersistedJobPolicy } from "effect-jobs/JobPolicy";
import { FailureCode } from "effect-jobs/JobFailure";
var Cursor = Schema7.String.pipe(Schema7.check(Schema7.isMinLength(1), Schema7.isMaxLength(1024)));
var JobFilters = Schema7.Struct({
  state: JobState2.pipe(Schema7.optional),
  kind: CatalogIdentity.fields.kind.pipe(Schema7.optional),
  resolution: JobResolutionState.pipe(Schema7.optional),
  needsAttention: Schema7.Literal(true).pipe(Schema7.optional)
});
var ListJobs = Schema7.Struct({
  sandbox: SandboxRef,
  filters: JobFilters,
  cursor: Cursor.pipe(Schema7.optional),
  limit: Schema7.Int.pipe(Schema7.check(Schema7.isBetween({ minimum: 1, maximum: 50 })))
});
var JobSummary = Schema7.Struct({
  jobId: JobId4,
  catalog: CatalogIdentity,
  state: JobState2,
  availableAt: EpochMillis4,
  updatedAt: EpochMillis4,
  completedAt: EpochMillis4.pipe(Schema7.NullOr),
  attemptsMade: Counter3,
  stalledCount: Counter3,
  lifecycleVersion: Counter3,
  lastFailureCode: FailureCode.pipe(Schema7.NullOr)
}).pipe(Schema7.check(Schema7.makeFilter((job) => (job.state === "Completed" || job.state === "Dead" || job.state === "Cancelled") === (job.completedAt !== null))));
var JobStats = Schema7.Struct({
  total: Counter3,
  Pending: Counter3,
  RetryScheduled: Counter3,
  Active: Counter3,
  Completed: Counter3,
  Dead: Counter3,
  Cancelled: Counter3,
  Isolated: Counter3
}).pipe(Schema7.check(Schema7.makeFilter((stats) => stats.total === stats.Pending + stats.RetryScheduled + stats.Active + stats.Completed + stats.Dead + stats.Isolated + stats.Cancelled)));
var JobAttentionStats = Schema7.Struct({
  Open: Counter3,
  InProgress: Counter3,
  Resolved: Counter3,
  needsAttention: Counter3
}).pipe(Schema7.check(Schema7.makeFilter((s) => s.needsAttention === s.Open + s.InProgress)));
var JobPage = Schema7.Struct({
  sandbox: SandboxRef,
  items: Schema7.Array(JobSummary).pipe(Schema7.check(Schema7.isMaxLength(50))),
  nextCursor: Cursor.pipe(Schema7.NullOr),
  // Matching rows before the cursor predicate, from the same scoped SQL snapshot.
  filteredTotal: Counter3,
  stats: JobStats,
  attentionStats: JobAttentionStats
});
var JobDetailRequest = Schema7.Struct({ sandbox: SandboxRef, jobId: JobId4 });
var ApplicationRelations = Schema7.Struct({
  syntheticOrderId: Schema7.Literals(["demo-order-a", "demo-order-b"]).pipe(Schema7.optional),
  syntheticActor: Schema7.Literal("demo-customer").pipe(Schema7.optional),
  syntheticTenant: Schema7.Literals(["demo-tenant-a", "demo-tenant-b"]).pipe(Schema7.optional)
});
var Observation = Schema7.Struct({
  source: Schema7.Literals(["mock", "local", "workerd", "hosted"]),
  observedAt: EpochMillis4,
  outcome: Schema7.Literals(["success", "retry", "dead", "isolated", "unknown"])
});
var JobRedriveKind = Schema7.Literals(["Redrive", "CorrectedRedrive"]);
var JobLineage = Schema7.Struct({
  originalSourceJobId: JobId4,
  sourceJobId: JobId4.pipe(Schema7.NullOr),
  kind: JobRedriveKind
});
var JobPayloadView = Schema7.Union([
  Schema7.TaggedStruct("Available", {
    formatVersion: Schema7.Literal(1),
    catalog: CatalogIdentity,
    encoded: JsonValue,
    validation: Schema7.Literal("Valid"),
    encryption: Schema7.Literals(["None", "PrivateDocumentV1", "SyntheticDocumentV1"])
  }),
  Schema7.TaggedStruct("Unavailable", {
    reason: Schema7.Literals(["not-stored", "invalid-artifact", "unsupported-catalog"])
  })
]);
var JobHistoryItem = Schema7.Union([
  Schema7.TaggedStruct("Snapshot", { job: JobSummary, observedAt: EpochMillis4 }),
  Schema7.TaggedStruct("Operator", {
    requestId: RequestId,
    action: Schema7.Literals(["retry-now", "cancel", "redrive", "corrected-redrive"]),
    sourceJobId: JobId4,
    resultJobId: JobId4,
    observedAt: EpochMillis4
  }),
  Schema7.TaggedStruct("Resolution", {
    rootJobId: JobId4,
    state: JobResolutionState,
    kind: Schema7.Literals([
      "SuccessorCompleted",
      "OperatorReconciled",
      "ManualClose",
      "Reopened"
    ]),
    reason: Reason.pipe(Schema7.NullOr),
    observedAt: EpochMillis4
  })
]);
var JobHistory = Schema7.Struct({
  coverage: Schema7.Literal("RetainedFacts"),
  attempts: Schema7.Null,
  items: Schema7.Array(JobHistoryItem).pipe(Schema7.check(Schema7.isMaxLength(50))),
  nextCursor: Cursor.pipe(Schema7.NullOr)
});
var JobRelatedItem = Schema7.Struct({
  jobId: JobId4,
  state: JobState2.pipe(Schema7.NullOr),
  kind: JobRedriveKind.pipe(Schema7.NullOr),
  sourceAvailable: Schema7.Boolean
});
var JobRelatedPage = Schema7.Struct({
  items: Schema7.Array(JobRelatedItem).pipe(Schema7.check(Schema7.isMaxLength(50))),
  nextCursor: Cursor.pipe(Schema7.NullOr)
});
var JobDetailPageRequest = Schema7.Struct({
  sandbox: SandboxRef,
  jobId: JobId4,
  cursor: Cursor.pipe(Schema7.optional),
  limit: Schema7.Int.pipe(Schema7.check(Schema7.isBetween({ minimum: 1, maximum: 50 })))
});
var JobProblemRow = Schema7.Struct({
  problem: JobProblem,
  representative: JobSummary.pipe(Schema7.NullOr)
});
var JobProblemPage = Schema7.Struct({
  sandbox: SandboxRef,
  items: Schema7.Array(JobProblemRow).pipe(Schema7.check(Schema7.isMaxLength(50))),
  nextCursor: Cursor.pipe(Schema7.NullOr),
  filteredTotal: Counter3,
  stats: JobStats,
  attentionStats: JobAttentionStats
});
var repairEligibility = Schema7.Struct({
  enabled: Schema7.Boolean,
  reason: JobRepairReason.pipe(Schema7.NullOr)
});
var JobDetail = Schema7.Struct({
  sandbox: SandboxRef,
  job: JobSummary,
  producer: ProducerIdentity,
  policy: PersistedJobPolicy,
  relations: ApplicationRelations,
  observation: Observation.pipe(Schema7.optional),
  createdAt: Schema7.Null,
  payload: JobPayloadView,
  result: Schema7.TaggedStruct("Unavailable", { reason: Schema7.Literal("not-stored") }),
  history: JobHistory,
  provider: Schema7.Struct({
    source: Schema7.Literal("synthetic-postgresql"),
    accepted: Schema7.Boolean,
    invocations: Counter3,
    observedAt: Schema7.Null
  }).pipe(Schema7.NullOr),
  lineage: JobLineage.pipe(Schema7.NullOr),
  problem: JobProblem.pipe(Schema7.NullOr),
  related: JobRelatedPage,
  eligibility: Schema7.Struct({
    redrive: repairEligibility,
    correctedRedrive: repairEligibility
  })
});

// apps/playground-worker/src/scenarios/Definitions.ts
import { Effect as Effect7, Schema as Schema10 } from "effect";
import * as Job from "effect-jobs/Job";
import * as JobProducer from "effect-jobs/JobProducer";
import * as JobQueue from "effect-jobs/JobQueue";

// packages/playground-contracts/dist/SyntheticCryptoFixture.js
import { Effect as Effect5, Schema as Schema8 } from "effect";
var Document = Schema8.Struct({
  subject: Schema8.Literal("demo-customer"),
  tenant: Schema8.Literals(["demo-tenant-a", "demo-tenant-b"]),
  note: Schema8.String.pipe(Schema8.check(Schema8.isMaxLength(256)))
});
var Byte = Schema8.Int.pipe(Schema8.check(Schema8.isBetween({ minimum: 0, maximum: 255 })));
var Envelope = Schema8.Struct({
  nonce: Schema8.Array(Byte).pipe(Schema8.check(Schema8.isMinLength(12), Schema8.isMaxLength(12))),
  ciphertext: Schema8.Array(Byte).pipe(Schema8.check(Schema8.isMinLength(16), Schema8.isMaxLength(2048))),
  fingerprint: Schema8.String.pipe(Schema8.check(Schema8.isPattern(/^[0-9a-f]{64}$/)))
});
var PayloadUnlockError = class extends Schema8.TaggedError()("PayloadUnlockError", {
  reason: Schema8.Literals([
    "invalid-key",
    "authentication-failed",
    "unsupported-envelope",
    "unavailable"
  ])
}) {
};
var aad = new TextEncoder().encode("playground-private-document-v1");
var canonical = (value) => new TextEncoder().encode(JSON.stringify({ subject: value.subject, tenant: value.tenant, note: value.note }));
var hex = (value) => Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
var operation = (run2, reason) => Effect5.tryPromise({ try: run2, catch: () => new PayloadUnlockError({ reason }) });
var importDocumentKeys = (encryption, fingerprint) => Effect5.suspend(() => {
  if (encryption.length !== 32 || fingerprint.length !== 32 || encryption.every((byte, index) => byte === fingerprint[index])) {
    return Effect5.fail(new PayloadUnlockError({ reason: "invalid-key" }));
  }
  return Effect5.acquireUseRelease(Effect5.sync(() => ({
    encryption: new Uint8Array(encryption),
    fingerprint: new Uint8Array(fingerprint)
  })), (raw) => operation(async () => ({
    encryption: await crypto.subtle.importKey("raw", raw.encryption, "AES-GCM", false, ["encrypt", "decrypt"]),
    fingerprint: await crypto.subtle.importKey("raw", raw.fingerprint, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
  }), "invalid-key"), (raw) => Effect5.sync(() => {
    raw.encryption.fill(0);
    raw.fingerprint.fill(0);
  }));
});
var syntheticDocumentKeys = () => Effect5.acquireUseRelease(Effect5.sync(() => ({
  encryption: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  fingerprint: Uint8Array.from({ length: 32 }, (_, index) => index + 101)
})), (raw) => importDocumentKeys(raw.encryption, raw.fingerprint), (raw) => Effect5.sync(() => {
  raw.encryption.fill(0);
  raw.fingerprint.fill(0);
}));
var openDocument = (input, keys) => Effect5.gen(function* () {
  const envelope = yield* Schema8.decodeUnknownEffect(Envelope)(input, {
    onExcessProperty: "error"
  }).pipe(Effect5.mapError(() => new PayloadUnlockError({ reason: "unsupported-envelope" })));
  const nonce = new Uint8Array(envelope.nonce);
  const ciphertext = new Uint8Array(envelope.ciphertext);
  const signature = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(envelope.fingerprint.slice(index * 2, index * 2 + 2), 16));
  return yield* Effect5.acquireUseRelease(operation(async () => new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, keys.encryption, ciphertext)), "authentication-failed"), (bytes) => Effect5.gen(function* () {
    const parsed = yield* Effect5.try({
      try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      catch: () => new PayloadUnlockError({ reason: "authentication-failed" })
    });
    const document = yield* Schema8.decodeUnknownEffect(Document)(parsed, {
      onExcessProperty: "error"
    }).pipe(Effect5.mapError(() => new PayloadUnlockError({ reason: "authentication-failed" })));
    return yield* Effect5.acquireUseRelease(Effect5.sync(() => canonical(document)), (message) => operation(() => crypto.subtle.verify("HMAC", keys.fingerprint, signature, message), "authentication-failed").pipe(Effect5.flatMap((valid) => valid ? Effect5.succeed(document) : Effect5.fail(new PayloadUnlockError({ reason: "authentication-failed" })))), (message) => Effect5.sync(() => message.fill(0)));
  }), (bytes) => Effect5.sync(() => bytes.fill(0)));
});
var sealSyntheticDocument = (input) => Effect5.gen(function* () {
  const document = yield* Schema8.decodeUnknownEffect(Document)(input, {
    onExcessProperty: "error"
  }).pipe(Effect5.mapError(() => new PayloadUnlockError({ reason: "authentication-failed" })));
  const keys = yield* syntheticDocumentKeys();
  return yield* Effect5.acquireUseRelease(Effect5.sync(() => canonical(document)), (bytes) => operation(async () => {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, keys.encryption, bytes);
    const fingerprint = hex(await crypto.subtle.sign("HMAC", keys.fingerprint, bytes));
    return {
      nonce: Array.from(nonce),
      ciphertext: Array.from(new Uint8Array(ciphertext)),
      fingerprint
    };
  }, "unavailable"), (bytes) => Effect5.sync(() => bytes.fill(0)));
});
var openSyntheticDocument = (envelope) => syntheticDocumentKeys().pipe(Effect5.flatMap((keys) => openDocument(envelope, keys)));

// apps/playground-worker/src/scenarios/Definitions.ts
import * as JobPayload2 from "effect-jobs/JobPayload";

// apps/playground-worker/src/scenarios/PrivateDocument.ts
import { Context as Context4, Effect as Effect6, Layer, Schema as Schema9 } from "effect";
import * as JobPayload from "effect-jobs/JobPayload";
var DocumentKeys = class extends Context4.Service()("playground/DocumentKeys") {
};
var Document2 = Schema9.Struct({
  subject: Schema9.Literal("demo-customer"),
  tenant: Schema9.Literals(["demo-tenant-a", "demo-tenant-b"]),
  note: Schema9.String.pipe(Schema9.check(Schema9.isMaxLength(256)))
});
var Envelope2 = Schema9.Struct({
  nonce: Schema9.Array(
    Schema9.Int.pipe(Schema9.check(Schema9.isBetween({ minimum: 0, maximum: 255 })))
  ).pipe(Schema9.check(Schema9.isMinLength(12), Schema9.isMaxLength(12))),
  ciphertext: Schema9.Array(
    Schema9.Int.pipe(Schema9.check(Schema9.isBetween({ minimum: 0, maximum: 255 })))
  ).pipe(Schema9.check(Schema9.isMaxLength(2048))),
  fingerprint: Schema9.String.pipe(
    Schema9.check(Schema9.isMinLength(64), Schema9.isMaxLength(64))
  )
});
var aad2 = new TextEncoder().encode("playground-private-document-v1");
var canonical2 = (value) => new TextEncoder().encode(
  JSON.stringify({ subject: value.subject, tenant: value.tenant, note: value.note })
);
var hex2 = (value) => Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
var cryptoOperation = (run2) => Effect6.tryPromise({ try: run2, catch: () => new JobPayload.JobEncryptionError() });
var keysLayer = Layer.effect(
  DocumentKeys,
  cryptoOperation(async () => ({
    encryption: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt"
    ]),
    fingerprint: await crypto.subtle.generateKey(
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign", "verify"]
    )
  }))
);
var codec = {
  envelope: Envelope2,
  seal: (value) => Effect6.gen(function* () {
    const keys = yield* DocumentKeys;
    return yield* cryptoOperation(async () => {
      const bytes = canonical2(value);
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: aad2 },
        keys.encryption,
        bytes
      );
      const fingerprint = hex2(await crypto.subtle.sign("HMAC", keys.fingerprint, bytes));
      return {
        nonce: Array.from(nonce),
        ciphertext: Array.from(new Uint8Array(ciphertext)),
        fingerprint
      };
    });
  }),
  open: (envelope) => Effect6.gen(function* () {
    const keys = yield* DocumentKeys;
    return yield* cryptoOperation(async () => {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(envelope.nonce), additionalData: aad2 },
        keys.encryption,
        new Uint8Array(envelope.ciphertext)
      );
      const value = Schema9.decodeUnknownSync(Document2)(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
        { onExcessProperty: "error" }
      );
      const expected = hex2(
        await crypto.subtle.sign("HMAC", keys.fingerprint, canonical2(value))
      );
      if (expected !== envelope.fingerprint) {
        throw new JobPayload.JobEncryptionError();
      }
      return value;
    });
  })
};
var EncryptedDocument = JobPayload.encrypted({ schema: Document2, codec });

// apps/playground-worker/src/scenarios/Definitions.ts
var Workload = Schema10.Literals([
  "welcome-email",
  "image-processing",
  "webhook-delivery",
  "private-data-export",
  "catalog-sync",
  "simulated-payment"
]);
var ProviderWorkload = Schema10.Literals([
  ...Workload.literals,
  "synthetic-document-export"
]);
var Behavior = Schema10.Literals([
  "success",
  "retry-then-success",
  "dead",
  "isolated",
  "accepted-response-lost"
]);
var Payload = Schema10.Struct({
  sandbox: SandboxRef,
  version: Schema10.Literal(1),
  seed: Schema10.Int.pipe(
    Schema10.check(Schema10.isBetween({ minimum: 0, maximum: 4294967295 }))
  ),
  sequence: Schema10.Int.pipe(Schema10.check(Schema10.isBetween({ minimum: 1, maximum: 10 }))),
  behavior: Behavior,
  actor: Schema10.Literal("demo-customer"),
  tenant: Schema10.Literals(["demo-tenant-a", "demo-tenant-b"]),
  order: Schema10.Literals(["demo-order-a", "demo-order-b"])
});
var ExportPayload = Schema10.Struct({
  ...Payload.fields,
  document: EncryptedDocument
});
var SyntheticReadablePayload = Schema10.Struct({
  ...Payload.fields,
  document: Document
});
var SyntheticExportPayload = Schema10.Struct({
  ...Payload.fields,
  document: JobPayload2.encrypted({
    schema: Document,
    codec: {
      envelope: Envelope,
      seal: (value) => sealSyntheticDocument(value).pipe(
        Effect7.mapError(() => new JobPayload2.JobEncryptionError())
      ),
      open: (value) => openSyntheticDocument(value).pipe(
        Effect7.mapError(() => new JobPayload2.JobEncryptionError())
      )
    }
  })
});
var communications = JobQueue.make("playground-communications");
var media = JobQueue.make("playground-media");
var commerce = JobQueue.make("playground-commerce");
var privateData = JobQueue.make("playground-private");
var WelcomeEmail = Job.make({
  queue: communications,
  kind: "playground.welcome-email",
  payload: Payload
});
var ImageProcessing = Job.make({
  queue: media,
  kind: "playground.image-processing",
  payload: Payload
});
var WebhookDelivery = Job.make({
  queue: communications,
  kind: "playground.webhook-delivery",
  payload: Payload
});
var PrivateDataExport = Job.make({
  queue: privateData,
  kind: "playground.private-data-export",
  payload: ExportPayload
});
var CatalogSync = Job.make({
  queue: commerce,
  kind: "playground.catalog-sync",
  payload: Payload
});
var SimulatedPayment = Job.make({
  queue: commerce,
  kind: "playground.simulated-payment",
  payload: Payload
});
var SyntheticDocumentExport = Job.make({
  queue: privateData,
  kind: "playground.synthetic-document-export",
  payload: SyntheticExportPayload
});
var Producer = JobProducer.make({
  operation: "playground.synthetic",
  slots: [
    "welcome-email",
    "image-processing",
    "webhook-delivery",
    "private-data-export",
    "catalog-sync",
    "simulated-payment"
  ]
});

// apps/playground-worker/src/persistence/commands/RepairSource.ts
import { Effect as Effect8, Schema as Schema11 } from "effect";
import * as Codec from "effect-jobs/JobPayloadCodec";
import * as JobProducer2 from "effect-jobs/JobProducer";
var RepairSourceRejected = class extends Schema11.TaggedError()(
  "RepairSourceRejected",
  { reason: JobRepairReason }
) {
};
var producer = JobProducer2.make({
  operation: "playground.repair",
  slots: ["replacement"]
});

// apps/playground-worker/src/persistence/MigrationRegistry.ts
var migrations = (schema) => {
  const sql = migration(Jobs.tables({ schema })) + proposal(schema) + `
    ALTER TABLE "${schema}"."sandboxes"
      ADD CHECK (length(sandbox_id) BETWEEN 1 AND 128),
      ADD CHECK (expires_at BETWEEN 1 AND 253402300799999);
    ALTER TABLE "${schema}"."associations"
      ADD CHECK (generation BETWEEN 1 AND 9007199254740991),
      ADD CHECK (jsonb_typeof(relations)='object');`;
  const operators = operatorMigration(Jobs.tables({ schema })) + proposal3(schema);
  const repairs = Jobs.lineageMigration(Jobs.tables({ schema })) + proposal2(schema);
  return Object.freeze([
    {
      id: "playground-v1",
      sql,
      checksum: createHash("sha256").update(sql).digest("hex")
    },
    {
      id: "playground-demo-v2",
      sql: proposal5(schema),
      checksum: createHash("sha256").update(proposal5(schema)).digest("hex")
    },
    {
      id: "playground-demo-volume-v3",
      sql: volumeProposal(schema),
      checksum: createHash("sha256").update(volumeProposal(schema)).digest("hex")
    },
    {
      id: "playground-operators-v4",
      sql: operators,
      checksum: createHash("sha256").update(operators).digest("hex")
    },
    {
      id: "playground-local-private-v5",
      sql: proposal4(schema),
      checksum: createHash("sha256").update(proposal4(schema)).digest("hex")
    },
    {
      id: "playground-job-repairs-v6",
      sql: repairs,
      checksum: createHash("sha256").update(repairs).digest("hex")
    }
  ]);
};
export {
  migrations
};
