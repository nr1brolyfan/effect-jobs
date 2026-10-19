// apps/playground-worker/tests/integration/OperatorProbe.ts
import { Duration as Duration5, Effect as Effect38, Redacted as Redacted6, Schema as Schema30 } from "effect";
import { SqlClient as SqlClient11 } from "effect/sql/SqlClient";
import { PostgreSqlJobs as PostgreSqlJobs5 } from "effect-jobs/PostgreSqlJobs";
import { FailureCode as FailureCode3 } from "effect-jobs/FailureCode";
import * as Policy2 from "effect-jobs/JobPolicy";

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
  capacity: Schema.optional(Schema.Struct({
    mode: Schema.Literals(["local", "bounded"]),
    retainedJobs: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))),
    admittedCommands: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })))
  })),
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
]).pipe(Schema2.check(Schema2.makeFilter((result3) => result3._tag === "OutcomeUnknown" || result3.previous.sandboxId === result3.current.sandboxId && result3.current.generation === result3.previous.generation + 1)));
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
var matchesCommandResult = (command, result3) => result3.sandbox.sandboxId === command.sandbox.sandboxId && result3.sandbox.generation === command.sandbox.generation && result3.requestId === command.requestId && (result3._tag === "OutcomeUnknown" || result3.action === command.action && (result3._tag === "Rejected" ? result3.jobId === command.jobId : result3.sourceJobId === command.jobId && result3.sourceState === command.expectedState && result3.sourceLifecycleVersion === command.expectedLifecycleVersion));
var JobOperatorReceiptRequest = Schema4.Struct({
  sandbox: SandboxRef,
  requestId: RequestId
});
var eligibility = Schema4.Struct({
  enabled: Schema4.Boolean,
  reason: Schema4.NullOr(JobOperatorReason)
});
var JobOperatorEligibility = Schema4.Struct({
  retryNow: eligibility,
  cancel: eligibility,
  redrive: eligibility
});
var commandIdentity = (command) => JSON.stringify([
  command.sandbox.sandboxId,
  command.sandbox.generation,
  command.requestId,
  command.jobId,
  command.expectedState,
  command.expectedLifecycleVersion,
  command.action,
  command.action === "redrive" ? command.confirmDuplicateEffects : null
]);
var Operators = class extends Context2.Service()("playground/Operators") {
};

// packages/playground-contracts/dist/Repairs.js
var scalars = (value3) => Array.from(value3).every((scalar) => scalar.codePointAt(0) < 55296 || scalar.codePointAt(0) > 57343);
var canonicalJson = (input, maximum = 65536) => {
  const seen = /* @__PURE__ */ new Set();
  let length = 0;
  const emit = (text3) => {
    length += new TextEncoder().encode(text3).length;
    if (length > maximum) {
      throw new Error("JSON size exceeded");
    }
    return text3;
  };
  const quote = (text3) => {
    if (text3.length > maximum || !scalars(text3)) {
      throw new Error("Invalid JSON string");
    }
    return emit(JSON.stringify(text3));
  };
  const visit = (value3, depth) => {
    if (depth > 32) {
      throw new Error("JSON depth exceeded");
    }
    if (value3 === null) {
      return emit("null");
    }
    if (typeof value3 === "boolean") {
      return emit(String(value3));
    }
    if (typeof value3 === "number" && Number.isFinite(value3)) {
      return emit(JSON.stringify(value3));
    }
    if (typeof value3 === "string") {
      return quote(value3);
    }
    if (typeof value3 !== "object" || value3 === null || seen.has(value3)) {
      throw new Error("Invalid JSON");
    }
    const array = Array.isArray(value3);
    if (!array && Object.getPrototypeOf(value3) !== Object.prototype && Object.getPrototypeOf(value3) !== null) {
      throw new Error("Invalid JSON container");
    }
    seen.add(value3);
    const descriptors = Object.getOwnPropertyDescriptors(value3);
    const keys2 = Reflect.ownKeys(descriptors);
    for (const key of keys2) {
      if (array && key === "length") {
        continue;
      }
      const descriptor = descriptors[key];
      if (typeof key !== "string" || !scalars(key) || !descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("Invalid JSON descriptor");
      }
    }
    let result3;
    if (array) {
      if (keys2.length !== value3.length + 1) {
        throw new Error("Invalid JSON array");
      }
      emit("[]");
      const entries = [];
      for (let index = 0; index < value3.length; index++) {
        if (index > 0) {
          emit(",");
        }
        const descriptor = descriptors[String(index)];
        if (!descriptor) {
          throw new Error("Sparse JSON array");
        }
        entries.push(visit(descriptor.value, depth + 1));
      }
      result3 = `[${entries.join(",")}]`;
    } else {
      emit("{}");
      result3 = `{${keys2.sort().map((key, index) => {
        if (index > 0) {
          emit(",");
        }
        return `${quote(key)}${emit(":")}${visit(descriptors[key].value, depth + 1)}`;
      }).join(",")}}`;
    }
    seen.delete(value3);
    return result3;
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
var Reason = Schema5.String.pipe(Schema5.check(Schema5.makeFilter((value3) => value3.length >= 1 && value3.length <= 512 && value3.trim().length > 0 && !value3.includes("\0") && new TextEncoder().encode(value3).length <= 1024)));
var JobResolutionState = Schema5.Literals(["Open", "InProgress", "Resolved"]);
var JobProblem = Schema5.Struct({
  rootJobId: JobId3,
  state: JobResolutionState,
  version: Counter2,
  updatedAt: EpochMillis3,
  activeSuccessorJobId: Schema5.NullOr(JobId3),
  outcomeKnowledge: Schema5.Literals(["KnownFailure", "Unknown"]),
  resolution: Schema5.NullOr(Schema5.Struct({
    kind: Schema5.Literals(["SuccessorCompleted", "OperatorReconciled", "ManualClose"]),
    reason: Schema5.NullOr(Reason),
    observedAt: EpochMillis3,
    successorJobId: Schema5.NullOr(JobId3)
  }))
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
  confirmUnknownOutcome: Schema5.optional(Schema5.Literal(true))
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

// apps/website/src/server/Services.ts
import { Context as Context4, Effect as Effect4, Layer } from "effect";
var Application = class extends Context4.Service()(
  "playground/Application"
) {
};
var layerNoDeps = Layer.effect(
  Application,
  Effect4.gen(function* () {
    const authority = yield* SandboxAuthority;
    const read = yield* JobsRead;
    const scenarios = yield* Scenarios;
    const repairs = yield* Repairs;
    const operators = yield* Operators;
    return Application.of({ ...authority, ...read, ...scenarios, ...operators, repairs });
  })
);

// apps/playground-worker/src/persistence/commands/RepairPersistence.ts
import { Cause, Context as Context8, Effect as Effect12, Layer as Layer4, Schema as Schema13 } from "effect";
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs";
import { PostgreSqlFailure } from "effect-jobs/PostgreSqlTransaction";

// apps/playground-worker/src/persistence/commands/RepairTransactions.ts
import { Context as Context5, Schema as Schema6 } from "effect";
var StoredRepairReceipt = Schema6.Struct({
  commandDigest: Schema6.String.pipe(Schema6.check(Schema6.isPattern(/^[a-f0-9]{64}$/u))),
  result: Schema6.Union([
    JobRepairResult.members[0],
    JobRepairResult.members[1],
    JobResolutionResult.members[0],
    JobResolutionResult.members[1]
  ])
});
var RepairTransactions = class extends Context5.Service()("playground/RepairTransactions") {
};
var SyntheticRepairTransactions = class extends Context5.Service()("playground/SyntheticRepairTransactions") {
};

// apps/playground-worker/src/persistence/commands/Transactions.ts
import { Context as Context6, Effect as Effect6, Layer as Layer2, Schema as Schema7 } from "effect";
var StoredReceipt = Schema7.Union([
  Schema7.TaggedStruct("Scenario", {
    command: ScenarioCommand,
    result: ScenarioResult.members[0]
  }),
  Schema7.TaggedStruct("Reset", { command: ResetCommand, result: ResetResult })
]);
var CommandTransactionFailure = class extends Schema7.TaggedError()(
  "CommandTransactionFailure",
  { commitKnowledge: Schema7.Literals(["NotCommitted", "Unknown"]) }
) {
};
var CommandTransactions = class extends Context6.Service()("playground/CommandTransactions") {
};
var CommandPersistence = class extends Context6.Service()("playground/CommandPersistence") {
};
var unavailable = () => Effect6.fail(new PlaygroundError({ code: "capability-unavailable" }));
var unavailableLayer = Layer2.succeed(
  CommandPersistence,
  CommandPersistence.of({
    run: unavailable,
    reset: unavailable,
    scenarioReceipt: unavailable,
    resetReceipt: unavailable
  })
);

// apps/playground-worker/src/persistence/commands/RepairSource.ts
import { Effect as Effect10, Schema as Schema11 } from "effect";
import * as Codec from "effect-jobs/JobPayloadCodec";
import * as JobProducer2 from "effect-jobs/JobProducer";

// apps/playground-worker/src/scenarios/Definitions.ts
import { Effect as Effect9, Schema as Schema10 } from "effect";
import * as Job from "effect-jobs/Job";
import * as JobProducer from "effect-jobs/JobProducer";
import * as JobQueue from "effect-jobs/JobQueue";

// packages/playground-contracts/dist/SyntheticCryptoFixture.js
import { Effect as Effect7, Schema as Schema8 } from "effect";
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
var canonical = (value3) => new TextEncoder().encode(JSON.stringify({ subject: value3.subject, tenant: value3.tenant, note: value3.note }));
var hex = (value3) => Array.from(new Uint8Array(value3), (byte) => byte.toString(16).padStart(2, "0")).join("");
var operation = (run3, reason) => Effect7.tryPromise({ try: run3, catch: () => new PayloadUnlockError({ reason }) });
var importDocumentKeys = (encryption, fingerprint) => Effect7.suspend(() => {
  if (encryption.length !== 32 || fingerprint.length !== 32 || encryption.every((byte, index) => byte === fingerprint[index])) {
    return Effect7.fail(new PayloadUnlockError({ reason: "invalid-key" }));
  }
  return Effect7.acquireUseRelease(Effect7.sync(() => ({
    encryption: new Uint8Array(encryption),
    fingerprint: new Uint8Array(fingerprint)
  })), (raw) => operation(async () => ({
    encryption: await crypto.subtle.importKey("raw", raw.encryption, "AES-GCM", false, ["encrypt", "decrypt"]),
    fingerprint: await crypto.subtle.importKey("raw", raw.fingerprint, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
  }), "invalid-key"), (raw) => Effect7.sync(() => {
    raw.encryption.fill(0);
    raw.fingerprint.fill(0);
  }));
});
var syntheticDocumentKeys = () => Effect7.acquireUseRelease(Effect7.sync(() => ({
  encryption: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  fingerprint: Uint8Array.from({ length: 32 }, (_, index) => index + 101)
})), (raw) => importDocumentKeys(raw.encryption, raw.fingerprint), (raw) => Effect7.sync(() => {
  raw.encryption.fill(0);
  raw.fingerprint.fill(0);
}));
var openDocument = (input, keys2) => Effect7.gen(function* () {
  const envelope = yield* Schema8.decodeUnknownEffect(Envelope)(input, {
    onExcessProperty: "error"
  }).pipe(Effect7.mapError(() => new PayloadUnlockError({ reason: "unsupported-envelope" })));
  const nonce = new Uint8Array(envelope.nonce);
  const ciphertext = new Uint8Array(envelope.ciphertext);
  const signature = Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(envelope.fingerprint.slice(index * 2, index * 2 + 2), 16));
  return yield* Effect7.acquireUseRelease(operation(async () => new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, keys2.encryption, ciphertext)), "authentication-failed"), (bytes2) => Effect7.gen(function* () {
    const parsed = yield* Effect7.try({
      try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes2)),
      catch: () => new PayloadUnlockError({ reason: "authentication-failed" })
    });
    const document = yield* Schema8.decodeUnknownEffect(Document)(parsed, {
      onExcessProperty: "error"
    }).pipe(Effect7.mapError(() => new PayloadUnlockError({ reason: "authentication-failed" })));
    return yield* Effect7.acquireUseRelease(Effect7.sync(() => canonical(document)), (message) => operation(() => crypto.subtle.verify("HMAC", keys2.fingerprint, signature, message), "authentication-failed").pipe(Effect7.flatMap((valid) => valid ? Effect7.succeed(document) : Effect7.fail(new PayloadUnlockError({ reason: "authentication-failed" })))), (message) => Effect7.sync(() => message.fill(0)));
  }), (bytes2) => Effect7.sync(() => bytes2.fill(0)));
});
var sealSyntheticDocument = (input) => Effect7.gen(function* () {
  const document = yield* Schema8.decodeUnknownEffect(Document)(input, {
    onExcessProperty: "error"
  }).pipe(Effect7.mapError(() => new PayloadUnlockError({ reason: "authentication-failed" })));
  const keys2 = yield* syntheticDocumentKeys();
  return yield* Effect7.acquireUseRelease(Effect7.sync(() => canonical(document)), (bytes2) => operation(async () => {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, keys2.encryption, bytes2);
    const fingerprint = hex(await crypto.subtle.sign("HMAC", keys2.fingerprint, bytes2));
    return {
      nonce: Array.from(nonce),
      ciphertext: Array.from(new Uint8Array(ciphertext)),
      fingerprint
    };
  }, "unavailable"), (bytes2) => Effect7.sync(() => bytes2.fill(0)));
});
var openSyntheticDocument = (envelope) => syntheticDocumentKeys().pipe(Effect7.flatMap((keys2) => openDocument(envelope, keys2)));

// apps/playground-worker/src/scenarios/Definitions.ts
import * as JobPayload2 from "effect-jobs/JobPayload";

// apps/playground-worker/src/scenarios/PrivateDocument.ts
import { Context as Context7, Effect as Effect8, Layer as Layer3, Schema as Schema9 } from "effect";
import * as JobPayload from "effect-jobs/JobPayload";
var DocumentKeys = class extends Context7.Service()("playground/DocumentKeys") {
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
var canonical2 = (value3) => new TextEncoder().encode(
  JSON.stringify({ subject: value3.subject, tenant: value3.tenant, note: value3.note })
);
var hex2 = (value3) => Array.from(new Uint8Array(value3), (byte) => byte.toString(16).padStart(2, "0")).join("");
var cryptoOperation = (run3) => Effect8.tryPromise({ try: run3, catch: () => new JobPayload.JobEncryptionError() });
var keysLayer = Layer3.effect(
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
  seal: (value3) => Effect8.gen(function* () {
    const keys2 = yield* DocumentKeys;
    return yield* cryptoOperation(async () => {
      const bytes2 = canonical2(value3);
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: aad2 },
        keys2.encryption,
        bytes2
      );
      const fingerprint = hex2(await crypto.subtle.sign("HMAC", keys2.fingerprint, bytes2));
      return {
        nonce: Array.from(nonce),
        ciphertext: Array.from(new Uint8Array(ciphertext)),
        fingerprint
      };
    });
  }),
  open: (envelope) => Effect8.gen(function* () {
    const keys2 = yield* DocumentKeys;
    return yield* cryptoOperation(async () => {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(envelope.nonce), additionalData: aad2 },
        keys2.encryption,
        new Uint8Array(envelope.ciphertext)
      );
      const value3 = Schema9.decodeUnknownSync(Document2)(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
        { onExcessProperty: "error" }
      );
      const expected = hex2(
        await crypto.subtle.sign("HMAC", keys2.fingerprint, canonical2(value3))
      );
      if (expected !== envelope.fingerprint) {
        throw new JobPayload.JobEncryptionError();
      }
      return value3;
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
      seal: (value3) => sealSyntheticDocument(value3).pipe(
        Effect9.mapError(() => new JobPayload2.JobEncryptionError())
      ),
      open: (value3) => openSyntheticDocument(value3).pipe(
        Effect9.mapError(() => new JobPayload2.JobEncryptionError())
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
var definitions = [
  WelcomeEmail,
  ImageProcessing,
  WebhookDelivery,
  PrivateDataExport,
  CatalogSync,
  SimulatedPayment,
  SyntheticDocumentExport
];

// apps/playground-worker/src/persistence/commands/RepairSource.ts
var RepairSourceRejected = class extends Schema11.TaggedError()(
  "RepairSourceRejected",
  { reason: JobRepairReason }
) {
};
var rejected = (reason) => new RepairSourceRejected({ reason });
var producer = JobProducer2.make({
  operation: "playground.repair",
  slots: ["replacement"]
});
var scalars2 = (value3) => Array.from(value3).every(
  (scalar) => scalar.codePointAt(0) < 55296 || scalar.codePointAt(0) > 57343
);
var canonicalJson2 = (input, maximum = 65536) => {
  const seen = /* @__PURE__ */ new Set();
  let length = 0;
  const emit = (text3) => {
    length += new TextEncoder().encode(text3).length;
    if (length > maximum) {
      throw new Error("JSON size exceeded");
    }
    return text3;
  };
  const quote = (text3) => {
    if (text3.length > maximum || !scalars2(text3)) {
      throw new Error("Invalid JSON string");
    }
    return emit(JSON.stringify(text3));
  };
  const visit = (value3, depth) => {
    if (depth > 32) {
      throw new Error("JSON depth exceeded");
    }
    if (value3 === null) {
      return emit("null");
    }
    if (typeof value3 === "boolean") {
      return emit(String(value3));
    }
    if (typeof value3 === "number" && Number.isFinite(value3)) {
      return emit(JSON.stringify(value3));
    }
    if (typeof value3 === "string") {
      return quote(value3);
    }
    if (typeof value3 !== "object" || value3 === null || seen.has(value3)) {
      throw new Error("Invalid JSON");
    }
    const array = Array.isArray(value3);
    if (!array && Object.getPrototypeOf(value3) !== Object.prototype && Object.getPrototypeOf(value3) !== null) {
      throw new Error("Invalid JSON container");
    }
    seen.add(value3);
    const descriptors = Object.getOwnPropertyDescriptors(value3);
    const keys2 = Reflect.ownKeys(descriptors);
    for (const key of keys2) {
      if (array && key === "length") {
        continue;
      }
      const descriptor = descriptors[key];
      if (typeof key !== "string" || !scalars2(key) || !descriptor.enumerable || !("value" in descriptor)) {
        throw new Error("Invalid JSON descriptor");
      }
    }
    let result3;
    if (array) {
      if (keys2.length !== value3.length + 1) {
        throw new Error("Invalid JSON array");
      }
      emit("[]");
      const entries = [];
      for (let index = 0; index < value3.length; index++) {
        if (index > 0) {
          emit(",");
        }
        const descriptor = descriptors[String(index)];
        if (!descriptor) {
          throw new Error("Sparse JSON array");
        }
        entries.push(visit(descriptor.value, depth + 1));
      }
      result3 = `[${entries.join(",")}]`;
    } else {
      emit("{}");
      result3 = `{${keys2.sort().map((key, index) => {
        if (index > 0) {
          emit(",");
        }
        return `${quote(key)}${emit(":")}${visit(descriptors[key].value, depth + 1)}`;
      }).join(",")}}`;
    }
    seen.delete(value3);
    return result3;
  };
  return visit(input, 0);
};
var sha256 = (value3) => Effect10.tryPromise({
  // WebCrypto FFI, no keys or retained mutable input.
  try: async () => Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value3))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join(""),
  catch: () => rejected("unavailable")
});
var digestJson = (value3) => Effect10.try({
  try: () => canonicalJson2(value3, 131072),
  catch: () => rejected("invalid-input")
}).pipe(Effect10.flatMap(sha256));
var commandDigest = (command) => Effect10.try({
  try: () => {
    if ("payload" in command) {
      canonicalJson2(command.payload);
    }
    return canonicalJson2(command, 131072);
  },
  catch: () => rejected("invalid-input")
}).pipe(Effect10.flatMap(sha256));
var producerIdentity = (command) => sha256(
  JSON.stringify([
    command.sandbox.sandboxId,
    command.sandbox.generation,
    command.requestId,
    command.jobId,
    command.action
  ])
).pipe(
  Effect10.map((operationId) => producer.identity({ operationId, slot: "replacement" }))
);
var definition = (row) => {
  const found = definitions.find(
    (candidate) => candidate.catalog.queue === row.queue && candidate.catalog.kind === row.kind && candidate.catalog.version === Number(row.version)
  );
  return found ? Effect10.succeed(found) : Effect10.fail(rejected("unsupported-catalog"));
};
var artifact = (row) => Effect10.try({
  try: () => {
    if (Number(row.format_version) !== 1 || !(row.payload instanceof Uint8Array) || !(row.projection instanceof Uint8Array)) {
      throw new Error("Absent artifact");
    }
    return {
      formatVersion: 1,
      payloadBytes: new Uint8Array(row.payload),
      semanticProjectionBytes: new Uint8Array(row.projection)
    };
  },
  catch: () => rejected("invalid-artifact")
});
var knownFailure = (row) => row.state === "Dead" && row.accepted === false && Number.isSafeInteger(Number(row.invocations)) && Number(row.invocations) > 0 && ["fake_provider_terminal_rejected", "fake_provider_retry_rejected"].includes(
  String(row.last_failure_code)
);
var investigate = (row, command) => {
  switch (command.investigation._tag) {
    case "KnownFailure":
      return knownFailure(row) ? Effect10.succeed("KnownFailure") : Effect10.fail(rejected("investigation-required"));
    case "ConfirmedNotApplied":
      return row.state === "Isolated" ? Effect10.succeed("KnownFailure") : Effect10.fail(rejected("investigation-required"));
    case "AcceptDuplicateRisk":
      return Effect10.succeed("Unknown");
    case "Unconfirmed":
      return Effect10.fail(rejected("investigation-required"));
  }
};
var changedPaths = (before, after) => Object.keys(Payload.fields).filter(
  (key) => canonicalJson2(before[key]) !== canonicalJson2(after[key])
).map((key) => ({ kind: "Changed", path: `/${key}` }));
var replacement = (row, current, input) => Effect10.gen(function* () {
  const selected = yield* definition(row);
  const synthetic = selected === SyntheticDocumentExport;
  if ("document" in selected.payload.fields && !synthetic) {
    return yield* rejected("encrypted-correction-unavailable");
  }
  const nextSynthetic = synthetic ? yield* Schema11.decodeUnknownEffect(SyntheticExportPayload)(input, {
    onExcessProperty: "error"
  }).pipe(Effect10.mapError(() => rejected("invalid-payload"))) : null;
  const next = nextSynthetic ?? (yield* Schema11.decodeUnknownEffect(Payload)(input, {
    onExcessProperty: "error"
  }).pipe(Effect10.mapError(() => rejected("invalid-payload"))));
  if (nextSynthetic && (nextSynthetic.document.subject !== next.actor || nextSynthetic.document.tenant !== next.tenant)) {
    return yield* rejected("invalid-payload");
  }
  if (next.sandbox.sandboxId !== current.sandboxId || next.sandbox.generation !== current.generation) {
    return yield* rejected("invalid-payload");
  }
  const relations3 = row.relations;
  if (!relations3 || relations3.syntheticActor !== next.actor || relations3.syntheticOrderId !== next.order) {
    return yield* rejected("invalid-payload");
  }
  const oldSynthetic = synthetic ? yield* artifact(row).pipe(
    Effect10.flatMap(
      (bytes2) => Codec.decodeJobPayload(SyntheticExportPayload, bytes2)
    ),
    Effect10.catchTag("RepairSourceRejected", () => Effect10.succeed(null)),
    Effect10.catchTag("JobPayloadCodecError", () => Effect10.succeed(null))
  ) : null;
  const old = synthetic ? oldSynthetic : yield* artifact(row).pipe(
    Effect10.flatMap((bytes2) => Codec.decodeJobPayload(Payload, bytes2)),
    Effect10.catchTag("RepairSourceRejected", () => Effect10.succeed(null)),
    Effect10.catchTag("JobPayloadCodecError", () => Effect10.succeed(null))
  );
  if (old && (old.actor !== next.actor || old.tenant !== next.tenant || old.order !== next.order || old.sandbox.sandboxId !== current.sandboxId || old.sandbox.generation !== current.generation)) {
    return yield* rejected("invalid-payload");
  }
  if (!old && relations3.syntheticTenant !== next.tenant) {
    return yield* rejected("invalid-payload");
  }
  if (nextSynthetic) {
    return {
      _tag: "Synthetic",
      payload: nextSynthetic,
      changes: old ? [
        ...changedPaths(old, next),
        ...oldSynthetic ? Object.keys(nextSynthetic.document).filter(
          (key) => canonicalJson2(
            oldSynthetic.document[key]
          ) !== canonicalJson2(
            nextSynthetic.document[key]
          )
        ).map((key) => ({
          kind: "Changed",
          path: `/document/${key}`
        })) : []
      ] : null
    };
  }
  const encoded = yield* Codec.encodeJobPayload(Payload, next).pipe(
    Effect10.mapError(() => rejected("invalid-payload"))
  );
  yield* Codec.decodeJobPayload(Payload, encoded).pipe(
    Effect10.mapError(() => rejected("invalid-payload"))
  );
  return {
    _tag: "Plain",
    definition: selected,
    payload: next,
    changes: old ? changedPaths(old, next) : null
  };
});

// apps/playground-worker/src/persistence/commands/OperatorSource.ts
import { Effect as Effect11, Schema as Schema12 } from "effect";
import { CatalogIdentity } from "effect-jobs/JobIdentity";
import * as Codec2 from "effect-jobs/JobPayloadCodec";
import * as JobProducer3 from "effect-jobs/JobProducer";
var OperatorSourceRejected = class extends Schema12.TaggedError()(
  "OperatorSourceRejected",
  {
    reason: Schema12.Literals(["invalid-artifact", "unsupported-catalog"])
  }
) {
};
var invalid = () => new OperatorSourceRejected({ reason: "invalid-artifact" });
var byteBuffer = Schema12.instanceOf(Uint8Array).pipe(
  Schema12.check(
    Schema12.makeFilter((bytes2) => bytes2.byteLength > 0 && bytes2.byteLength <= 65536)
  )
);
var artifact2 = Schema12.Struct({
  formatVersion: Schema12.Literal(1),
  payloadBytes: byteBuffer,
  semanticProjectionBytes: byteBuffer
});
var producer2 = JobProducer3.make({
  operation: "playground.operator-redrive",
  slots: ["replacement"]
});
var validate = (row, current) => Effect11.gen(function* () {
  const catalog = yield* Schema12.decodeUnknownEffect(CatalogIdentity)({
    queue: row.queue,
    kind: row.kind,
    version: Number(row.version)
  }).pipe(
    Effect11.mapError(() => new OperatorSourceRejected({ reason: "unsupported-catalog" }))
  );
  const definition2 = definitions.find(
    (candidate) => candidate.catalog.queue === catalog.queue && candidate.catalog.kind === catalog.kind && candidate.catalog.version === catalog.version
  );
  if (!definition2) {
    return yield* new OperatorSourceRejected({ reason: "unsupported-catalog" });
  }
  const checked = yield* Schema12.decodeUnknownEffect(artifact2)({
    formatVersion: Number(row.format_version),
    payloadBytes: row.payload,
    semanticProjectionBytes: row.projection
  }).pipe(Effect11.mapError(invalid));
  const encoded = {
    ...checked,
    payloadBytes: new Uint8Array(checked.payloadBytes),
    semanticProjectionBytes: new Uint8Array(checked.semanticProjectionBytes)
  };
  const scoped3 = (payload2) => payload2.sandbox.sandboxId === current.sandboxId && payload2.sandbox.generation === current.generation;
  if (definition2 === PrivateDataExport || definition2 === SyntheticDocumentExport) {
    const payload2 = yield* Codec2.decodeJobPayload(
      definition2 === SyntheticDocumentExport ? SyntheticExportPayload : ExportPayload,
      encoded
    ).pipe(Effect11.mapError(invalid));
    if (!scoped3(payload2) || payload2.document.subject !== payload2.actor || payload2.document.tenant !== payload2.tenant) {
      return yield* invalid();
    }
  } else {
    const payload2 = yield* Codec2.decodeJobPayload(Payload, encoded).pipe(
      Effect11.mapError(invalid)
    );
    if (!scoped3(payload2)) {
      return yield* invalid();
    }
  }
  return definition2;
});

// apps/playground-worker/src/persistence/commands/RepairPersistence.ts
var fail = (code) => new PlaygroundError({ code });
var decode = (schema, input) => Effect12.try({
  try: () => JSON.parse(canonicalJson2(input, 131072)),
  catch: () => fail("invalid-request")
}).pipe(
  Effect12.flatMap(
    (snapshot) => Schema13.decodeUnknownEffect(schema)(snapshot, { onExcessProperty: "error" })
  ),
  Effect12.mapError(() => fail("invalid-request"))
);
var unknown = (request) => ({
  _tag: "OutcomeUnknown",
  sandbox: request.sandbox,
  requestId: request.requestId
});
var recover = (request) => (cause) => {
  const reason = cause.reasons.length === 1 ? cause.reasons[0] : void 0;
  if (reason && Cause.isFailReason(reason) && (reason.error instanceof CommandTransactionFailure || reason.error instanceof PostgreSqlFailure) && reason.error.commitKnowledge === "Unknown") {
    return Effect12.succeed(unknown(request));
  }
  return Effect12.failCause(
    Cause.fromReasons(
      cause.reasons.map((reason2) => {
        if (Cause.isInterruptReason(reason2)) {
          return reason2;
        }
        if (Cause.isDieReason(reason2)) {
          return Cause.makeDieReason(new Error("Repair persistence defect"));
        }
        return Cause.makeFailReason(
          reason2.error instanceof PlaygroundError ? fail(reason2.error.code) : fail("unavailable")
        );
      })
    )
  );
};
var implicitProblem = (rootJobId, updatedAt, outcomeKnowledge = "Unknown") => ({
  rootJobId,
  state: "Open",
  version: 0,
  updatedAt,
  activeSuccessorJobId: null,
  outcomeKnowledge,
  resolution: null
});
var refuseProblem = (problem, command) => {
  if (problem.version !== command.expectedResolutionVersion) {
    return "resolution-conflict";
  }
  if (problem.state === "Resolved") {
    return "already-resolved";
  }
  if (problem.state === "InProgress") {
    return "repair-in-progress";
  }
  if ((problem.activeSuccessorJobId ?? problem.rootJobId) !== command.jobId) {
    return "resolution-conflict";
  }
  return null;
};
var makeService = (transactions) => Effect12.gen(function* () {
  const backend = yield* PostgreSqlJobs;
  const keys2 = yield* DocumentKeys;
  const run3 = (access, command) => Effect12.gen(function* () {
    const digest2 = yield* commandDigest(command).pipe(
      Effect12.mapError(() => fail("invalid-request"))
    );
    const repair = "jobId" in command;
    const reject = (reason) => repair ? {
      _tag: "Rejected",
      sandbox: command.sandbox,
      requestId: command.requestId,
      jobId: command.jobId,
      reason
    } : {
      _tag: "Rejected",
      sandbox: command.sandbox,
      requestId: command.requestId,
      rootJobId: command.rootJobId,
      reason
    };
    return yield* transactions.owned(
      access,
      command,
      digest2,
      (tx) => Effect12.gen(function* () {
        if (tx.admission === "Conflict") {
          return reject("request-conflict");
        }
        if (tx.stored) {
          return tx.stored.result;
        }
        if (tx.admission !== "Fresh") {
          return unknown(command);
        }
        yield* tx.assertCurrent;
        const stored = yield* tx.problem();
        const source = yield* tx.source();
        const operate = Effect12.gen(function* () {
          if (!stored && (!source || !["Dead", "Isolated"].includes(String(source.state)))) {
            return reject("not-found");
          }
          const problem = stored ?? implicitProblem(
            repair ? command.jobId : command.rootJobId,
            Number(source.updated_at),
            knownFailure(source) ? "KnownFailure" : "Unknown"
          );
          if (problem.version !== command.expectedResolutionVersion) {
            return reject("resolution-conflict");
          }
          if (problem.version === Number.MAX_SAFE_INTEGER) {
            return reject("arithmetic-bound");
          }
          if (problem.state === "Resolved") {
            return reject("already-resolved");
          }
          if (!repair) {
            if (command.action === "manual-close" && problem.outcomeKnowledge === "Unknown" && command.confirmUnknownOutcome !== true) {
              return reject("investigation-required");
            }
            const observedAt = yield* tx.now;
            return {
              _tag: "Committed",
              sandbox: command.sandbox,
              requestId: command.requestId,
              observedAt,
              problem: {
                ...problem,
                state: "Resolved",
                version: problem.version + 1,
                updatedAt: observedAt,
                resolution: {
                  kind: command.action === "manual-close" ? "ManualClose" : "OperatorReconciled",
                  reason: command.reason,
                  observedAt,
                  successorJobId: problem.activeSuccessorJobId
                }
              }
            };
          }
          const refusal = refuseProblem(problem, command);
          if (refusal) {
            return reject(refusal);
          }
          if (!source) {
            return reject("not-found");
          }
          if (source.state !== command.expectedState || Number(source.lifecycle_version) !== command.expectedLifecycleVersion) {
            return reject("state-version-conflict");
          }
          const knowledge = yield* investigate(source, command);
          const expected = {
            jobId: command.jobId,
            state: command.expectedState,
            lifecycleVersion: command.expectedLifecycleVersion
          };
          const producer3 = yield* producerIdentity(command);
          let changes = null;
          const produced = yield* Effect12.gen(function* () {
            if (command.action === "corrected-redrive") {
              const prepared = yield* replacement(
                source,
                command.sandbox,
                command.payload
              );
              changes = prepared.changes;
              yield* tx.assertCurrent;
              if (prepared._tag === "Synthetic") {
                return yield* backend.operators.correctedRedrive(
                  SyntheticDocumentExport,
                  { expected, producer: producer3, payload: prepared.payload }
                );
              }
              return yield* backend.operators.correctedRedrive(
                {
                  catalog: prepared.definition.catalog,
                  payload: Payload
                },
                { expected, producer: producer3, payload: prepared.payload }
              );
            }
            const definition2 = yield* validate(
              source,
              command.sandbox
            ).pipe(Effect12.provideService(DocumentKeys, keys2));
            yield* tx.assertCurrent;
            return yield* backend.operators.redrive(definition2, { expected, producer: producer3 }).pipe(Effect12.provideService(DocumentKeys, keys2));
          });
          if (!produced.inserted) {
            return yield* fail("unavailable");
          }
          const next = {
            ...problem,
            state: "InProgress",
            version: problem.version + 1,
            updatedAt: produced.dbNow,
            activeSuccessorJobId: produced.jobId,
            outcomeKnowledge: problem.outcomeKnowledge === "Unknown" && problem.version > 0 ? "Unknown" : knowledge,
            resolution: null
          };
          yield* tx.associate(produced.jobId, next);
          const result4 = yield* decode(JobRepairResult.members[0], {
            _tag: "Committed",
            sandbox: command.sandbox,
            requestId: command.requestId,
            action: command.action,
            sourceJobId: command.jobId,
            sourceState: command.expectedState,
            sourceLifecycleVersion: command.expectedLifecycleVersion,
            resultJobId: produced.jobId,
            observedAt: produced.dbNow,
            problem: next
          });
          yield* tx.save(result4, changes);
          return result4;
        }).pipe(
          Effect12.catchTag(
            "RepairSourceRejected",
            (error) => Effect12.succeed(reject(error.reason))
          ),
          Effect12.catchTag(
            "OperatorSourceRejected",
            (error) => Effect12.succeed(reject(error.reason))
          ),
          Effect12.catchTag(
            "JobPayloadCodecError",
            () => Effect12.succeed(reject("invalid-payload"))
          ),
          // lineage-conflict poisons the transaction and MUST NOT be saved as a
          // safe refusal after a partial core insert.
          Effect12.catchTag(
            "JobOperatorRejected",
            (error) => String(error.reason) === "lineage-conflict" ? Effect12.fail(error) : Effect12.succeed(reject(error.reason))
          )
        );
        const result3 = yield* operate;
        if (result3._tag !== "OutcomeUnknown" && (!repair || result3._tag === "Rejected")) {
          yield* tx.save(result3);
        }
        return result3;
      })
    ).pipe(Effect12.catchCause(recover(command)));
  });
  return Repairs.of({
    execute: (access, input) => decode(JobRepairCommand, input).pipe(
      Effect12.flatMap((command) => run3(access, command)),
      Effect12.flatMap((result3) => decode(JobRepairResult, result3))
    ),
    resolve: (access, input) => decode(JobResolutionCommand, input).pipe(
      Effect12.flatMap((command) => run3(access, command)),
      Effect12.flatMap((result3) => decode(JobResolutionResult, result3))
    ),
    receipt: (access, input) => decode(JobRepairReceiptRequest, input).pipe(
      Effect12.flatMap(
        (request) => transactions.lookup(access, request, "Repair").pipe(
          Effect12.map((stored) => stored?.result ?? unknown(request)),
          Effect12.catchCause(recover(request))
        )
      ),
      Effect12.flatMap((result3) => decode(JobRepairResult, result3))
    ),
    resolutionReceipt: (access, input) => decode(JobRepairReceiptRequest, input).pipe(
      Effect12.flatMap(
        (request) => transactions.lookup(access, request, "Resolution").pipe(
          Effect12.map((stored) => stored?.result ?? unknown(request)),
          Effect12.catchCause(recover(request))
        )
      ),
      Effect12.flatMap((result3) => decode(JobResolutionResult, result3))
    )
  });
});
var make6 = Effect12.gen(function* () {
  return yield* makeService(yield* RepairTransactions);
});
var layerNoDeps2 = Layer4.effect(Repairs, make6);
var SyntheticRepairs = class extends Context8.Service()("playground/SyntheticRepairs") {
};
var syntheticLayerNoDeps = Layer4.effect(
  SyntheticRepairs,
  Effect12.gen(function* () {
    return yield* makeService(yield* SyntheticRepairTransactions);
  })
);

// apps/playground-worker/src/persistence/authority/PostgreSqlRepairTransactions.ts
import { Cause as Cause2, Effect as Effect15, Layer as Layer5, Option, Schema as Schema16 } from "effect";
import { SqlClient as SqlClient2 } from "effect/sql/SqlClient";
import { isSqlError } from "effect/sql/SqlError";

// apps/playground-worker/src/persistence/commands/RepairSchema.ts
import { Effect as Effect13, Schema as Schema14 } from "effect";

// apps/playground-worker/src/persistence/authority/Schema.ts
var relations = (schema) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error("Invalid playground schema");
  }
  const table2 = (name2) => `"${schema}"."${name2}"`;
  return {
    sandboxes: table2("sandboxes"),
    associations: table2("associations"),
    receipts: table2("command_receipts"),
    admission: table2("command_admission"),
    audit: table2("command_audit"),
    ledger: table2("provider_ledger"),
    jobs: table2("jobs")
  };
};

// apps/playground-worker/src/persistence/commands/RepairSchema.ts
var relations2 = (schema) => ({
  ...relations(schema),
  admission: `"${schema}"."repair_admission"`,
  receipts: `"${schema}"."repair_receipts"`,
  problems: `"${schema}"."job_problems"`,
  members: `"${schema}"."job_repair_members"`,
  edges: `"${schema}"."job_repairs"`,
  audit: `"${schema}"."repair_audit"`,
  payloads: `"${schema}"."job_payloads"`
});
var decodeProblem = (input) => Schema14.decodeUnknownEffect(JobProblem)(input, { onExcessProperty: "error" }).pipe(
  Effect13.mapError(() => new PlaygroundError({ code: "unavailable" })),
  Effect13.flatMap(
    (problem) => problem.state === "InProgress" && problem.activeSuccessorJobId === null || problem.state === "Resolved" !== (problem.resolution !== null) || problem.resolution !== null && problem.resolution.successorJobId !== problem.activeSuccessorJobId ? Effect13.fail(new PlaygroundError({ code: "unavailable" })) : Effect13.succeed(problem)
  )
);

// apps/playground-worker/src/execution/RepairReconciliation.ts
import { Effect as Effect14, Schema as Schema15 } from "effect";
import { JobSnapshot } from "effect-jobs/JobLifecycle";
import { SqlClient } from "effect/sql/SqlClient";
var effectiveProblem = (problem, successor, observedAt) => {
  if (problem.state !== "InProgress" || problem.activeSuccessorJobId === null) {
    return problem;
  }
  if (successor && successor.jobId !== problem.activeSuccessorJobId) {
    return problem;
  }
  if (successor && ["Pending", "RetryScheduled", "Active"].includes(successor.state)) {
    return problem;
  }
  if (problem.version === Number.MAX_SAFE_INTEGER) {
    throw new Error("Resolution version exhausted");
  }
  const resolved = successor?.state === "Completed" && problem.outcomeKnowledge === "KnownFailure";
  return {
    ...problem,
    version: problem.version + 1,
    updatedAt: observedAt,
    state: resolved ? "Resolved" : "Open",
    resolution: resolved ? {
      kind: "SuccessorCompleted",
      reason: null,
      observedAt,
      successorJobId: problem.activeSuccessorJobId
    } : null
  };
};
var reconcileLocked = (schema, sandboxId, generation, rootJobId) => Effect14.gen(function* () {
  const sql = yield* SqlClient;
  const t = relations2(schema);
  const [row] = yield* sql.unsafe(
    `SELECT problem FROM ${t.problems} WHERE sandbox_id=$1 AND generation=$2 AND root_job_id=$3 FOR UPDATE`,
    [sandboxId, generation, rootJobId]
  );
  if (!row) {
    return null;
  }
  const problem = yield* decodeProblem(row.problem);
  if (problem.rootJobId !== rootJobId) {
    return yield* new PlaygroundError({ code: "unavailable" });
  }
  if (problem.state !== "InProgress") {
    return problem;
  }
  const [successor] = yield* sql.unsafe(
    `SELECT j.* FROM ${t.associations} a JOIN ${t.jobs} j ON j.id=a.job_id WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.id=$3 FOR UPDATE OF j`,
    [sandboxId, generation, problem.activeSuccessorJobId]
  );
  if (successor) {
    yield* Schema15.decodeUnknownEffect(JobSnapshot)(
      {
        jobId: successor.id,
        policy: successor.policy,
        state: successor.state,
        availableAt: Number(successor.available_at),
        updatedAt: Number(successor.updated_at),
        attemptsMade: Number(successor.attempts_made),
        stalledCount: Number(successor.stalled_count),
        lifecycleVersion: Number(successor.lifecycle_version),
        leaseToken: successor.lease_token,
        leaseExpiresAt: successor.lease_expires_at === null ? null : Number(successor.lease_expires_at),
        completedAt: successor.completed_at === null ? null : Number(successor.completed_at),
        lastFailureCode: successor.last_failure_code
      },
      { onExcessProperty: "error" }
    ).pipe(Effect14.mapError(() => new PlaygroundError({ code: "unavailable" })));
  }
  const [clock2] = yield* sql.unsafe(
    `SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now`
  );
  const next = effectiveProblem(
    problem,
    successor ? {
      jobId: String(successor.id),
      state: successor.state,
      lifecycleVersion: Number(successor.lifecycle_version)
    } : null,
    Number(clock2.now)
  );
  if (next === problem) {
    return problem;
  }
  yield* sql.unsafe(
    `UPDATE ${t.problems} SET problem=$4::jsonb WHERE sandbox_id=$1 AND generation=$2 AND root_job_id=$3`,
    [sandboxId, generation, rootJobId, JSON.stringify(next)]
  );
  const identity = yield* digestJson([
    rootJobId,
    problem.activeSuccessorJobId,
    successor ? Number(successor.lifecycle_version) : null
  ]).pipe(Effect14.mapError(() => new PlaygroundError({ code: "unavailable" })));
  yield* sql.unsafe(
    `INSERT INTO ${t.audit}(sandbox_id,generation,identity,root_job_id,successor_job_id,observed_lifecycle_version,action,fact,observed_at)
     VALUES ($1,$2,$3,$4,$5,$6,'reconciliation',$7::jsonb,$8) ON CONFLICT DO NOTHING`,
    [
      sandboxId,
      generation,
      identity,
      rootJobId,
      problem.activeSuccessorJobId,
      successor ? Number(successor.lifecycle_version) : null,
      JSON.stringify({
        _tag: "Resolution",
        rootJobId,
        state: next.state,
        kind: next.resolution?.kind ?? "Reopened",
        reason: null,
        observedAt: next.updatedAt
      }),
      next.updatedAt
    ]
  );
  return next;
});

// apps/playground-worker/src/persistence/authority/PrivateMode.ts
import { Context as Context9 } from "effect";
var LocalPrivate = Context9.Reference("playground/LocalPrivate", {
  defaultValue: () => false
});
var retainedMaximum = (local) => local ? Number.MAX_SAFE_INTEGER : 100;
var admissionMaximum = (local) => local ? Number.MAX_SAFE_INTEGER : 200;

// apps/playground-worker/src/persistence/authority/PostgreSqlRepairTransactions.ts
var fail2 = (code) => new PlaygroundError({ code });
var sameRef = (a, b) => a.sandboxId === b.sandboxId && a.generation === b.generation;
var clock = "floor(extract(epoch FROM clock_timestamp())*1000)::bigint";
var controls = (effect) => effect.pipe(
  Effect15.catchCause(
    (cause) => Effect15.failCause(
      Cause2.fromReasons(
        cause.reasons.map((reason) => {
          if (Cause2.isFailReason(reason) && isSqlError(reason.error) || Cause2.isDieReason(reason) && isSqlError(reason.defect)) {
            return Cause2.makeFailReason(
              new CommandTransactionFailure({ commitKnowledge: "Unknown" })
            );
          }
          return reason;
        })
      )
    )
  )
);
var decode2 = (schema, input) => Schema16.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
  Effect15.mapError(() => fail2("unavailable"))
);
var makeAdapter = (schema, category) => Effect15.gen(function* () {
  const sql = yield* SqlClient2;
  const local = yield* LocalPrivate;
  const t = relations2(schema);
  const query = (text3, values = []) => sql.unsafe(text3, values).pipe(
    Effect15.mapError(
      () => new CommandTransactionFailure({ commitKnowledge: "Unknown" })
    )
  );
  const lock = (access, ref) => Effect15.gen(function* () {
    if (access.sandbox.ref.sandboxId !== ref.sandboxId) {
      return yield* fail2("not-found");
    }
    const [row] = yield* query(
      `SELECT * FROM ${t.sandboxes} WHERE sandbox_id=$1 FOR UPDATE`,
      [ref.sandboxId]
    );
    if (!row) {
      return yield* fail2("not-found");
    }
    if (category === "LocalOperator" && (!local || row.demo_owned === true)) {
      return yield* fail2("not-found");
    }
    if (category === "SyntheticSeed" && row.demo_owned !== true) {
      return yield* fail2("not-found");
    }
    const [time2] = yield* query(`SELECT ${clock} AS now`);
    if (Number(row.expires_at) <= Number(time2.now)) {
      return yield* fail2("sandbox-expired");
    }
    const current = yield* decode2(SandboxRef, {
      sandboxId: row.sandbox_id,
      generation: Number(row.generation)
    });
    if (ref.generation > current.generation) {
      return yield* fail2("stale-generation");
    }
    return { row, current };
  });
  const lookup3 = (request, operation2) => Effect15.gen(function* () {
    const [row] = yield* query(
      `SELECT receipt,command_digest FROM ${t.receipts} WHERE sandbox_id=$1 AND generation=$2 AND operation=$3 AND request_id=$4`,
      [
        request.sandbox.sandboxId,
        request.sandbox.generation,
        operation2,
        request.requestId
      ]
    );
    if (!row) {
      return null;
    }
    const stored = yield* decode2(StoredRepairReceipt, row.receipt);
    yield* decode2(
      operation2 === "Repair" ? JobRepairResult : JobResolutionResult,
      stored.result
    );
    if (stored.commandDigest !== row.command_digest || !sameRef(stored.result.sandbox, request.sandbox) || stored.result.requestId !== request.requestId) {
      return yield* fail2("unavailable");
    }
    return stored;
  });
  return RepairTransactions.of({
    owned: (access, input, digest2, body) => Effect15.gen(function* () {
      const command = yield* decode2(
        Schema16.Union([JobRepairCommand, JobResolutionCommand]),
        input
      );
      if (!/^[a-f0-9]{64}$/u.test(digest2)) {
        return yield* fail2("invalid-request");
      }
      if (Option.isSome(yield* Effect15.serviceOption(sql.transactionService))) {
        return yield* new CommandTransactionFailure({
          commitKnowledge: "NotCommitted"
        });
      }
      const repair = "jobId" in command;
      const operation2 = repair ? "Repair" : "Resolution";
      const ref = command.sandbox;
      const args = [ref.sandboxId, ref.generation, operation2, command.requestId];
      const admission = yield* controls(
        sql.withTransaction(
          Effect15.gen(function* () {
            const { current, row } = yield* lock(access, ref);
            const [prior] = yield* query(
              `SELECT command_digest,actor_category FROM ${t.admission} WHERE sandbox_id=$1 AND generation=$2 AND operation=$3 AND request_id=$4`,
              args
            );
            if (prior) {
              return prior.command_digest === digest2 && prior.actor_category === category ? "Unresolved" : "Conflict";
            }
            if (!sameRef(current, ref)) {
              return yield* fail2("stale-generation");
            }
            const [budget] = yield* query(
              `SELECT (SELECT count(*) FROM ${t.admission} WHERE sandbox_id=$1)+(SELECT count(*) FROM "${schema}"."command_admission" WHERE sandbox_id=$1) AS n`,
              [ref.sandboxId]
            );
            const maximum = category === "SyntheticSeed" ? 4e4 : admissionMaximum(local);
            if (Number(budget.n) >= maximum) {
              return yield* fail2("limit-reached");
            }
            yield* query(
              `INSERT INTO ${t.admission}(sandbox_id,generation,operation,request_id,command_digest,actor_category) VALUES ($1,$2,$3,$4,$5,$6)`,
              [...args, digest2, category]
            );
            const [final] = yield* query(`SELECT ${clock} AS now`);
            if (Number(row.expires_at) <= Number(final.now)) {
              return yield* fail2("sandbox-expired");
            }
            return "Fresh";
          })
        )
      );
      return yield* controls(
        sql.withTransaction(
          Effect15.gen(function* () {
            const { current, row } = yield* lock(access, ref);
            const stored = admission === "Conflict" ? null : yield* lookup3(command, operation2);
            if (stored && stored.commandDigest !== digest2) {
              return yield* fail2("unavailable");
            }
            const assertCurrent = Effect15.gen(function* () {
              if (!sameRef(current, ref)) {
                return yield* fail2("stale-generation");
              }
              const [time2] = yield* query(`SELECT ${clock} AS now`);
              if (Number(row.expires_at) <= Number(time2.now)) {
                return yield* fail2("sandbox-expired");
              }
            });
            let root;
            let source;
            let problemLoaded = false;
            let problem = null;
            const loadProblem = Effect15.gen(function* () {
              yield* assertCurrent;
              if (problemLoaded) {
                return problem;
              }
              if (admission !== "Fresh" || stored) {
                return yield* fail2("unavailable");
              }
              if (repair) {
                const [member] = yield* query(
                  `SELECT root_job_id FROM ${t.members} WHERE sandbox_id=$1 AND generation=$2 AND job_id=$3`,
                  [ref.sandboxId, ref.generation, command.jobId]
                );
                root = member ? String(member.root_job_id) : command.jobId;
              } else {
                root = command.rootJobId;
              }
              problem = yield* reconcileLocked(
                schema,
                ref.sandboxId,
                ref.generation,
                root
              ).pipe(
                Effect15.provideService(SqlClient2, sql),
                Effect15.catchCause(
                  (cause) => Effect15.failCause(
                    Cause2.map(
                      cause,
                      (error) => error instanceof PlaygroundError ? error : new CommandTransactionFailure({
                        commitKnowledge: "Unknown"
                      })
                    )
                  )
                )
              );
              problemLoaded = true;
              return problem;
            });
            const loadSource = Effect15.gen(function* () {
              yield* loadProblem;
              if (source !== void 0) {
                return source;
              }
              const [found] = yield* query(
                `SELECT j.*,p.format_version,p.payload,p.projection,a.relations,l.accepted,l.invocations
            FROM ${t.associations} a JOIN ${t.jobs} j ON j.id=a.job_id
            LEFT JOIN ${t.payloads} p ON p.job_id=j.id
            LEFT JOIN ${t.ledger} l ON l.sandbox_id=a.sandbox_id AND l.generation=a.generation AND l.job_id=j.id
            WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.id=$3 FOR UPDATE OF j`,
                [
                  ref.sandboxId,
                  ref.generation,
                  repair ? command.jobId : command.rootJobId
                ]
              );
              source = found ?? null;
              return source;
            });
            const materialize = (value3) => Effect15.gen(function* () {
              if (value3.rootJobId !== root) {
                return yield* fail2("unavailable");
              }
              const checked = yield* decodeProblem(value3);
              yield* query(
                `INSERT INTO ${t.problems}(sandbox_id,generation,root_job_id,problem) VALUES ($1,$2,$3,$4::jsonb)
             ON CONFLICT(sandbox_id,generation,root_job_id) DO UPDATE SET problem=excluded.problem`,
                [ref.sandboxId, ref.generation, root, JSON.stringify(checked)]
              );
              problem = checked;
            });
            const result3 = yield* body({
              admission,
              stored,
              assertCurrent,
              now: query(`SELECT ${clock} AS now`).pipe(
                Effect15.map((rows) => Number(rows[0].now))
              ),
              source: () => loadSource,
              problem: () => loadProblem,
              associate: (resultJobId, next) => Effect15.gen(function* () {
                yield* assertCurrent;
                const original = yield* loadSource;
                if (!repair || !original || resultJobId === command.jobId || next.activeSuccessorJobId !== resultJobId || next.state !== "InProgress") {
                  return yield* fail2("unavailable");
                }
                const [child] = yield* query(
                  `SELECT original_source_job_id,source_job_id,redrive_kind FROM ${t.jobs} WHERE id=$1 FOR UPDATE`,
                  [resultJobId]
                );
                if (!child || child.original_source_job_id !== command.jobId || child.source_job_id !== command.jobId || child.redrive_kind !== (command.action === "redrive" ? "Redrive" : "CorrectedRedrive")) {
                  return yield* fail2("unavailable");
                }
                const maximum = category === "SyntheticSeed" ? 2e4 : retainedMaximum(local);
                const reserved = yield* query(
                  `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1 AND retained_jobs<$2 RETURNING sandbox_id`,
                  [ref.sandboxId, maximum]
                );
                if (reserved.length !== 1) {
                  return yield* fail2("limit-reached");
                }
                yield* query(
                  `INSERT INTO ${t.associations}(sandbox_id,generation,job_id,relations) VALUES($1,$2,$3,$4::jsonb)`,
                  [
                    ref.sandboxId,
                    ref.generation,
                    resultJobId,
                    JSON.stringify(original.relations)
                  ]
                );
                yield* materialize(next);
                for (const jobId of [command.jobId, resultJobId]) {
                  yield* query(
                    `INSERT INTO ${t.members}(sandbox_id,generation,job_id,live_job_id,root_job_id) VALUES ($1,$2,$3,$3,$4) ON CONFLICT(sandbox_id,generation,job_id) DO NOTHING`,
                    [ref.sandboxId, ref.generation, jobId, root]
                  );
                }
              }),
              save: (accepted, changes = null) => Effect15.gen(function* () {
                yield* assertCurrent;
                if (admission !== "Fresh" || stored || !sameRef(accepted.sandbox, ref) || accepted.requestId !== command.requestId) {
                  return yield* fail2("unavailable");
                }
                yield* decode2(
                  repair ? JobRepairResult : JobResolutionResult,
                  accepted
                );
                if (accepted._tag === "Rejected" && (repair ? !("jobId" in accepted) || accepted.jobId !== command.jobId : !("rootJobId" in accepted) || accepted.rootJobId !== command.rootJobId)) {
                  return yield* fail2("unavailable");
                }
                const value3 = yield* decode2(StoredRepairReceipt, {
                  commandDigest: digest2,
                  result: accepted
                });
                if (accepted._tag === "Committed") {
                  if (!repair) {
                    if (!("problem" in accepted)) {
                      return yield* fail2("unavailable");
                    }
                    if (accepted.problem.rootJobId !== command.rootJobId || accepted.problem.state !== "Resolved") {
                      return yield* fail2("unavailable");
                    }
                    yield* loadProblem;
                    yield* materialize(accepted.problem);
                    if (source) {
                      yield* query(
                        `INSERT INTO ${t.members}(sandbox_id,generation,job_id,live_job_id,root_job_id) VALUES ($1,$2,$3,$3,$3) ON CONFLICT DO NOTHING`,
                        [ref.sandboxId, ref.generation, root]
                      );
                    }
                  }
                  if (repair) {
                    if (!("resultJobId" in accepted) || accepted.sourceJobId !== command.jobId || accepted.action !== command.action) {
                      return yield* fail2("unavailable");
                    }
                    yield* query(
                      `INSERT INTO ${t.edges}(sandbox_id,generation,request_id,root_job_id,original_source_job_id,source_job_id,result_job_id,live_result_job_id,action,observed_at,reason,changes)
                  VALUES ($1,$2,$3,$4,$5,$5,$6,$6,$7,$8,$9,$10::jsonb)`,
                      [
                        ref.sandboxId,
                        ref.generation,
                        command.requestId,
                        root,
                        command.jobId,
                        accepted.resultJobId,
                        command.action,
                        accepted.observedAt,
                        command.reason,
                        JSON.stringify(changes)
                      ]
                    );
                  }
                  const fact = repair && "resultJobId" in accepted ? {
                    _tag: "Operator",
                    requestId: command.requestId,
                    action: command.action,
                    sourceJobId: command.jobId,
                    resultJobId: accepted.resultJobId,
                    observedAt: accepted.observedAt
                  } : {
                    _tag: "Resolution",
                    rootJobId: root,
                    state: "Resolved",
                    kind: "problem" in accepted ? accepted.problem.resolution?.kind : null,
                    reason: command.reason,
                    observedAt: accepted.observedAt
                  };
                  yield* query(
                    `INSERT INTO ${t.audit}(sandbox_id,generation,identity,root_job_id,action,fact,observed_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
                    [
                      ref.sandboxId,
                      ref.generation,
                      command.requestId,
                      root,
                      command.action,
                      JSON.stringify({
                        ...fact,
                        repairReason: repair ? command.reason : null,
                        operatorCategory: category,
                        investigation: repair ? command.investigation : null,
                        changes,
                        validation: repair ? "Valid" : null
                      }),
                      accepted.observedAt
                    ]
                  );
                }
                yield* query(
                  `INSERT INTO ${t.receipts}(sandbox_id,generation,operation,request_id,command_digest,receipt) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
                  [...args, digest2, JSON.stringify(value3)]
                );
              })
            });
            if (admission === "Fresh") {
              yield* assertCurrent;
            }
            return result3;
          })
        )
      );
    }),
    lookup: (access, input, operation2) => controls(
      sql.withTransaction(
        Effect15.gen(function* () {
          const request = yield* decode2(JobRepairReceiptRequest, input);
          yield* lock(access, request.sandbox);
          return yield* lookup3(request, operation2);
        })
      )
    )
  });
});
var make7 = (schema) => makeAdapter(schema, "LocalOperator");
var layerNoDeps3 = (schema) => Layer5.effect(RepairTransactions, make7(schema));
var syntheticLayerNoDeps2 = (schema) => Layer5.effect(SyntheticRepairTransactions, makeAdapter(schema, "SyntheticSeed"));

// apps/playground-worker/src/persistence/commands/OperatorPersistence.ts
import { Cause as Cause3, Effect as Effect17, Layer as Layer6, Schema as Schema18 } from "effect";
import { PostgreSqlJobs as PostgreSqlJobs2 } from "effect-jobs/PostgreSqlJobs";
import { PostgreSqlFailure as PostgreSqlFailure2 } from "effect-jobs/PostgreSqlTransaction";

// apps/playground-worker/src/persistence/commands/OperatorTransactions.ts
import { Context as Context10, Schema as Schema17 } from "effect";
var StoredOperatorReceipt = Schema17.Struct({
  command: JobOperatorCommand,
  result: Schema17.Union([JobOperatorResult.members[0], JobOperatorResult.members[1]])
});
var OperatorTransactions = class extends Context10.Service()("playground/OperatorTransactions") {
};

// apps/playground-worker/src/persistence/commands/OperatorPersistence.ts
var fail3 = (code) => new PlaygroundError({ code });
var decode3 = (schema, input) => Schema18.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
  Effect17.mapError(() => fail3("invalid-request"))
);
var unknown2 = (request) => ({
  _tag: "OutcomeUnknown",
  sandbox: request.sandbox,
  requestId: request.requestId
});
var recover2 = (request) => (cause) => {
  const reason = cause.reasons.length === 1 ? cause.reasons[0] : void 0;
  if (reason && Cause3.isFailReason(reason) && (reason.error instanceof CommandTransactionFailure || reason.error instanceof PostgreSqlFailure2) && reason.error.commitKnowledge === "Unknown") {
    return Effect17.succeed(unknown2(request));
  }
  return Effect17.failCause(
    Cause3.fromReasons(
      cause.reasons.map((reason2) => {
        if (Cause3.isInterruptReason(reason2)) {
          return reason2;
        }
        if (Cause3.isDieReason(reason2)) {
          return Cause3.makeDieReason(new Error("Operator persistence defect"));
        }
        return Cause3.makeFailReason(
          reason2.error instanceof PlaygroundError ? fail3(reason2.error.code) : fail3("unavailable")
        );
      })
    )
  );
};
var make8 = Effect17.gen(function* () {
  const transactions = yield* OperatorTransactions;
  const backend = yield* PostgreSqlJobs2;
  return Operators.of({
    execute: Effect17.fn("Operators.execute")(function* (access, input) {
      const command = yield* decode3(JobOperatorCommand, input);
      const reject = (reason) => ({
        _tag: "Rejected",
        sandbox: command.sandbox,
        requestId: command.requestId,
        action: command.action,
        jobId: command.jobId,
        reason
      });
      const result3 = yield* transactions.owned(
        access,
        command,
        (tx) => Effect17.gen(function* () {
          if (tx.stored) {
            if (commandIdentity(tx.stored.command) !== commandIdentity(command) || !matchesCommandResult(command, tx.stored.result)) {
              return yield* fail3("unavailable");
            }
            return tx.stored.result;
          }
          if (tx.admission === "Unresolved") {
            return unknown2(command);
          }
          yield* tx.assertCurrent;
          const source = yield* tx.source();
          if (source === null) {
            const result5 = reject("not-found");
            yield* tx.save(result5);
            return result5;
          }
          const expected = {
            jobId: command.jobId,
            state: command.expectedState,
            lifecycleVersion: command.expectedLifecycleVersion
          };
          const operate = Effect17.gen(function* () {
            if (command.action === "redrive") {
              return reject("investigation-required");
            }
            const transition = yield* command.action === "cancel" ? backend.operators.cancel(expected) : backend.operators.retryNow(expected);
            return yield* decode3(JobOperatorResult.members[0], {
              _tag: "Committed",
              sandbox: command.sandbox,
              requestId: command.requestId,
              action: command.action,
              sourceJobId: command.jobId,
              sourceState: transition.beforeState,
              sourceLifecycleVersion: transition.beforeVersion,
              resultJobId: transition.jobId,
              resultState: transition.after.state,
              resultLifecycleVersion: transition.after.lifecycleVersion,
              observedAt: transition.after.updatedAt
            });
          }).pipe(
            Effect17.catchTag(
              "JobOperatorRejected",
              (error) => error.reason === "lineage-conflict" ? Effect17.fail(error) : Effect17.succeed(reject(error.reason))
            )
          );
          const result4 = yield* operate;
          yield* tx.save(result4);
          return result4;
        })
      ).pipe(Effect17.catchCause(recover2(command)));
      if (!matchesCommandResult(command, result3)) {
        return yield* fail3("unavailable");
      }
      return result3;
    }),
    receipt: Effect17.fn("Operators.receipt")(function* (access, input) {
      const request = yield* decode3(JobOperatorReceiptRequest, input);
      const stored = yield* transactions.lookup(access, request).pipe(Effect17.catchCause(recover2(request)));
      if (stored === null) {
        return unknown2(request);
      }
      if ("_tag" in stored) {
        return stored;
      }
      if (!matchesCommandResult(stored.command, stored.result) || stored.result.requestId !== request.requestId || stored.result.sandbox.sandboxId !== request.sandbox.sandboxId || stored.result.sandbox.generation !== request.sandbox.generation) {
        return yield* fail3("unavailable");
      }
      return stored.result;
    })
  });
});
var layerNoDeps4 = Layer6.effect(Operators, make8);

// apps/playground-worker/src/persistence/authority/PostgreSqlOperatorTransactions.ts
import { Cause as Cause4, Effect as Effect18, Layer as Layer7, Option as Option2, Schema as Schema19 } from "effect";
import { SqlClient as SqlClient3 } from "effect/sql/SqlClient";
import { isSqlError as isSqlError2 } from "effect/sql/SqlError";
var fail4 = (code) => new PlaygroundError({ code });
var sameRef2 = (a, b) => a.sandboxId === b.sandboxId && a.generation === b.generation;
var dbTime = "floor(extract(epoch FROM clock_timestamp())*1000)::bigint";
var controls2 = (effect) => effect.pipe(
  Effect18.catchCause(
    (cause) => Effect18.failCause(
      Cause4.fromReasons(
        cause.reasons.map((reason) => {
          if (Cause4.isFailReason(reason) && isSqlError2(reason.error) || Cause4.isDieReason(reason) && isSqlError2(reason.defect)) {
            return Cause4.makeFailReason(
              new CommandTransactionFailure({ commitKnowledge: "Unknown" })
            );
          }
          return reason;
        })
      )
    )
  )
);
var decode4 = (schema, input) => Schema19.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
  Effect18.mapError(() => fail4("unavailable"))
);
var make9 = (schema) => Effect18.gen(function* () {
  const sql = yield* SqlClient3;
  const local = yield* LocalPrivate;
  const retainedMaximum2 = retainedMaximum(local);
  const admissionMaximum2 = admissionMaximum(local);
  const t = relations(schema);
  const lineage = `"${schema}"."operator_redrives"`;
  const payloads = `"${schema}"."job_payloads"`;
  const query = (text3, values = []) => sql.unsafe(text3, values).pipe(
    Effect18.mapError(
      () => new CommandTransactionFailure({ commitKnowledge: "Unknown" })
    )
  );
  const lock = (access, ref) => Effect18.gen(function* () {
    if (access.sandbox.ref.sandboxId !== ref.sandboxId) {
      return yield* fail4("not-found");
    }
    const [row] = yield* query(
      `SELECT * FROM ${t.sandboxes} WHERE sandbox_id=$1 FOR UPDATE`,
      [ref.sandboxId]
    );
    if (!row) {
      return yield* fail4("not-found");
    }
    if (row.demo_owned === true) {
      return yield* fail4("capability-unavailable");
    }
    const [clock2] = yield* query(`SELECT ${dbTime} AS now`);
    if (Number(row.expires_at) <= Number(clock2.now)) {
      return yield* fail4("sandbox-expired");
    }
    const current = yield* decode4(SandboxRef, {
      sandboxId: row.sandbox_id,
      generation: Number(row.generation)
    });
    if (ref.generation > current.generation) {
      return yield* fail4("stale-generation");
    }
    return { row, current };
  });
  const receipt = (request) => Effect18.gen(function* () {
    const [row] = yield* query(
      `SELECT receipt FROM ${t.receipts} WHERE sandbox_id=$1 AND generation=$2 AND operation='Operator' AND request_id=$3`,
      [request.sandbox.sandboxId, request.sandbox.generation, request.requestId]
    );
    if (!row) {
      return null;
    }
    const stored = yield* decode4(StoredOperatorReceipt, row.receipt);
    if (!sameRef2(stored.command.sandbox, request.sandbox) || !sameRef2(stored.result.sandbox, request.sandbox) || stored.command.requestId !== request.requestId || stored.result.requestId !== request.requestId || stored.command.action !== stored.result.action || stored.result._tag === "Rejected" && stored.result.jobId !== stored.command.jobId || stored.result._tag === "Committed" && (stored.result.sourceJobId !== stored.command.jobId || stored.result.sourceState !== stored.command.expectedState || stored.result.sourceLifecycleVersion !== stored.command.expectedLifecycleVersion)) {
      return yield* fail4("unavailable");
    }
    return stored;
  });
  return OperatorTransactions.of({
    owned: (access, input, body) => Effect18.gen(function* () {
      const command = yield* Schema19.decodeUnknownEffect(JobOperatorCommand)(input, {
        onExcessProperty: "error"
      }).pipe(Effect18.mapError(() => fail4("invalid-request")));
      if (Option2.isSome(yield* Effect18.serviceOption(sql.transactionService))) {
        return yield* new CommandTransactionFailure({
          commitKnowledge: "NotCommitted"
        });
      }
      const identity = commandIdentity(command);
      const fresh = yield* controls2(
        sql.withTransaction(
          Effect18.gen(function* () {
            const { current } = yield* lock(access, command.sandbox);
            const [prior] = yield* query(
              `SELECT operator_command FROM ${t.admission} WHERE sandbox_id=$1 AND generation=$2 AND operation='Operator' AND request_id=$3`,
              [
                command.sandbox.sandboxId,
                command.sandbox.generation,
                command.requestId
              ]
            );
            if (prior) {
              if (prior.operator_command !== identity) {
                return yield* fail4("invalid-request");
              }
              return false;
            }
            if (!sameRef2(current, command.sandbox)) {
              return yield* fail4("stale-generation");
            }
            const [budget] = yield* query(
              `SELECT count(*) AS n FROM ${t.admission} WHERE sandbox_id=$1`,
              [current.sandboxId]
            );
            if (Number(budget.n) >= admissionMaximum2) {
              return yield* fail4("limit-reached");
            }
            yield* query(
              `INSERT INTO ${t.admission}(sandbox_id,generation,operation,request_id,operator_command) VALUES ($1,$2,'Operator',$3,$4)`,
              [current.sandboxId, current.generation, command.requestId, identity]
            );
            return true;
          })
        )
      );
      return yield* controls2(
        sql.withTransaction(
          Effect18.gen(function* () {
            const { row, current } = yield* lock(access, command.sandbox);
            const stored = yield* receipt(command);
            if (stored && commandIdentity(stored.command) !== identity) {
              return yield* fail4("invalid-request");
            }
            const assertCurrent = Effect18.gen(function* () {
              if (!sameRef2(current, command.sandbox)) {
                return yield* fail4("stale-generation");
              }
              const [clock2] = yield* query(`SELECT ${dbTime} AS now`);
              if (Number(row.expires_at) <= Number(clock2.now)) {
                return yield* fail4("sandbox-expired");
              }
            });
            let source;
            const scopedSource = Effect18.gen(function* () {
              yield* assertCurrent;
              if (!fresh || stored !== null) {
                return yield* fail4("unavailable");
              }
              if (source !== void 0) {
                return source;
              }
              const [found] = yield* query(
                `SELECT j.*,p.format_version,p.payload,p.projection,a.relations
            FROM ${t.associations} a JOIN ${t.jobs} j ON j.id=a.job_id
            LEFT JOIN ${payloads} p ON p.job_id=j.id
            WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.id=$3 FOR UPDATE OF j`,
                [current.sandboxId, current.generation, command.jobId]
              );
              source = found ?? null;
              return source;
            });
            const result3 = yield* body({
              admission: fresh ? "Fresh" : "Unresolved",
              stored,
              assertCurrent,
              source: () => scopedSource,
              associateRedrive: (accepted) => Effect18.gen(function* () {
                yield* assertCurrent;
                if (accepted.action !== "redrive" || command.action !== "redrive" || accepted.sourceJobId !== command.jobId || accepted.resultJobId === command.jobId || !sameRef2(accepted.sandbox, command.sandbox) || accepted.requestId !== command.requestId || accepted.sourceState !== command.expectedState || accepted.sourceLifecycleVersion !== command.expectedLifecycleVersion) {
                  return yield* fail4("unavailable");
                }
                const original = yield* scopedSource;
                if (!original) {
                  return yield* fail4("not-found");
                }
                const reserved = yield* query(
                  `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1 AND retained_jobs<${retainedMaximum2} RETURNING sandbox_id`,
                  [current.sandboxId]
                );
                if (reserved.length !== 1) {
                  return yield* fail4("limit-reached");
                }
                yield* query(
                  `INSERT INTO ${t.associations}(sandbox_id,generation,job_id,relations) VALUES ($1,$2,$3,$4::jsonb)`,
                  [
                    current.sandboxId,
                    current.generation,
                    accepted.resultJobId,
                    JSON.stringify(original.relations)
                  ]
                );
              }),
              save: (accepted) => Effect18.gen(function* () {
                yield* assertCurrent;
                if (!matchesCommandResult(command, accepted)) {
                  return yield* fail4("unavailable");
                }
                const value3 = yield* decode4(StoredOperatorReceipt, {
                  command,
                  result: accepted
                });
                if (stored || !fresh) {
                  return yield* fail4("unavailable");
                }
                yield* query(
                  `INSERT INTO ${t.receipts}(sandbox_id,generation,operation,request_id,receipt) VALUES ($1,$2,'Operator',$3,$4::jsonb)`,
                  [
                    current.sandboxId,
                    current.generation,
                    command.requestId,
                    JSON.stringify(value3)
                  ]
                );
                if (accepted._tag === "Committed") {
                  yield* query(
                    `INSERT INTO ${t.audit}(sandbox_id,generation,operation,reason,count,observed_at) VALUES ($1,$2,'Operator',$3,$4,$5)`,
                    [
                      current.sandboxId,
                      current.generation,
                      accepted.action,
                      accepted.action === "redrive" ? 1 : 0,
                      accepted.observedAt
                    ]
                  );
                  if (accepted.action === "redrive") {
                    yield* query(
                      `INSERT INTO ${lineage}(sandbox_id,generation,request_id,source_job_id,source_state,source_lifecycle_version,successor_job_id,observed_at)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                      [
                        current.sandboxId,
                        current.generation,
                        command.requestId,
                        accepted.sourceJobId,
                        accepted.sourceState,
                        accepted.sourceLifecycleVersion,
                        accepted.resultJobId,
                        accepted.observedAt
                      ]
                    );
                  }
                }
              })
            });
            if (fresh) {
              yield* assertCurrent;
            }
            return result3;
          })
        )
      );
    }),
    lookup: (access, input) => controls2(
      sql.withTransaction(
        Effect18.gen(function* () {
          const request = yield* Schema19.decodeUnknownEffect(
            JobOperatorReceiptRequest
          )(input, { onExcessProperty: "error" }).pipe(
            Effect18.mapError(() => fail4("invalid-request"))
          );
          yield* lock(access, request.sandbox);
          return yield* receipt(request);
        })
      )
    )
  });
});
var layerNoDeps5 = (schema) => Layer7.effect(OperatorTransactions, make9(schema));

// apps/playground-worker/src/execution/Event.ts
import * as Reactivity2 from "effect/reactivity/Reactivity";
import "effect-jobs/JobWorker";
import { Effect as Effect37, Layer as Layer18, Redacted as Redacted5 } from "effect";

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgClient.js
import * as Config from "effect/Config";
import * as Context13 from "effect/Context";
import * as Effect22 from "effect/Effect";
import * as Layer8 from "effect/Layer";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Client from "effect/sql/SqlClient";
import { SqlError as SqlError3, UnknownError as UnknownError3 } from "effect/sql/SqlError";
import * as Statement from "effect/sql/Statement";
import * as Stream2 from "effect/Stream";

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/internal/sqlError.js
import { AuthenticationError, AuthorizationError, ConnectionError, ConstraintError, DeadlockError, LockTimeoutError, SerializationError, SqlError, SqlSyntaxError, StatementTimeoutError, UniqueViolation, UnknownError } from "effect/sql/SqlError";
var channelNameEncoder = /* @__PURE__ */ new TextEncoder();
var validateChannelName = (channel, operation2) => {
  if (channelNameEncoder.encode(channel).byteLength <= 63) return void 0;
  const message = "PostgreSQL channel names must not exceed 63 UTF-8 bytes";
  return new SqlError({
    reason: new UnknownError({
      cause: new Error(message),
      message,
      operation: operation2
    })
  });
};
var normalizeConstraint = (constraint) => {
  if (typeof constraint !== "string") return "unknown";
  const normalized = constraint.trim();
  return normalized.length === 0 ? "unknown" : normalized;
};
var classifySqlState = (code, constraint, props) => {
  if (code !== void 0) {
    if (code.startsWith("08")) {
      return new ConnectionError(props);
    }
    if (code.startsWith("28")) {
      return new AuthenticationError(props);
    }
    if (code === "42501") {
      return new AuthorizationError(props);
    }
    if (code.startsWith("42")) {
      return new SqlSyntaxError(props);
    }
    if (code === "23505") {
      return new UniqueViolation({
        ...props,
        constraint: normalizeConstraint(constraint)
      });
    }
    if (code.startsWith("23")) {
      return new ConstraintError(props);
    }
    if (code === "40P01") {
      return new DeadlockError(props);
    }
    if (code === "40001") {
      return new SerializationError(props);
    }
    if (code === "55P03") {
      return new LockTimeoutError(props);
    }
    if (code === "57014") {
      return new StatementTimeoutError(props);
    }
  }
  return new UnknownError(props);
};

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgConnection.js
import * as Cause5 from "effect/Cause";
import * as Channel from "effect/Channel";
import * as Context11 from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect20 from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Redacted3 from "effect/Redacted";
import * as EffectResult from "effect/Result";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { AuthenticationError as AuthenticationError2, ConnectionError as ConnectionError2, SqlError as SqlError2, UnknownError as UnknownError2 } from "effect/sql/SqlError";
import * as Stream from "effect/Stream";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import * as Net from "node:net";
import * as Tls from "node:tls";

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/internal/connection.js
var internalsKey = "~@effect/sql-pg/PgConnection/internals";
var connectionInternals = (connection) => connection[internalsKey];

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/internal/password.js
import * as Effect19 from "effect/Effect";
import * as Redacted2 from "effect/Redacted";
var resolve = (password) => password === void 0 ? Effect19.succeed(void 0) : Effect19.isEffect(password) ? Effect19.map(password, Redacted2.value) : Effect19.succeed(Redacted2.value(password));

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgAuth.js
import * as Data from "effect/Data";
import * as Base64 from "effect/encoding/Base64";
import * as Result from "effect/Result";
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
var AuthError = class extends (/* @__PURE__ */ Data.TaggedError("PgAuthError")) {
};
var fail6 = (message) => {
  throw new AuthError({
    message
  });
};
var result = (evaluate) => {
  try {
    return Result.succeed(evaluate());
  } catch (error) {
    if (error instanceof AuthError) return Result.fail(error);
    throw error;
  }
};
var textEncoder = /* @__PURE__ */ new TextEncoder();
var textDecoder = /* @__PURE__ */ new TextDecoder("utf-8", {
  fatal: true
});
var maxScramIterations = 1e6;
var bytesOf = (value3) => Uint8Array.from(value3);
var sha2562 = (data) => bytesOf(createHash("sha256").update(data).digest());
var hmacSha256 = (key, data) => bytesOf(createHmac("sha256", key).update(data).digest());
var xor = (left, right) => {
  const result3 = new Uint8Array(left.length);
  for (let i = 0; i < left.length; i++) {
    result3[i] = left[i] ^ right[i];
  }
  return result3;
};
var toBase64 = (bytes2) => Base64.encode(bytes2);
var fromBase64 = (text3, field) => {
  const decoded = Base64.decode(text3);
  if (Result.isFailure(decoded)) {
    return fail6(`Invalid base64 in SCRAM attribute "${field}"`);
  }
  return decoded.success;
};
var decodeUtf8 = (bytes2, what) => {
  try {
    return textDecoder.decode(bytes2);
  } catch {
    return fail6(`Invalid UTF-8 in ${what}`);
  }
};
var md5PasswordUnsafe = (options) => {
  if (options.salt.length !== 4) {
    return fail6(`PostgreSQL MD5 salt must be exactly 4 bytes, received ${options.salt.length}`);
  }
  const inner = createHash("md5").update(textEncoder.encode(options.password + options.user)).digest("hex");
  const outer = createHash("md5").update(textEncoder.encode(inner)).update(options.salt).digest("hex");
  return `md5${outer}`;
};
var md5Password = (options) => result(() => md5PasswordUnsafe(options));
var SCRAM_SHA_256 = "SCRAM-SHA-256";
var GS2_HEADER = "n,,";
var CHANNEL_BINDING = "biws";
var parseAttributes = (message) => {
  const attributes = /* @__PURE__ */ new Map();
  for (const part of message.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      return fail6(`Malformed SCRAM attribute: "${part}"`);
    }
    const key = part.slice(0, separator);
    if (attributes.has(key)) {
      return fail6(`Duplicate SCRAM attribute "${key}"`);
    }
    attributes.set(key, part.slice(separator + 1));
  }
  return attributes;
};
var attribute = (attributes, key) => attributes.get(key) ?? fail6(`Missing SCRAM attribute "${key}"`);
var scramInitUnsafe = (options) => {
  if (!/^[\x21-\x2b\x2d-\x7e]+$/.test(options.nonce)) {
    return fail6("SCRAM nonce must contain only printable ASCII characters other than comma");
  }
  const clientFirstMessageBare = `n=,r=${options.nonce}`;
  return {
    state: {
      _tag: "ScramFirst",
      password: options.password,
      clientNonce: options.nonce,
      clientFirstMessageBare
    },
    response: textEncoder.encode(GS2_HEADER + clientFirstMessageBare)
  };
};
var scramInit = (options) => result(() => scramInitUnsafe(options));
var scramContinueUnsafe = (state, challenge) => {
  const serverFirstMessage = decodeUtf8(challenge, "the SCRAM server-first-message");
  const attributes = parseAttributes(serverFirstMessage);
  const nonce = attribute(attributes, "r");
  if (!nonce.startsWith(state.clientNonce) || nonce.length === state.clientNonce.length) {
    return fail6("SCRAM server nonce does not extend the client nonce");
  }
  const saltText = attribute(attributes, "s");
  if (saltText.length === 0) {
    return fail6("SCRAM salt must not be empty");
  }
  const salt = fromBase64(saltText, "s");
  const iterationText = attribute(attributes, "i");
  const iterations = Number(iterationText);
  if (!/^[1-9]\d*$/.test(iterationText) || !Number.isSafeInteger(iterations) || iterations > maxScramIterations) {
    return fail6(`Invalid SCRAM iteration count: ${iterationText}`);
  }
  const saltedPassword = bytesOf(pbkdf2Sync(textEncoder.encode(state.password), salt, iterations, 32, "sha256"));
  const clientKey = hmacSha256(saltedPassword, textEncoder.encode("Client Key"));
  const storedKey = sha2562(clientKey);
  const clientFinalMessageWithoutProof = `c=${CHANNEL_BINDING},r=${nonce}`;
  const authMessage = textEncoder.encode(`${state.clientFirstMessageBare},${serverFirstMessage},${clientFinalMessageWithoutProof}`);
  const clientProof = xor(clientKey, hmacSha256(storedKey, authMessage));
  const serverKey = hmacSha256(saltedPassword, textEncoder.encode("Server Key"));
  return {
    state: {
      _tag: "ScramFinal",
      serverSignature: hmacSha256(serverKey, authMessage)
    },
    response: textEncoder.encode(`${clientFinalMessageWithoutProof},p=${toBase64(clientProof)}`)
  };
};
var scramContinue = (state, challenge) => result(() => scramContinueUnsafe(state, challenge));
var scramFinishUnsafe = (state, challenge) => {
  const attributes = parseAttributes(decodeUtf8(challenge, "the SCRAM server-final-message"));
  const error = attributes.get("e");
  if (error !== void 0) {
    fail6(`SCRAM authentication failed: ${error}`);
  }
  const signature = fromBase64(attribute(attributes, "v"), "v");
  if (toBase64(state.serverSignature) !== toBase64(signature)) {
    fail6("SCRAM server signature mismatch");
  }
};
var scramFinish = (state, challenge) => result(() => scramFinishUnsafe(state, challenge));

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgProtocol.js
import * as Data2 from "effect/Data";
import * as Result2 from "effect/Result";
var defaultMaxMessageSize = 16 * 1024 * 1024;
var maxBufferSize = 64 * 1024;
var makeParser = (options) => {
  const maxMessageSize = options?.maxMessageSize ?? defaultMaxMessageSize;
  const reader = new Reader();
  let bufferSize = 8192;
  let buffer = new Uint8Array(bufferSize);
  let store = buffer.buffer;
  let start = 0;
  let end2 = 0;
  let failed = false;
  const append = (chunk) => {
    if (end2 + chunk.length > buffer.length) {
      const pending = end2 - start;
      if (bufferSize < maxBufferSize) bufferSize *= 2;
      let capacity = bufferSize;
      while (capacity < pending + chunk.length) capacity *= 2;
      const next = new Uint8Array(capacity);
      next.set(buffer.subarray(start, end2));
      buffer = next;
      store = next.buffer;
      start = 0;
      end2 = pending;
    }
    buffer.set(chunk, end2);
    end2 += chunk.length;
  };
  const parser = {
    readField: options?.readField,
    push(chunk) {
      const messages = [];
      parser.pushEach(chunk, (message) => {
        messages.push(message);
      });
      return messages;
    },
    pushEach(chunk, onMessage) {
      if (failed) {
        throw new ParseError({
          message: "Parser cannot be reused after a failure"
        });
      }
      try {
        append(chunk);
        while (end2 - start >= 5) {
          const length = buffer[start + 1] << 24 | buffer[start + 2] << 16 | buffer[start + 3] << 8 | buffer[start + 4];
          if (length < 4) {
            throw new ParseError({
              message: `Invalid message length: ${length}`
            });
          }
          if (length > maxMessageSize) {
            throw new ParseError({
              message: `Message length ${length} exceeds maxMessageSize ${maxMessageSize}`
            });
          }
          if (end2 - start < length + 1) break;
          const type = buffer[start];
          const body = start + 5;
          const limit = start + 1 + length;
          start = limit;
          if (type === BackendType.DataRow) {
            onMessage(decodeDataRow(buffer, store, 0, body, limit, parser.readField));
          } else {
            reader.reset(buffer, body, limit);
            const message = decodeBackend(type, reader);
            if (reader.offset !== limit) {
              throw new ParseError({
                message: `Message has ${limit - reader.offset} trailing byte(s)`
              });
            }
            onMessage(message);
          }
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  return parser;
};
var ParseError = class extends (/* @__PURE__ */ Data2.TaggedError("PgProtocolParseError")) {
};
var EncodeError = class extends (/* @__PURE__ */ Data2.TaggedError("PgProtocolEncodeError")) {
};
var textEncoder2 = /* @__PURE__ */ new TextEncoder();
var textDecoder2 = /* @__PURE__ */ new TextDecoder("utf-8", {
  fatal: true
});
var asciiEncodeLimit = 48;
var view = (store, offset, length) => new Uint8Array(store, offset, length);
var smallCopyLimit = 8;
var Writer = class {
  poolSize;
  bytes;
  view;
  /** Where the message currently being written begins. */
  start = 0;
  offset = 0;
  /** Set by `sqlNull`, read and cleared by the `makeBindEncoder` loop. */
  isNull = false;
  constructor(poolSize) {
    this.poolSize = poolSize;
    this.bytes = new Uint8Array(poolSize);
    this.view = new DataView(this.bytes.buffer);
  }
  reserve(size) {
    if (this.offset + size <= this.bytes.length) return;
    const pending = this.offset - this.start;
    let capacity = this.poolSize;
    while (capacity < pending + size) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.bytes.subarray(this.start, this.offset));
    this.bytes = next;
    this.view = new DataView(next.buffer);
    this.start = 0;
    this.offset = pending;
  }
  /** Starts a message, dropping anything a failed write left behind. */
  begin() {
    this.start = this.offset;
  }
  uint8(value3) {
    this.reserve(1);
    this.bytes[this.offset++] = value3;
  }
  int16(value3) {
    this.reserve(2);
    const bytes2 = this.bytes;
    const offset = this.offset;
    bytes2[offset] = value3 >>> 8;
    bytes2[offset + 1] = value3;
    this.offset = offset + 2;
  }
  int32(value3) {
    this.reserve(4);
    this.setInt32(this.offset, value3);
    this.offset += 4;
  }
  setInt32(offset, value3) {
    const bytes2 = this.bytes;
    bytes2[offset] = value3 >>> 24;
    bytes2[offset + 1] = value3 >>> 16;
    bytes2[offset + 2] = value3 >>> 8;
    bytes2[offset + 3] = value3;
  }
  float32(value3) {
    this.reserve(4);
    this.view.setFloat32(this.offset, value3);
    this.offset += 4;
  }
  float64(value3) {
    this.reserve(8);
    this.view.setFloat64(this.offset, value3);
    this.offset += 8;
  }
  bigInt64(value3) {
    this.reserve(8);
    this.view.setBigInt64(this.offset, value3);
    this.offset += 8;
  }
  raw(value3) {
    const length = value3.length;
    this.reserve(length);
    const bytes2 = this.bytes;
    const offset = this.offset;
    if (length <= smallCopyLimit) {
      for (let index = 0; index < length; index++) bytes2[offset + index] = value3[index];
    } else {
      bytes2.set(value3, offset);
    }
    this.offset = offset + length;
  }
  sqlNull() {
    this.isNull = true;
  }
  beginLength() {
    const token = this.offset - this.start;
    this.int32(0);
    return token;
  }
  endLength(token) {
    this.setInt32(this.start + token, this.offset - this.start - token - 4);
  }
  utf8(value3, nul = false) {
    const length = value3.length;
    if (length <= asciiEncodeLimit) {
      this.reserve(length + (nul ? 1 : 0));
      const bytes2 = this.bytes;
      const start = this.offset;
      let i = 0;
      for (; i < length; i++) {
        const code = value3.charCodeAt(i);
        if (code > 127) break;
        bytes2[start + i] = code;
      }
      if (i === length) {
        const offset = start + length;
        if (nul) bytes2[offset] = 0;
        this.offset = offset + (nul ? 1 : 0);
        return;
      }
    }
    this.reserve(length * 3 + (nul ? 1 : 0));
    this.offset += textEncoder2.encodeInto(value3, this.bytes.subarray(this.offset)).written;
    if (nul) this.bytes[this.offset++] = 0;
  }
  cString(value3) {
    this.utf8(value3, true);
  }
  finish() {
    const value3 = view(this.bytes.buffer, this.bytes.byteOffset + this.start, this.offset - this.start);
    if (this.bytes.length > this.poolSize) {
      this.bytes = new Uint8Array(this.poolSize);
      this.view = new DataView(this.bytes.buffer);
      this.start = 0;
      this.offset = 0;
    } else {
      this.start = this.offset;
    }
    return value3;
  }
};
var emptyBytes = /* @__PURE__ */ new Uint8Array(0);
var Reader = class {
  bytes = emptyBytes;
  /** The backing store of `bytes` and its offset into it, resolved per message. */
  store = emptyBytes.buffer;
  base = 0;
  offset = 0;
  limit = 0;
  reset(bytes2, offset, limit) {
    this.bytes = bytes2;
    this.store = bytes2.buffer;
    this.base = bytes2.byteOffset;
    this.offset = offset;
    this.limit = limit;
  }
  require(size) {
    if (size < 0) {
      throw new ParseError({
        message: `Invalid read of ${size} byte(s)`
      });
    }
    if (this.offset + size > this.limit) {
      throw new ParseError({
        message: `Truncated message: expected ${size} more byte(s)`
      });
    }
  }
  uint8() {
    this.require(1);
    return this.bytes[this.offset++];
  }
  int16() {
    this.require(2);
    const bytes2 = this.bytes;
    const offset = this.offset;
    this.offset = offset + 2;
    return (bytes2[offset] << 8 | bytes2[offset + 1]) << 16 >> 16;
  }
  int32() {
    this.require(4);
    const bytes2 = this.bytes;
    const offset = this.offset;
    this.offset = offset + 4;
    return bytes2[offset] << 24 | bytes2[offset + 1] << 16 | bytes2[offset + 2] << 8 | bytes2[offset + 3];
  }
  uint32() {
    return this.int32() >>> 0;
  }
  raw(size) {
    this.require(size);
    const value3 = view(this.store, this.base + this.offset, size);
    this.offset += size;
    return value3;
  }
  rest() {
    return this.raw(this.limit - this.offset);
  }
  cString() {
    const end2 = this.bytes.indexOf(0, this.offset);
    if (end2 === -1 || end2 >= this.limit) {
      throw new ParseError({
        message: "Unterminated string"
      });
    }
    const value3 = decodeUtf82(this.bytes, this.offset, end2 - this.offset);
    this.offset = end2 + 1;
    return value3;
  }
};
var asciiDecodeLimit = 10;
var utf8Slice = globalThis.Buffer?.prototype?.utf8Slice;
var decodeUtf82 = (bytes2, offset, size) => {
  if (size <= asciiDecodeLimit) {
    let text3 = "";
    let index = 0;
    for (; index < size; index++) {
      const code = bytes2[offset + index];
      if (code > 127) break;
      text3 += String.fromCharCode(code);
    }
    if (index === size) return text3;
  }
  if (utf8Slice !== void 0) {
    const text3 = utf8Slice.call(bytes2, offset, offset + size);
    if (text3.indexOf("\uFFFD") === -1) return text3;
  }
  try {
    return textDecoder2.decode(view(bytes2.buffer, bytes2.byteOffset + offset, size));
  } catch {
    throw new ParseError({
      message: "Invalid UTF-8 in message"
    });
  }
};
var sharedWriter = /* @__PURE__ */ new Writer(8192);
var begin = (type) => {
  const writer = sharedWriter;
  writer.begin();
  writer.reserve(5);
  const bytes2 = writer.bytes;
  const offset = writer.offset;
  bytes2[offset] = type;
  writer.offset = offset + 5;
  return writer;
};
var end = () => {
  sharedWriter.setInt32(sharedWriter.start + 1, sharedWriter.offset - sharedWriter.start - 1);
  return sharedWriter.finish();
};
var empty = (type) => {
  const writer = begin(type);
  writer.setInt32(writer.start + 1, 4);
  return writer.finish();
};
var targetByte = (target) => target === "statement" ? 83 : 80;
var requireInt16Count = (count, name2) => {
  if (count > 32767) throw new EncodeError({
    message: `${name2} count exceeds 32767: ${count}`
  });
  return count;
};
var encodeResult = (evaluate) => {
  try {
    return Result2.succeed(evaluate());
  } catch (error) {
    if (error instanceof EncodeError) return Result2.fail(error);
    throw error;
  }
};
var encodeParseUnsafe = (options) => {
  const writer = begin(80);
  writer.cString(options.name);
  writer.cString(options.query);
  const parameterTypes = options.parameterTypes;
  const count = requireInt16Count(parameterTypes.length, "Parse parameter type");
  writer.reserve(2 + count * 4);
  const bytes2 = writer.bytes;
  let offset = writer.offset;
  bytes2[offset] = count >>> 8;
  bytes2[offset + 1] = count;
  offset += 2;
  for (let index = 0; index < count; index++) {
    const oid2 = parameterTypes[index];
    bytes2[offset] = oid2 >>> 24;
    bytes2[offset + 1] = oid2 >>> 16;
    bytes2[offset + 2] = oid2 >>> 8;
    bytes2[offset + 3] = oid2;
    offset += 4;
  }
  writer.offset = offset;
  return end();
};
var encodeParse = (options) => encodeResult(() => encodeParseUnsafe(options));
var valueWriterUnsafe = /* @__PURE__ */ Symbol.for("@effect/sql-pg/PgProtocol/ValueWriter/unsafe");
var makeBindEncoder = (writeParameter2, textFormat) => (options) => {
  try {
    const writer = begin(66);
    writer.cString(options.portal);
    writer.cString(options.statement);
    const parameters = options.parameters;
    const count = requireInt16Count(parameters.length, "Bind parameter");
    let textCount = 0;
    if (textFormat !== void 0) {
      for (let index = 0; index < count; index++) {
        if (textFormat(parameters[index])) textCount++;
      }
    }
    if (textCount === 0 || textCount === count) {
      const code = textCount === 0 ? 1 : 0;
      writer.reserve(6);
      const header = writer.bytes;
      const headerOffset = writer.offset;
      header[headerOffset] = 0;
      header[headerOffset + 1] = 1;
      header[headerOffset + 2] = 0;
      header[headerOffset + 3] = code;
      header[headerOffset + 4] = count >>> 8;
      header[headerOffset + 5] = count;
      writer.offset = headerOffset + 6;
    } else {
      writer.int16(count);
      for (let index = 0; index < count; index++) {
        writer.int16(textFormat(parameters[index]) ? 0 : 1);
      }
      writer.int16(count);
    }
    const writeUnsafe = writeParameter2[valueWriterUnsafe];
    for (let index = 0; index < count; index++) {
      const token = writer.beginLength();
      writer.isNull = false;
      if (writeUnsafe === void 0) {
        const written = writeParameter2(writer, parameters[index]);
        if (Result2.isFailure(written)) return Result2.fail(written.failure);
      } else {
        writeUnsafe(writer, parameters[index]);
      }
      if (writer.isNull) {
        writer.isNull = false;
        writer.offset = writer.start + token;
        writer.int32(-1);
      } else {
        writer.endLength(token);
      }
    }
    writer.reserve(4);
    const trailer = writer.bytes;
    const trailerOffset = writer.offset;
    trailer[trailerOffset] = 0;
    trailer[trailerOffset + 1] = 1;
    trailer[trailerOffset + 2] = 0;
    trailer[trailerOffset + 3] = 1;
    writer.offset = trailerOffset + 4;
    return Result2.succeed(end());
  } catch (error) {
    if (error instanceof EncodeError) return Result2.fail(error);
    throw error;
  }
};
var encodeExecute = (options) => {
  const writer = begin(69);
  writer.cString(options.portal);
  writer.int32(options.maxRows);
  return end();
};
var encodeDescribe = (options) => {
  const writer = begin(68);
  writer.uint8(targetByte(options.target));
  writer.cString(options.name);
  return end();
};
var encodeClose = (options) => {
  const writer = begin(67);
  writer.uint8(targetByte(options.target));
  writer.cString(options.name);
  return end();
};
var encodeSync = () => empty(83);
var encodeTerminate = () => empty(88);
var encodePasswordMessage = (options) => {
  const writer = begin(112);
  writer.cString(options.password);
  return end();
};
var encodeSASLInitialResponse = (options) => {
  const writer = begin(112);
  writer.cString(options.mechanism);
  if (options.initialResponse === null) {
    writer.int32(-1);
  } else {
    writer.int32(options.initialResponse.length);
    writer.raw(options.initialResponse);
  }
  return end();
};
var encodeSASLResponse = (options) => {
  const writer = begin(112);
  writer.raw(options.data);
  return end();
};
var PROTOCOL_VERSION_3_0 = 196608;
var SSL_REQUEST_CODE = 80877103;
var CANCEL_REQUEST_CODE = 80877102;
var encodeSslRequest = () => {
  sharedWriter.begin();
  sharedWriter.int32(8);
  sharedWriter.int32(SSL_REQUEST_CODE);
  return sharedWriter.finish();
};
var decodeSslResponse = (byte) => byte === 83 ? Result2.succeed("S") : byte === 78 ? Result2.succeed("N") : Result2.fail(new ParseError({
  message: `Invalid SSLRequest response byte: ${byte}`
}));
var encodeStartupMessage = (parameters) => {
  const writer = sharedWriter;
  writer.begin();
  writer.int32(0);
  writer.int32(PROTOCOL_VERSION_3_0);
  for (const [key, value3] of Object.entries(parameters)) {
    if (value3 === void 0) continue;
    writer.cString(key);
    writer.cString(value3);
  }
  if (parameters.client_encoding === void 0) {
    writer.cString("client_encoding");
    writer.cString("UTF8");
  }
  writer.uint8(0);
  writer.setInt32(writer.start, writer.offset - writer.start);
  return writer.finish();
};
var encodeCancelRequest = (options) => {
  const writer = sharedWriter;
  writer.begin();
  writer.int32(16);
  writer.int32(CANCEL_REQUEST_CODE);
  writer.int32(options.pid);
  writer.int32(options.secret);
  return writer.finish();
};
var BackendType = {
  NotificationResponse: 65,
  // A
  CommandComplete: 67,
  // C
  DataRow: 68,
  // D
  ErrorResponse: 69,
  // E
  CopyInResponse: 71,
  // G
  CopyOutResponse: 72,
  // H
  EmptyQueryResponse: 73,
  // I
  BackendKeyData: 75,
  // K
  NoticeResponse: 78,
  // N
  Authentication: 82,
  // R
  ParameterStatus: 83,
  // S
  RowDescription: 84,
  // T
  CopyBothResponse: 87,
  // W
  ReadyForQuery: 90,
  // Z
  CopyDone: 99,
  // c
  CopyData: 100,
  // d
  NoData: 110,
  // n
  PortalSuspended: 115,
  // s
  ParameterDescription: 116,
  // t
  NegotiateProtocolVersion: 118,
  // v
  ParseComplete: 49,
  // 1
  BindComplete: 50,
  // 2
  CloseComplete: 51
  // 3
};
var errorFieldNames = {
  S: "severity",
  V: "severityUnlocalized",
  C: "code",
  M: "message",
  D: "detail",
  H: "hint",
  P: "position",
  p: "internalPosition",
  q: "internalQuery",
  W: "where",
  s: "schema",
  t: "table",
  c: "column",
  d: "dataType",
  n: "constraint",
  F: "file",
  L: "line",
  R: "routine"
};
var decodeAuthentication = (reader) => {
  const method = reader.int32();
  switch (method) {
    case 0:
      return {
        _tag: "AuthenticationOk"
      };
    case 3:
      return {
        _tag: "AuthenticationCleartextPassword"
      };
    case 5:
      return {
        _tag: "AuthenticationMD5Password",
        salt: reader.raw(4)
      };
    case 10: {
      const mechanisms = [];
      for (; ; ) {
        const mechanism = reader.cString();
        if (mechanism === "") break;
        mechanisms.push(mechanism);
      }
      return {
        _tag: "AuthenticationSASL",
        mechanisms
      };
    }
    case 11:
      return {
        _tag: "AuthenticationSASLContinue",
        data: reader.rest()
      };
    case 12:
      return {
        _tag: "AuthenticationSASLFinal",
        data: reader.rest()
      };
    default:
      return {
        _tag: "AuthenticationUnsupported",
        method,
        payload: reader.rest()
      };
  }
};
var decodeErrorFields = (reader) => {
  const fields = {};
  for (; ; ) {
    const code = reader.uint8();
    if (code === 0) break;
    const key = String.fromCharCode(code);
    fields[errorFieldNames[key] ?? key] = reader.cString();
  }
  return fields;
};
var requireNonNegativeCount = (count, name2) => {
  if (count < 0) {
    throw new ParseError({
      message: `Invalid ${name2} count: ${count}`
    });
  }
  return count;
};
var decodeCopyResponse = (reader) => {
  const format3 = reader.uint8();
  const count = requireNonNegativeCount(reader.int16(), "COPY column");
  const columnFormats = new Array(count);
  for (let i = 0; i < count; i++) {
    columnFormats[i] = reader.int16();
  }
  return {
    format: format3,
    columnFormats
  };
};
var decodeDataRow = (bytes2, store, base, offset, limit, readField) => {
  if (offset + 2 > limit) {
    throw new ParseError({
      message: "Truncated message: expected 2 more byte(s)"
    });
  }
  const count = (bytes2[offset] << 8 | bytes2[offset + 1]) << 16 >> 16;
  if (count < 0) {
    throw new ParseError({
      message: `Invalid DataRow field count: ${count}`
    });
  }
  const values = new Array(count);
  let position = offset + 2;
  for (let i = 0; i < count; i++) {
    if (position + 4 > limit) {
      throw new ParseError({
        message: "Truncated message: expected 4 more byte(s)"
      });
    }
    const size = bytes2[position] << 24 | bytes2[position + 1] << 16 | bytes2[position + 2] << 8 | bytes2[position + 3];
    position += 4;
    if (size < 0) {
      if (size < -1) {
        throw new ParseError({
          message: `Invalid DataRow field length: ${size}`
        });
      }
      values[i] = readField === void 0 ? null : readField(bytes2, position, -1, i);
      continue;
    }
    const next = position + size;
    if (next > limit) {
      throw new ParseError({
        message: `Truncated message: expected ${size} more byte(s)`
      });
    }
    values[i] = readField === void 0 ? view(store, base + position, size) : readField(bytes2, position, size, i);
    position = next;
  }
  if (position !== limit) {
    throw new ParseError({
      message: `DataRow has ${limit - position} trailing byte(s)`
    });
  }
  return {
    _tag: "DataRow",
    values
  };
};
var decodeBackend = (type, reader) => {
  switch (type) {
    case BackendType.Authentication:
      return decodeAuthentication(reader);
    case BackendType.ParameterStatus:
      return {
        _tag: "ParameterStatus",
        name: reader.cString(),
        value: reader.cString()
      };
    case BackendType.BackendKeyData:
      return {
        _tag: "BackendKeyData",
        pid: reader.int32(),
        secret: reader.int32()
      };
    case BackendType.ReadyForQuery: {
      const status = String.fromCharCode(reader.uint8());
      if (status !== "I" && status !== "T" && status !== "E") {
        throw new ParseError({
          message: `Invalid ReadyForQuery status: ${status}`
        });
      }
      return {
        _tag: "ReadyForQuery",
        status
      };
    }
    case BackendType.RowDescription: {
      const count = requireNonNegativeCount(reader.int16(), "RowDescription field");
      const fields = new Array(count);
      for (let i = 0; i < count; i++) {
        fields[i] = {
          name: reader.cString(),
          tableOid: reader.uint32(),
          columnAttributeNumber: reader.int16(),
          dataTypeOid: reader.uint32(),
          dataTypeSize: reader.int16(),
          typeModifier: reader.int32(),
          format: reader.int16()
        };
      }
      return {
        _tag: "RowDescription",
        fields
      };
    }
    case BackendType.DataRow:
      return decodeDataRow(reader.bytes, reader.store, reader.base, reader.offset, reader.limit, void 0);
    case BackendType.CommandComplete:
      return {
        _tag: "CommandComplete",
        commandTag: reader.cString()
      };
    case BackendType.EmptyQueryResponse:
      return {
        _tag: "EmptyQueryResponse"
      };
    case BackendType.NoData:
      return {
        _tag: "NoData"
      };
    case BackendType.ParseComplete:
      return {
        _tag: "ParseComplete"
      };
    case BackendType.BindComplete:
      return {
        _tag: "BindComplete"
      };
    case BackendType.CloseComplete:
      return {
        _tag: "CloseComplete"
      };
    case BackendType.PortalSuspended:
      return {
        _tag: "PortalSuspended"
      };
    case BackendType.ParameterDescription: {
      const count = requireNonNegativeCount(reader.int16(), "ParameterDescription parameter");
      const parameterTypes = new Array(count);
      for (let i = 0; i < count; i++) {
        parameterTypes[i] = reader.uint32();
      }
      return {
        _tag: "ParameterDescription",
        parameterTypes
      };
    }
    case BackendType.ErrorResponse:
      return {
        _tag: "ErrorResponse",
        fields: decodeErrorFields(reader)
      };
    case BackendType.NoticeResponse:
      return {
        _tag: "NoticeResponse",
        fields: decodeErrorFields(reader)
      };
    case BackendType.NotificationResponse:
      return {
        _tag: "NotificationResponse",
        pid: reader.int32(),
        channel: reader.cString(),
        payload: reader.cString()
      };
    case BackendType.NegotiateProtocolVersion: {
      const minorVersion = reader.int32();
      const count = requireNonNegativeCount(reader.int32(), "NegotiateProtocolVersion option");
      const unrecognizedOptions = new Array(count);
      for (let i = 0; i < count; i++) {
        unrecognizedOptions[i] = reader.cString();
      }
      return {
        _tag: "NegotiateProtocolVersion",
        minorVersion,
        unrecognizedOptions
      };
    }
    case BackendType.CopyInResponse:
      return {
        _tag: "CopyInResponse",
        ...decodeCopyResponse(reader)
      };
    case BackendType.CopyOutResponse:
      return {
        _tag: "CopyOutResponse",
        ...decodeCopyResponse(reader)
      };
    case BackendType.CopyBothResponse:
      return {
        _tag: "CopyBothResponse",
        ...decodeCopyResponse(reader)
      };
    case BackendType.CopyData:
      return {
        _tag: "CopyData",
        data: reader.rest()
      };
    case BackendType.CopyDone:
      return {
        _tag: "CopyDone"
      };
    default:
      return {
        _tag: "Unknown",
        type,
        payload: reader.rest()
      };
  }
};

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgTypes.js
import * as Data3 from "effect/Data";
import * as IpInterface from "effect/net/IpInterface";
import * as IpNetwork from "effect/net/IpNetwork";
import * as NetAddress from "effect/net/NetAddress";
import * as Result3 from "effect/Result";
var CodecError = class extends (/* @__PURE__ */ Data3.TaggedError("PgTypesCodecError")) {
};
var fail9 = (message) => {
  throw new CodecError({
    message
  });
};
var result2 = (evaluate) => {
  try {
    return Result3.succeed(evaluate());
  } catch (error) {
    if (error instanceof CodecError) return Result3.fail(error);
    throw error;
  }
};
var textEncoder3 = /* @__PURE__ */ new TextEncoder();
var textDecoder3 = /* @__PURE__ */ new TextDecoder("utf-8", {
  fatal: true
});
var writeInt16 = (bytes2, offset, value3) => {
  bytes2[offset] = value3 >>> 8;
  bytes2[offset + 1] = value3;
};
var readInt16 = (bytes2, offset) => (bytes2[offset] << 8 | bytes2[offset + 1]) << 16 >> 16;
var readUint16 = (bytes2, offset) => bytes2[offset] << 8 | bytes2[offset + 1];
var writeInt32 = (bytes2, offset, value3) => {
  bytes2[offset] = value3 >>> 24;
  bytes2[offset + 1] = value3 >>> 16;
  bytes2[offset + 2] = value3 >>> 8;
  bytes2[offset + 3] = value3;
};
var readInt32 = (bytes2, offset) => bytes2[offset] << 24 | bytes2[offset + 1] << 16 | bytes2[offset + 2] << 8 | bytes2[offset + 3];
var writeInt64 = (bytes2, offset, value3) => {
  const high = Math.floor(value3 / 4294967296);
  writeInt32(bytes2, offset, high);
  writeInt32(bytes2, offset + 4, value3 - high * 4294967296);
};
var readUint32 = (bytes2, offset) => (bytes2[offset] << 24 | bytes2[offset + 1] << 16 | bytes2[offset + 2] << 8 | bytes2[offset + 3]) >>> 0;
var scratch4 = /* @__PURE__ */ new ArrayBuffer(4);
var scratchView4 = /* @__PURE__ */ new DataView(scratch4);
var scratchBytes4 = /* @__PURE__ */ new Uint8Array(scratch4);
var scratch8 = /* @__PURE__ */ new ArrayBuffer(8);
var scratchView8 = /* @__PURE__ */ new DataView(scratch8);
var scratchBytes8 = /* @__PURE__ */ new Uint8Array(scratch8);
var stage8 = (bytes2, offset) => {
  scratchView8.setInt32(0, readInt32(bytes2, offset));
  scratchView8.setInt32(4, readInt32(bytes2, offset + 4));
};
var twoDigits = /* @__PURE__ */ Array.from({
  length: 100
}, (_, value3) => (value3 < 10 ? "0" : "") + value3);
var asciiEncodeLimit2 = 48;
var scratchUtf8 = /* @__PURE__ */ new Uint8Array(4096);
var scratchUtf8Limit = 64 * 1024;
var encodeUtf8Scratch = (text3) => {
  const capacity = text3.length * 3;
  if (capacity > scratchUtf8Limit) return -1;
  if (capacity > scratchUtf8.length) scratchUtf8 = new Uint8Array(capacity);
  return textEncoder3.encodeInto(text3, scratchUtf8).written;
};
var encodeUtf8 = (text3) => {
  const length = text3.length;
  if (length <= asciiEncodeLimit2) {
    const bytes2 = new Uint8Array(length);
    let i = 0;
    for (; i < length; i++) {
      const code = text3.charCodeAt(i);
      if (code > 127) break;
      bytes2[i] = code;
    }
    if (i === length) return bytes2;
  }
  const written = encodeUtf8Scratch(text3);
  return written === -1 ? textEncoder3.encode(text3) : scratchUtf8.slice(0, written);
};
var encodeUtf8Prefixed = (text3, prefix) => {
  const length = text3.length;
  if (length <= asciiEncodeLimit2) {
    const bytes3 = new Uint8Array(prefix + length);
    let i = 0;
    for (; i < length; i++) {
      const code = text3.charCodeAt(i);
      if (code > 127) break;
      bytes3[prefix + i] = code;
    }
    if (i === length) return bytes3;
  }
  const written = encodeUtf8Scratch(text3);
  if (written === -1) {
    const body = textEncoder3.encode(text3);
    const bytes3 = new Uint8Array(prefix + body.length);
    bytes3.set(body, prefix);
    return bytes3;
  }
  const bytes2 = new Uint8Array(prefix + written);
  bytes2.set(scratchUtf8.subarray(0, written), prefix);
  return bytes2;
};
var region = (bytes2, offset, size) => offset === 0 && size === bytes2.length ? bytes2 : new Uint8Array(bytes2.buffer, bytes2.byteOffset + offset, size);
var asciiDecodeLimit2 = 10;
var utf8Slice2 = globalThis.Buffer?.prototype?.utf8Slice;
var decodeUtf83 = (bytes2, offset, size) => {
  if (size <= asciiDecodeLimit2) {
    let text3 = "";
    let index = 0;
    for (; index < size; index++) {
      const code = bytes2[offset + index];
      if (code > 127) break;
      text3 += String.fromCharCode(code);
    }
    if (index === size) return text3;
  }
  if (utf8Slice2 !== void 0) {
    const text3 = utf8Slice2.call(bytes2, offset, offset + size);
    if (text3.indexOf("\uFFFD") === -1) return text3;
  }
  try {
    return textDecoder3.decode(region(bytes2, offset, size));
  } catch {
    return fail9("Invalid UTF-8 in text value");
  }
};
var requireSize = (size, expected, name2) => {
  if (size !== expected) {
    fail9(`Expected ${expected} byte(s) for ${name2}, received ${size}`);
  }
};
var requireString = (value3, name2) => typeof value3 === "string" ? value3 : fail9(`Expected a string for ${name2}`);
var requireBigInt = (value3, name2) => typeof value3 === "bigint" ? value3 : fail9(`Expected a bigint for ${name2}`);
var requireNumber = (value3, name2) => typeof value3 === "number" ? value3 : fail9(`Expected a number for ${name2}`);
var requireInteger = (value3, name2, min, max) => {
  const num = requireNumber(value3, name2);
  if (!Number.isInteger(num) || num < min || num > max) {
    fail9(`Expected an integer in [${min}, ${max}] for ${name2}, received ${num}`);
  }
  return num;
};
var ZERO = /* @__PURE__ */ BigInt(0);
var THOUSAND = /* @__PURE__ */ BigInt(1e3);
var INT64_MIN = /* @__PURE__ */ BigInt("-9223372036854775808");
var INT64_MAX = /* @__PURE__ */ BigInt("9223372036854775807");
var INT32_MIN = -2147483648;
var INT32_MAX = 2147483647;
var PG_EPOCH_MS = 9466848e5;
var PG_EPOCH_MICROS = 9466848e8;
var PG_EPOCH_DAYS = 10957;
var MAX_EXACT = 9007199254740992;
var MAX_EXACT_HIGH = 2097152;
var MAX_TIME_MICROS_NUMBER = 864e8;
var TZDISP_LIMIT_SECONDS = 57600;
var OID = {
  bool: 16,
  bytea: 17,
  name: 19,
  int8: 20,
  int2: 21,
  int4: 23,
  text: 25,
  oid: 26,
  json: 114,
  cidr: 650,
  float4: 700,
  float8: 701,
  inet: 869,
  bpchar: 1042,
  varchar: 1043,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  timetz: 1266,
  numeric: 1700,
  regclass: 2205,
  uuid: 2950,
  jsonb: 3802,
  boolArray: 1e3,
  byteaArray: 1001,
  nameArray: 1003,
  int8Array: 1016,
  int2Array: 1005,
  int4Array: 1007,
  textArray: 1009,
  oidArray: 1028,
  jsonArray: 199,
  cidrArray: 651,
  float4Array: 1021,
  float8Array: 1022,
  inetArray: 1041,
  bpcharArray: 1014,
  varcharArray: 1015,
  dateArray: 1182,
  timeArray: 1183,
  timestampArray: 1115,
  timestamptzArray: 1185,
  timetzArray: 1270,
  numericArray: 1231,
  regclassArray: 2210,
  uuidArray: 2951,
  jsonbArray: 3807
};
var arrayToElement = /* @__PURE__ */ new Map([[OID.boolArray, OID.bool], [OID.byteaArray, OID.bytea], [OID.nameArray, OID.name], [OID.int8Array, OID.int8], [OID.int2Array, OID.int2], [OID.int4Array, OID.int4], [OID.textArray, OID.text], [OID.oidArray, OID.oid], [OID.jsonArray, OID.json], [OID.cidrArray, OID.cidr], [OID.float4Array, OID.float4], [OID.float8Array, OID.float8], [OID.inetArray, OID.inet], [OID.bpcharArray, OID.bpchar], [OID.varcharArray, OID.varchar], [OID.dateArray, OID.date], [OID.timeArray, OID.time], [OID.timestampArray, OID.timestamp], [OID.timestamptzArray, OID.timestamptz], [OID.timetzArray, OID.timetz], [OID.numericArray, OID.numeric], [OID.regclassArray, OID.regclass], [OID.uuidArray, OID.uuid], [OID.jsonbArray, OID.jsonb]]);
var elementToArray = /* @__PURE__ */ new Map(/* @__PURE__ */ Array.from(arrayToElement, ([array, element]) => [element, array]));
var arrayOidFor = (elementOid, registry) => registry === void 0 ? elementToArray.get(elementOid) : getRegistryState(registry).elementToArray.get(elementOid);
var pad = (value3, size) => String(value3).padStart(size, "0");
var civilFromDays = (days) => {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return {
    year: month <= 2 ? y + 1 : y,
    month,
    day
  };
};
var daysFromCivil = (year, month, day) => {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
};
var monthLengths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var isLeapYear = (year) => year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
var twoDigitsAt = (text3, at) => {
  const tens = text3.charCodeAt(at) - 48;
  const units = text3.charCodeAt(at + 1) - 48;
  return tens >= 0 && tens <= 9 && units >= 0 && units <= 9 ? tens * 10 + units : -1;
};
var parseDate = (text3) => {
  const yearStart = text3.charCodeAt(0) === 45 ? 1 : 0;
  const yearEnd = text3.length - 6;
  if (yearEnd - yearStart < 4 || text3.charCodeAt(yearEnd) !== 45 || text3.charCodeAt(yearEnd + 3) !== 45) {
    return fail9(`Expected a YYYY-MM-DD date, received "${text3}"`);
  }
  let year = 0;
  for (let index = yearStart; index < yearEnd; index++) {
    const digit = text3.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) {
      return fail9(`Expected a YYYY-MM-DD date, received "${text3}"`);
    }
    year = year * 10 + digit;
  }
  const month = twoDigitsAt(text3, yearEnd + 1);
  const day = twoDigitsAt(text3, yearEnd + 4);
  if (month === -1 || day === -1) {
    return fail9(`Expected a YYYY-MM-DD date, received "${text3}"`);
  }
  if (yearStart === 1) year = -year;
  if (!Number.isFinite(year)) {
    return fail9(`date out of range: "${text3}"`);
  }
  const monthLength = month === 2 && isLeapYear(year) ? 29 : monthLengths[month];
  if (month < 1 || month > 12 || day < 1 || day > monthLength) {
    return fail9(`Invalid date "${text3}"`);
  }
  return daysFromCivil(year, month, day);
};
var formatDate = (days) => {
  const {
    day,
    month,
    year
  } = civilFromDays(days);
  const yearText = year < 0 ? `-${pad(-year, 4)}` : year < 1e4 ? twoDigits[year / 100 | 0] + twoDigits[year % 100] : String(year);
  return `${yearText}-${twoDigits[month]}-${twoDigits[day]}`;
};
var timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;
var parseTimeOfDay = (text3) => {
  const match = timeRegex.exec(text3);
  if (match === null) {
    return fail9(`Expected a HH:MM[:SS[.ffffff]] time, received "${text3}"`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds3 = match[3] === void 0 ? 0 : Number(match[3]);
  const fraction = match[4] === void 0 ? 0 : Number(match[4].padEnd(6, "0"));
  const micros = (hours * 3600 + minutes * 60 + seconds3) * 1e6 + fraction;
  if (hours > 24 || minutes > 59 || seconds3 > 60 || micros > MAX_TIME_MICROS_NUMBER) {
    return fail9(`Invalid time "${text3}"`);
  }
  return micros;
};
var formatTimeOfDay = (micros) => {
  const seconds3 = micros / 1e6 | 0;
  const fraction = micros - seconds3 * 1e6;
  const base = `${twoDigits[seconds3 / 3600 | 0]}:${twoDigits[(seconds3 / 60 | 0) % 60]}:${twoDigits[seconds3 % 60]}`;
  if (fraction === 0) return base;
  return `${base}.${pad(fraction, 6).replace(/0+$/, "")}`;
};
var zoneRegex = /^(?:Z|([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)$/;
var parseZone = (text3) => {
  const match = zoneRegex.exec(text3);
  if (match === null) {
    return fail9(`Expected a time zone offset, received "${text3}"`);
  }
  if (match[1] === void 0) return 0;
  const minutes = match[3] === void 0 ? 0 : Number(match[3]);
  const trailingSeconds = match[4] === void 0 ? 0 : Number(match[4]);
  const seconds3 = Number(match[2]) * 3600 + minutes * 60 + trailingSeconds;
  if (minutes > 59 || trailingSeconds > 59 || seconds3 >= TZDISP_LIMIT_SECONDS) {
    return fail9(`Time zone offset out of range, received "${text3}"`);
  }
  return match[1] === "-" ? -seconds3 : seconds3;
};
var formatZone = (secondsEast) => {
  const sign = secondsEast < 0 ? "-" : "+";
  const total = Math.abs(secondsEast);
  return `${sign}${pad(total / 3600 | 0, 2)}:${twoDigits[(total / 60 | 0) % 60]}`;
};
var NUMERIC_POS = 0;
var NUMERIC_NEG = 16384;
var NUMERIC_NAN = 49152;
var NUMERIC_PINF = 53248;
var NUMERIC_NINF = 61440;
var numericRegex = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
var encodeNumeric = (value3) => {
  const text3 = requireString(value3, "numeric");
  if (text3 === "NaN") return numericSpecial(NUMERIC_NAN);
  if (text3 === "Infinity") return numericSpecial(NUMERIC_PINF);
  if (text3 === "-Infinity") return numericSpecial(NUMERIC_NINF);
  const match = numericRegex.exec(text3);
  if (match === null || (match[2] ?? "") + (match[3] ?? "") === "") {
    return fail9(`Expected a decimal numeric string, received "${text3}"`);
  }
  const exponent = match[4] === void 0 ? 0 : Number(match[4]);
  let digits = (match[2] ?? "") + (match[3] ?? "");
  let scale = (match[3] ?? "").length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  if (scale > 16383) {
    return fail9(`numeric scale ${scale} exceeds the PostgreSQL maximum`);
  }
  const rightPad = (4 - scale % 4) % 4;
  digits += "0".repeat(rightPad);
  const fractionLength = scale + rightPad;
  const leftPad = (4 - (digits.length - fractionLength) % 4) % 4;
  digits = "0".repeat(leftPad) + digits;
  const groupAt = (index) => {
    const at = index * 4;
    return (digits.charCodeAt(at) - 48) * 1e3 + (digits.charCodeAt(at + 1) - 48) * 100 + (digits.charCodeAt(at + 2) - 48) * 10 + (digits.charCodeAt(at + 3) - 48);
  };
  const groupCount = digits.length / 4;
  let first = 0;
  while (first < groupCount && groupAt(first) === 0) first++;
  let last = groupCount;
  while (last > first && groupAt(last - 1) === 0) last--;
  const count = last - first;
  const weight = count === 0 ? 0 : (digits.length - fractionLength) / 4 - 1 - first;
  const sign = count > 0 && match[1] === "-" ? NUMERIC_NEG : NUMERIC_POS;
  const bytes2 = new Uint8Array(8 + count * 2);
  writeInt16(bytes2, 0, count);
  writeInt16(bytes2, 2, weight);
  writeInt16(bytes2, 4, sign);
  writeInt16(bytes2, 6, scale);
  for (let i = 0; i < count; i++) {
    writeInt16(bytes2, 8 + i * 2, groupAt(first + i));
  }
  return bytes2;
};
var numericSpecial = (sign) => {
  const bytes2 = new Uint8Array(8);
  writeInt16(bytes2, 4, sign);
  return bytes2;
};
var decodeNumeric = (bytes2, offset, size) => {
  if (size < 8) return fail9("Truncated numeric value");
  const count = readInt16(bytes2, offset);
  const weight = readInt16(bytes2, offset + 2);
  const sign = readUint16(bytes2, offset + 4);
  const scale = readInt16(bytes2, offset + 6);
  if (sign === NUMERIC_NAN) return "NaN";
  if (sign === NUMERIC_PINF) return "Infinity";
  if (sign === NUMERIC_NINF) return "-Infinity";
  if (sign !== NUMERIC_POS && sign !== NUMERIC_NEG) {
    return fail9(`Invalid numeric sign: ${sign}`);
  }
  requireSize(size, 8 + count * 2, "numeric");
  const digits = offset + 8;
  const digitAt = (index) => {
    if (index < 0 || index >= count) return 0;
    const digit = readInt16(bytes2, digits + index * 2);
    return digit >= 0 && digit <= 9999 ? digit : fail9(`Invalid numeric digit: ${digit}`);
  };
  let result3 = sign === NUMERIC_NEG ? "-" : "";
  if (weight < 0) {
    result3 += "0";
  } else {
    for (let i = 0; i <= weight; i++) {
      const digit = digitAt(i);
      if (i === 0) {
        result3 += String(digit);
      } else {
        result3 += twoDigits[digit / 100 | 0];
        result3 += twoDigits[digit % 100];
      }
    }
  }
  if (scale > 0) {
    let fraction = "";
    for (let i = weight + 1; fraction.length < scale; i++) {
      const digit = digitAt(i);
      fraction += twoDigits[digit / 100 | 0];
      fraction += twoDigits[digit % 100];
    }
    result3 += `.${fraction.slice(0, scale)}`;
  }
  return result3;
};
var PGSQL_AF_INET = 2;
var PGSQL_AF_INET6 = 3;
var encodeInet = (value3, isCidr) => {
  const type = isCidr ? "cidr" : "inet";
  const text3 = requireString(value3, type);
  const parsed = IpInterface.fromString(text3);
  if (Result3.isFailure(parsed)) return fail9(`Invalid ${type} value ${JSON.stringify(text3)}: ${parsed.failure.message}`);
  const address = parsed.success.address;
  const bits = parsed.success.prefixLength;
  if (isCidr) {
    const network = IpNetwork.make(address, bits);
    if (Result3.isFailure(network)) {
      return fail9(`Invalid ${type} value ${JSON.stringify(text3)}: ${network.failure.message}`);
    }
  }
  const octets = NetAddress.isIpv4Address(address) ? NetAddress.ipv4ToOctets(address) : NetAddress.ipv6ToOctets(address);
  const result3 = new Uint8Array(4 + octets.length);
  result3[0] = NetAddress.isIpv4Address(address) ? PGSQL_AF_INET : PGSQL_AF_INET6;
  result3[1] = bits;
  result3[2] = isCidr ? 1 : 0;
  result3[3] = octets.length;
  result3.set(octets, 4);
  return result3;
};
var decodeInet = (bytes2, offset, size) => {
  if (size < 4) return fail9("Truncated inet value");
  const family = bytes2[offset];
  const bits = bytes2[offset + 1];
  const cidrFlag = bytes2[offset + 2];
  if (cidrFlag > 1) return fail9(`Invalid inet CIDR flag: ${cidrFlag}`);
  const isCidr = cidrFlag === 1;
  const addressSize = bytes2[offset + 3];
  const expected = family === PGSQL_AF_INET ? 4 : family === PGSQL_AF_INET6 ? 16 : -1;
  if (expected === -1 || addressSize !== expected) {
    return fail9(`Invalid inet address family ${family} with ${addressSize} byte(s)`);
  }
  requireSize(size, 4 + addressSize, "inet");
  if (bits > addressSize * 8) return fail9(`Invalid inet netmask length: ${bits}`);
  const addressBytes = bytes2.slice(offset + 4, offset + 4 + addressSize);
  const address = family === PGSQL_AF_INET ? NetAddress.ipv4FromBytesUnsafe(addressBytes) : NetAddress.ipv6FromBytesUnsafe(addressBytes);
  if (isCidr) {
    const network = IpNetwork.make(address, bits);
    if (Result3.isFailure(network)) return fail9(network.failure.message);
    return IpNetwork.format(network.success);
  }
  return bits === addressSize * 8 ? NetAddress.formatIp(address) : IpInterface.format(IpInterface.makeUnsafe(address, bits));
};
var hexDigits = "0123456789abcdef";
var hexValues = /* @__PURE__ */ new Int8Array(128).fill(-1);
for (let i = 0; i < 16; i++) {
  hexValues[/* @__PURE__ */ hexDigits.charCodeAt(i)] = i;
  hexValues[/* @__PURE__ */ "0123456789ABCDEF".charCodeAt(i)] = i;
}
var hexHigh = /* @__PURE__ */ (() => {
  const codes2 = /* @__PURE__ */ new Uint8Array(256);
  for (let i = 0; i < 256; i++) codes2[i] = /* @__PURE__ */ hexDigits.charCodeAt(i >> 4);
  return codes2;
})();
var hexLow = /* @__PURE__ */ (() => {
  const codes2 = /* @__PURE__ */ new Uint8Array(256);
  for (let i = 0; i < 256; i++) codes2[i] = /* @__PURE__ */ hexDigits.charCodeAt(i & 15);
  return codes2;
})();
var uuidOffsets = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34];
var hexAt = (text3, at) => {
  const code = text3.charCodeAt(at);
  return code < 128 ? hexValues[code] : -1;
};
var uuidWord = /* @__PURE__ */ new Int32Array(4);
var uuidWords = (value3) => {
  const text3 = requireString(value3, "uuid");
  if (text3.length !== 36 || text3.charCodeAt(8) !== 45 || text3.charCodeAt(13) !== 45 || text3.charCodeAt(18) !== 45 || text3.charCodeAt(23) !== 45) {
    return fail9(`Expected a UUID, received "${text3}"`);
  }
  for (let word = 0; word < 4; word++) {
    let bits = 0;
    let valid = 0;
    for (let i = word * 4; i < word * 4 + 4; i++) {
      const at = uuidOffsets[i];
      const high = hexAt(text3, at);
      const low = hexAt(text3, at + 1);
      valid |= high | low;
      bits = bits << 8 | high << 4 | low;
    }
    if (valid < 0) {
      return fail9(`Expected a UUID, received "${text3}"`);
    }
    uuidWord[word] = bits;
  }
};
var encodeUuid = (value3) => {
  uuidWords(value3);
  const bytes2 = new Uint8Array(16);
  writeInt32(bytes2, 0, uuidWord[0]);
  writeInt32(bytes2, 4, uuidWord[1]);
  writeInt32(bytes2, 8, uuidWord[2]);
  writeInt32(bytes2, 12, uuidWord[3]);
  return bytes2;
};
var writeUuid = (sink, value3) => {
  uuidWords(value3);
  sink.int32(uuidWord[0]);
  sink.int32(uuidWord[1]);
  sink.int32(uuidWord[2]);
  sink.int32(uuidWord[3]);
};
var decodeUuid = (bytes2, offset, size) => {
  requireSize(size, 16, "uuid");
  const b0 = bytes2[offset];
  const b1 = bytes2[offset + 1];
  const b2 = bytes2[offset + 2];
  const b3 = bytes2[offset + 3];
  const b4 = bytes2[offset + 4];
  const b5 = bytes2[offset + 5];
  const b6 = bytes2[offset + 6];
  const b7 = bytes2[offset + 7];
  const b8 = bytes2[offset + 8];
  const b9 = bytes2[offset + 9];
  const b10 = bytes2[offset + 10];
  const b11 = bytes2[offset + 11];
  const b12 = bytes2[offset + 12];
  const b13 = bytes2[offset + 13];
  const b14 = bytes2[offset + 14];
  const b15 = bytes2[offset + 15];
  return String.fromCharCode(hexHigh[b0], hexLow[b0], hexHigh[b1], hexLow[b1], hexHigh[b2], hexLow[b2], hexHigh[b3], hexLow[b3], 45, hexHigh[b4], hexLow[b4], hexHigh[b5], hexLow[b5], 45, hexHigh[b6], hexLow[b6], hexHigh[b7], hexLow[b7], 45, hexHigh[b8], hexLow[b8], hexHigh[b9], hexLow[b9], 45, hexHigh[b10], hexLow[b10], hexHigh[b11], hexLow[b11], hexHigh[b12], hexLow[b12], hexHigh[b13], hexLow[b13], hexHigh[b14], hexLow[b14], hexHigh[b15], hexLow[b15]);
};
var codecOf = (read, encode2, write) => {
  const decode8 = (bytes2) => read(bytes2, 0, bytes2.length);
  return write === void 0 ? {
    encode: encode2,
    decode: decode8,
    read
  } : {
    encode: encode2,
    decode: decode8,
    read,
    write
  };
};
var takeScratch4 = () => {
  const bytes2 = new Uint8Array(4);
  bytes2[0] = scratchBytes4[0];
  bytes2[1] = scratchBytes4[1];
  bytes2[2] = scratchBytes4[2];
  bytes2[3] = scratchBytes4[3];
  return bytes2;
};
var takeScratch8 = () => {
  const bytes2 = new Uint8Array(8);
  bytes2[0] = scratchBytes8[0];
  bytes2[1] = scratchBytes8[1];
  bytes2[2] = scratchBytes8[2];
  bytes2[3] = scratchBytes8[3];
  bytes2[4] = scratchBytes8[4];
  bytes2[5] = scratchBytes8[5];
  bytes2[6] = scratchBytes8[6];
  bytes2[7] = scratchBytes8[7];
  return bytes2;
};
var utf8Codec = /* @__PURE__ */ codecOf(decodeUtf83, (value3) => encodeUtf8(requireString(value3, "text")), (sink, value3) => sink.utf8(requireString(value3, "text")));
var int8Value = (value3) => {
  const big = requireBigInt(value3, "int8");
  if (big < INT64_MIN || big > INT64_MAX) fail9(`int8 out of range: ${big}`);
  return big;
};
var MAX_TIME_MICROS = /* @__PURE__ */ BigInt(MAX_TIME_MICROS_NUMBER);
var timeValue = (value3) => {
  const micros = requireBigInt(value3, "time");
  if (micros < ZERO || micros > MAX_TIME_MICROS) fail9(`time out of range: ${micros}`);
  return micros;
};
var readTimeMicros = (bytes2, offset) => {
  const high = readInt32(bytes2, offset);
  const micros = high * 4294967296 + readUint32(bytes2, offset + 4);
  if (high < 0 || micros > MAX_TIME_MICROS_NUMBER) {
    return fail9(`timetz out of range: ${micros}`);
  }
  return micros;
};
var timestampHigh = 0;
var timestampLow = 0;
var timestampInt64 = (value3) => {
  let ms;
  if (value3 instanceof Date) {
    ms = value3.getTime();
    if (Number.isNaN(ms)) fail9("timestamp cannot be an invalid Date");
  } else {
    ms = typeof value3 === "number" ? value3 : fail9("Expected a Date or number for timestamp");
    if (Number.isNaN(ms)) fail9("timestamp cannot be NaN");
  }
  if (ms === Number.POSITIVE_INFINITY) {
    timestampHigh = INT32_MAX;
    timestampLow = -1;
  } else if (ms === Number.NEGATIVE_INFINITY) {
    timestampHigh = INT32_MIN;
    timestampLow = 0;
  } else {
    const unixMicros = Math.trunc(ms * 1e3);
    if (!Number.isFinite(unixMicros)) {
      fail9(`timestamp out of range: ${ms}`);
    }
    const micros = unixMicros - PG_EPOCH_MICROS;
    if (micros > -MAX_EXACT && micros < MAX_EXACT) {
      timestampHigh = Math.floor(micros / 4294967296);
      timestampLow = micros - timestampHigh * 4294967296;
    } else {
      const exact = BigInt(unixMicros) - BigInt(PG_EPOCH_MICROS);
      if (exact < INT64_MIN || exact > INT64_MAX) {
        fail9(`timestamp out of range: ${ms}`);
      }
      scratchView8.setBigInt64(0, exact);
      timestampHigh = scratchView8.getInt32(0);
      timestampLow = scratchView8.getInt32(4);
    }
  }
};
var timestampCodec = /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 8, "timestamp");
  const high = readInt32(bytes2, offset);
  if (high >= -MAX_EXACT_HIGH && high < MAX_EXACT_HIGH) {
    const micros2 = high * 4294967296 + readUint32(bytes2, offset + 4);
    return new Date((micros2 - micros2 % 1e3) / 1e3 + PG_EPOCH_MS);
  }
  stage8(bytes2, offset);
  const micros = scratchView8.getBigInt64(0);
  if (micros === INT64_MAX || micros === INT64_MIN) return new Date(Number.NaN);
  return new Date(Number(micros / THOUSAND) + PG_EPOCH_MS);
}, (value3) => {
  timestampInt64(value3);
  const bytes2 = new Uint8Array(8);
  writeInt32(bytes2, 0, timestampHigh);
  writeInt32(bytes2, 4, timestampLow);
  return bytes2;
}, (sink, value3) => {
  timestampInt64(value3);
  sink.int32(timestampHigh);
  sink.int32(timestampLow);
});
var dateDays = (value3) => {
  const text3 = requireString(value3, "date");
  if (text3 === "infinity") return INT32_MAX;
  if (text3 === "-infinity") return INT32_MIN;
  const days = parseDate(text3) - PG_EPOCH_DAYS;
  if (days <= INT32_MIN || days >= INT32_MAX) {
    return fail9(`date out of range: "${text3}"`);
  }
  return days;
};
var dateCodec = /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 4, "date");
  const days = readInt32(bytes2, offset);
  if (days === INT32_MAX) return "infinity";
  if (days === INT32_MIN) return "-infinity";
  return formatDate(days + PG_EPOCH_DAYS);
}, (value3) => {
  const bytes2 = new Uint8Array(4);
  writeInt32(bytes2, 0, dateDays(value3));
  return bytes2;
}, (sink, value3) => sink.int32(dateDays(value3)));
var timetzCodec = /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 12, "timetz");
  const zone = readInt32(bytes2, offset + 8);
  if (zone <= -TZDISP_LIMIT_SECONDS || zone >= TZDISP_LIMIT_SECONDS) {
    return fail9(`timetz time zone displacement out of range: ${zone}`);
  }
  return formatTimeOfDay(readTimeMicros(bytes2, offset)) + formatZone(-zone);
}, (value3) => {
  const text3 = requireString(value3, "timetz");
  const split = Math.max(text3.lastIndexOf("+"), text3.lastIndexOf("-"), text3.lastIndexOf("Z"));
  if (split <= 0) {
    return fail9(`Expected a timetz with a zone offset, received "${text3}"`);
  }
  const bytes2 = new Uint8Array(12);
  writeInt64(bytes2, 0, parseTimeOfDay(text3.slice(0, split)));
  writeInt32(bytes2, 8, -parseZone(text3.slice(split)));
  return bytes2;
});
var jsonCodec = /* @__PURE__ */ codecOf((bytes2, offset, size) => JSON.parse(decodeUtf83(bytes2, offset, size)), (value3) => {
  const text3 = JSON.stringify(value3);
  if (text3 === void 0) return fail9("Value cannot be serialised as JSON");
  return encodeUtf8(text3);
}, (sink, value3) => {
  const text3 = JSON.stringify(value3);
  if (text3 === void 0) return fail9("Value cannot be serialised as JSON");
  sink.utf8(text3);
});
var jsonbCodec = /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  if (size === 0 || bytes2[offset] !== 1) {
    return fail9("Unsupported jsonb version byte");
  }
  return JSON.parse(decodeUtf83(bytes2, offset + 1, size - 1));
}, (value3) => {
  const text3 = JSON.stringify(value3);
  if (text3 === void 0) return fail9("Value cannot be serialised as JSON");
  const bytes2 = encodeUtf8Prefixed(text3, 1);
  bytes2[0] = 1;
  return bytes2;
}, (sink, value3) => {
  const text3 = JSON.stringify(value3);
  if (text3 === void 0) return fail9("Value cannot be serialised as JSON");
  sink.uint8(1);
  sink.utf8(text3);
});
var oidCodec = /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 4, "oid");
  return readUint32(bytes2, offset);
}, (value3) => {
  const num = requireInteger(value3, "oid", 0, 4294967295);
  const bytes2 = new Uint8Array(4);
  bytes2[0] = num >>> 24;
  bytes2[1] = num >>> 16;
  bytes2[2] = num >>> 8;
  bytes2[3] = num;
  return bytes2;
}, (sink, value3) => sink.int32(requireInteger(value3, "oid", 0, 4294967295)));
var builtinScalars = /* @__PURE__ */ new Map([[OID.bool, /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 1, "bool");
  return bytes2[offset] !== 0;
}, (value3) => {
  if (typeof value3 !== "boolean") fail9("Expected a boolean for bool");
  const bytes2 = new Uint8Array(1);
  bytes2[0] = value3 ? 1 : 0;
  return bytes2;
}, (sink, value3) => {
  if (typeof value3 !== "boolean") fail9("Expected a boolean for bool");
  sink.uint8(value3 ? 1 : 0);
})], [OID.bytea, /* @__PURE__ */ codecOf(region, (value3) => value3 instanceof Uint8Array ? value3.slice() : fail9("Expected a Uint8Array for bytea"), (sink, value3) => value3 instanceof Uint8Array ? sink.raw(value3) : fail9("Expected a Uint8Array for bytea"))], [OID.int2, /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 2, "int2");
  return (bytes2[offset] << 8 | bytes2[offset + 1]) << 16 >> 16;
}, (value3) => {
  const num = requireInteger(value3, "int2", -32768, 32767);
  const bytes2 = new Uint8Array(2);
  bytes2[0] = num >>> 8;
  bytes2[1] = num;
  return bytes2;
}, (sink, value3) => sink.int16(requireInteger(value3, "int2", -32768, 32767)))], [OID.int4, /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 4, "int4");
  return readInt32(bytes2, offset);
}, (value3) => {
  const num = requireInteger(value3, "int4", INT32_MIN, INT32_MAX);
  const bytes2 = new Uint8Array(4);
  bytes2[0] = num >>> 24;
  bytes2[1] = num >>> 16;
  bytes2[2] = num >>> 8;
  bytes2[3] = num;
  return bytes2;
}, (sink, value3) => sink.int32(requireInteger(value3, "int4", INT32_MIN, INT32_MAX)))], [OID.oid, oidCodec], [OID.regclass, oidCodec], [OID.int8, /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 8, "int8");
  stage8(bytes2, offset);
  return scratchView8.getBigInt64(0);
}, (value3) => {
  scratchView8.setBigInt64(0, int8Value(value3));
  return takeScratch8();
}, (sink, value3) => sink.bigInt64(int8Value(value3)))], [OID.float4, /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 4, "float4");
  scratchView4.setInt32(0, readInt32(bytes2, offset));
  return scratchView4.getFloat32(0);
}, (value3) => {
  scratchView4.setFloat32(0, requireNumber(value3, "float4"));
  return takeScratch4();
}, (sink, value3) => sink.float32(requireNumber(value3, "float4")))], [OID.float8, /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 8, "float8");
  stage8(bytes2, offset);
  return scratchView8.getFloat64(0);
}, (value3) => {
  scratchView8.setFloat64(0, requireNumber(value3, "float8"));
  return takeScratch8();
}, (sink, value3) => sink.float64(requireNumber(value3, "float8")))], [OID.time, /* @__PURE__ */ codecOf((bytes2, offset, size) => {
  requireSize(size, 8, "time");
  stage8(bytes2, offset);
  return scratchView8.getBigInt64(0);
}, (value3) => {
  scratchView8.setBigInt64(0, timeValue(value3));
  return takeScratch8();
}, (sink, value3) => sink.bigInt64(timeValue(value3)))], [OID.numeric, /* @__PURE__ */ codecOf(decodeNumeric, encodeNumeric)], [OID.text, utf8Codec], [OID.varchar, utf8Codec], [OID.bpchar, utf8Codec], [OID.name, utf8Codec], [OID.json, jsonCodec], [OID.jsonb, jsonbCodec], [OID.uuid, /* @__PURE__ */ codecOf(decodeUuid, encodeUuid, writeUuid)], [OID.inet, /* @__PURE__ */ codecOf(decodeInet, (value3) => encodeInet(value3, false))], [OID.cidr, /* @__PURE__ */ codecOf(decodeInet, (value3) => encodeInet(value3, true))], [OID.date, dateCodec], [OID.timetz, timetzCodec], [OID.timestamp, timestampCodec], [OID.timestamptz, timestampCodec]]);
var makeArrayCodec = (elementOid, lookup3) => codecOf((bytes2, offset, size) => decodeArray(bytes2, offset, size, elementOid, lookup3), (value3) => encodeArray(value3, elementOid, lookup3), (sink, value3) => writeArray(sink, value3, elementOid, lookup3));
var builtins = /* @__PURE__ */ new Map(builtinScalars);
var codecs = /* @__PURE__ */ new Map(builtins);
var tableSize = 4096;
var table = /* @__PURE__ */ new Array(tableSize);
var lookup = (oid2) => oid2 >= 0 && oid2 < tableSize ? table[oid2] : codecs.get(oid2);
for (const [arrayOid, elementOid] of arrayToElement) {
  const codec2 = /* @__PURE__ */ makeArrayCodec(elementOid, lookup);
  builtins.set(arrayOid, codec2);
  codecs.set(arrayOid, codec2);
}
for (const [oid2, codec2] of codecs) table[oid2] = codec2;
var registryStates = /* @__PURE__ */ new WeakMap();
var getRegistryState = (registry) => {
  const state = registryStates.get(registry);
  if (state === void 0) return fail9("Invalid PgTypes Registry");
  return state;
};
var lookupFor = (registry) => registry === void 0 ? lookup : getRegistryState(registry).lookup;
var encodeArray = (value3, elementOid, lookup3) => {
  if (!Array.isArray(value3)) {
    return fail9("Expected an array");
  }
  const codec2 = lookup3(elementOid);
  if (codec2 === void 0) return fail9(`No codec registered for OID ${elementOid}`);
  const count = value3.length;
  const elements = new Array(count);
  let hasNull = false;
  let payloadSize = 0;
  for (let i = 0; i < count; i++) {
    const element = value3[i];
    if (element === null) {
      elements[i] = null;
      hasNull = true;
      payloadSize += 4;
    } else {
      const encoded = codec2.encode(element);
      elements[i] = encoded;
      payloadSize += 4 + encoded.length;
    }
  }
  const dimensions = count === 0 ? 0 : 1;
  const bytes2 = new Uint8Array(12 + dimensions * 8 + payloadSize);
  writeInt32(bytes2, 0, dimensions);
  writeInt32(bytes2, 4, hasNull ? 1 : 0);
  writeInt32(bytes2, 8, elementOid);
  let offset = 12;
  if (dimensions === 1) {
    writeInt32(bytes2, offset, count);
    writeInt32(bytes2, offset + 4, 1);
    offset += 8;
  }
  for (let i = 0; i < count; i++) {
    const element = elements[i];
    if (element === null) {
      writeInt32(bytes2, offset, -1);
      offset += 4;
    } else {
      writeInt32(bytes2, offset, element.length);
      bytes2.set(element, offset + 4);
      offset += 4 + element.length;
    }
  }
  return bytes2;
};
var writeArray = (sink, value3, elementOid, lookup3) => {
  if (!Array.isArray(value3)) {
    return fail9("Expected an array");
  }
  const count = value3.length;
  let hasNull = false;
  for (let i = 0; i < count; i++) {
    if (value3[i] === null) {
      hasNull = true;
      break;
    }
  }
  const dimensions = count === 0 ? 0 : 1;
  sink.int32(dimensions);
  sink.int32(hasNull ? 1 : 0);
  sink.int32(elementOid);
  if (dimensions === 1) {
    sink.int32(count);
    sink.int32(1);
  }
  const write = lookup3(elementOid)?.write;
  for (let i = 0; i < count; i++) {
    const element = value3[i];
    if (element === null) {
      sink.int32(-1);
    } else {
      const token = sink.beginLength();
      if (write === void 0) writeValue(sink, element, elementOid, lookup3);
      else write(sink, element);
      sink.endLength(token);
    }
  }
};
var decodeArray = (bytes2, start, size, elementOid, lookup3) => {
  if (size < 12) return fail9("Truncated array value");
  const dimensions = readInt32(bytes2, start);
  const wireElementOid = readUint32(bytes2, start + 8);
  if (wireElementOid !== elementOid) {
    return fail9(`Array element OID ${wireElementOid} does not match expected OID ${elementOid}`);
  }
  if (dimensions === 0) {
    if (size !== 12) return fail9("Zero-dimensional array has trailing bytes");
    return [];
  }
  if (dimensions !== 1) {
    return fail9(`Only 1-dimensional arrays are supported, received ${dimensions} dimensions`);
  }
  if (size < 20) return fail9("Truncated array value");
  const length = readInt32(bytes2, start + 12);
  if (length < 0) return fail9(`Invalid array length: ${length}`);
  const lowerBound = readInt32(bytes2, start + 16);
  if (lowerBound !== 1) return fail9(`Only arrays with a lower bound of 1 are supported, received ${lowerBound}`);
  const codec2 = lookup3(elementOid);
  const read = codec2?.read;
  const values = new Array(length);
  const limit = start + size;
  let offset = start + 20;
  for (let i = 0; i < length; i++) {
    if (offset + 4 > limit) return fail9("Truncated array element");
    const elementSize = readInt32(bytes2, offset);
    offset += 4;
    if (elementSize < -1) return fail9(`Invalid array element length: ${elementSize}`);
    if (elementSize === -1) {
      values[i] = null;
    } else {
      if (offset + elementSize > limit) return fail9("Truncated array element");
      values[i] = read !== void 0 ? read(bytes2, offset, elementSize) : codec2 === void 0 ? region(bytes2, offset, elementSize) : codec2.decode(region(bytes2, offset, elementSize));
      offset += elementSize;
    }
  }
  if (offset !== limit) return fail9("Array value has trailing bytes");
  return values;
};
var makeFieldReader = (columns, registry) => result2(() => {
  const lookup3 = lookupFor(registry);
  const codecs2 = columns.map((column, index) => {
    if (column.format !== 1) {
      return fail9(`Only the binary format is supported, column ${index} has format ${column.format}`);
    }
    return lookup3(column.dataTypeOid);
  });
  return (bytes2, offset, size, column) => {
    if (size < 0) return null;
    const codec2 = codecs2[column];
    if (codec2 === void 0) return decodeUtf83(bytes2, offset, size);
    const read = codec2.read;
    return read === void 0 ? codec2.decode(bytes2.subarray(offset, offset + size)) : read(bytes2, offset, size);
  };
});
var ParameterTypeId = "~@effect/sql-pg/PgTypes/Parameter";
var isParameter = (value3) => typeof value3 === "object" && value3 !== null && value3[ParameterTypeId] === ParameterTypeId;
var writeValue = (sink, value3, oid2, lookup3) => {
  const codec2 = lookup3(oid2);
  if (codec2 === void 0) return fail9(`No codec registered for OID ${oid2}`);
  if (codec2.write === void 0) sink.raw(codec2.encode(value3));
  else codec2.write(sink, value3);
};
var isTextFormat = (parameter2) => parameter2.oid === 0;
var writeParameterUnsafe = (sink, parameter2, lookup3) => parameter2.value === null ? sink.sqlNull() : parameter2.oid === 0 ? sink.utf8(String(parameter2.value)) : writeValue(sink, parameter2.value, parameter2.oid, lookup3);
var writeParameter = (sink, parameter2, registry) => {
  try {
    writeParameterUnsafe(sink, parameter2, lookupFor(registry));
    return Result3.void;
  } catch (error) {
    if (error instanceof CodecError) return Result3.fail(error);
    throw error;
  }
};
var valueWriterUnsafe2 = /* @__PURE__ */ Symbol.for("@effect/sql-pg/PgProtocol/ValueWriter/unsafe");
Object.defineProperty(writeParameter, valueWriterUnsafe2, {
  value: (sink, parameter2) => writeParameterUnsafe(sink, parameter2, lookup)
});
var makeParameter = (oid2, value3) => ({
  [ParameterTypeId]: ParameterTypeId,
  oid: oid2,
  value: value3
});
var parameter = (oid2) => (value3) => makeParameter(oid2, value3);
var bool = /* @__PURE__ */ parameter(OID.bool);
var int2 = /* @__PURE__ */ parameter(OID.int2);
var int4 = /* @__PURE__ */ parameter(OID.int4);
var int8 = /* @__PURE__ */ parameter(OID.int8);
var oid = /* @__PURE__ */ parameter(OID.oid);
var float4 = /* @__PURE__ */ parameter(OID.float4);
var float8 = /* @__PURE__ */ parameter(OID.float8);
var numeric = /* @__PURE__ */ parameter(OID.numeric);
var text = /* @__PURE__ */ parameter(OID.text);
var varchar = /* @__PURE__ */ parameter(OID.varchar);
var bpchar = /* @__PURE__ */ parameter(OID.bpchar);
var name = /* @__PURE__ */ parameter(OID.name);
var bytea = /* @__PURE__ */ parameter(OID.bytea);
var json = /* @__PURE__ */ parameter(OID.json);
var jsonb = /* @__PURE__ */ parameter(OID.jsonb);
var uuid = /* @__PURE__ */ parameter(OID.uuid);
var inet = /* @__PURE__ */ parameter(OID.inet);
var cidr = /* @__PURE__ */ parameter(OID.cidr);
var date = /* @__PURE__ */ parameter(OID.date);
var time = /* @__PURE__ */ parameter(OID.time);
var timetz = /* @__PURE__ */ parameter(OID.timetz);
var timestamp = /* @__PURE__ */ parameter(OID.timestamp);
var timestamptz = /* @__PURE__ */ parameter(OID.timestamptz);

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgConnection.js
var TypeId = "~@effect/sql-pg/PgConnection";
var preparedCacheFor = (config) => {
  if (config.prepare === false) return void 0;
  const max = config.preparedStatementCacheSize ?? defaultPreparedStatements;
  return max > 0 ? new PreparedCache(max) : void 0;
};
var make12 = (options) => Effect20.flatMap(resolveConfig(options), (config) => Effect20.acquireRelease(Effect20.gen(function* () {
  const password = yield* resolve(config.password);
  const session = yield* connect3(config, password);
  return new PgConnectionImpl(options, config, session, options.types);
}), (connection) => Effect20.sync(() => connection.closeUnsafe()), {
  interruptible: true
}).pipe(Effect20.timeoutOrElse({
  duration: config.connectTimeout,
  orElse: () => Effect20.fail(new SqlError2({
    reason: new ConnectionError2({
      cause: new Error("Connection timed out"),
      message: "PgConnection: Connection timed out",
      operation: "connect"
    })
  }))
})));
var abortDrainTimeoutMillis = 5e3;
var abortDrainGraceMillis = 10;
var queryCanceledCode = "57014";
var cancelRequestTimeoutMillis = 5e3;
var maxPipelineDepth = 128;
var streamPauseThreshold = 512;
var PgConnectionImpl = class {
  [TypeId] = TypeId;
  config;
  processId;
  session;
  /** The custom codec registry, or `undefined` for the builtin catalogue. */
  registry;
  bindEncoder;
  /** The statements this session has named, or `undefined` when disabled. */
  prepared;
  resolved;
  multiplex;
  /** Serializes statements: one in-flight extended-query cycle. */
  wire = /* @__PURE__ */ Semaphore.makeUnsafe(1);
  /** Exclusive-ownership queue used by `pin` and unpinned statements. */
  owner = /* @__PURE__ */ Semaphore.makeUnsafe(1);
  pinned = false;
  consumer;
  deadWith;
  closed = false;
  cancelPending = false;
  channels = /* @__PURE__ */ new Map();
  retireHooks = /* @__PURE__ */ new Set();
  /** Queued but not yet written; drained into `pipelineInFlight` on flush. */
  pipelinePending = [];
  /** Written and awaiting their `ReadyForQuery`, oldest first. */
  pipelineInFlight = [];
  pipelineHead = 0;
  pipelineFlushScheduled = false;
  pipelineIdleWaiters = /* @__PURE__ */ new Set();
  pinnedView;
  [internalsKey];
  constructor(config, resolved, session, registry) {
    this.config = config;
    this.resolved = resolved;
    this.session = session;
    this.processId = session.processId;
    this.registry = registry;
    this.bindEncoder = makeBindEncoder2(registry);
    this.prepared = preparedCacheFor(config);
    this.multiplex = config.multiplex ?? false;
    this[internalsKey] = {
      base: this,
      deadError: () => this.deadWith,
      retireHooks: this.retireHooks
    };
    this.pinnedView = new PinnedPgConnection(this);
    session.socket.on("data", this.onData);
    session.socket.on("error", this.onSocketError);
    session.socket.on("close", this.onSocketClose);
  }
  onData = (chunk) => {
    try {
      this.session.parser.pushEach(chunk, this.dispatch);
    } catch (cause) {
      return this.fatal(cause instanceof ParseError ? connectionQueryError(cause, "PgConnection: Failed to parse server messages") : queryError(cause, "PgConnection: Failed to decode row"));
    }
    if (this.deadWith === void 0) this.consumer?.onBatchEnd?.();
  };
  onSocketError = (cause) => this.fatal(connectionQueryError(cause, "PgConnection: Socket error"));
  onSocketClose = () => this.fatal(connectionQueryError(new Error("Connection closed"), "PgConnection: Connection closed"));
  dispatch = (message) => {
    if (this.deadWith !== void 0) return;
    switch (message._tag) {
      case "ErrorResponse":
        if (message.fields.code === queryCanceledCode) this.cancelPending = false;
        break;
      case "ReadyForQuery":
        if (this.cancelPending) {
          this.cancelPending = false;
          this.retire();
        }
        break;
      case "NotificationResponse": {
        const queues = this.channels.get(message.channel);
        if (queues !== void 0) {
          const notification = {
            processId: message.pid,
            channel: message.channel,
            payload: message.payload
          };
          for (const queue of queues) Queue.offerUnsafe(queue, notification);
        }
        return;
      }
      case "ParameterStatus":
      case "NoticeResponse":
        return;
    }
    if (this.consumer !== void 0) return this.consumer.onMessage(message);
    if (message._tag === "ErrorResponse") {
      return this.fatal(new SqlError2({
        reason: classifyFields(message.fields, "PgConnection: The server reported an error", "query")
      }));
    }
    this.fatal(connectionQueryError(new Error(`Unexpected ${message._tag} while idle`), `PgConnection: Unexpected ${message._tag} while idle`));
  };
  /** Marks the session dead: optionally destroys the socket, fails the active statement
   * and every listen queue, and notifies pool hooks unless the session's own
   * scope is being released. */
  fatal(error, destroySocket = true) {
    if (this.deadWith !== void 0) return;
    this.deadWith = error;
    if (destroySocket) this.session.socket.destroy();
    const consumer = this.consumer;
    this.consumer = void 0;
    this.retire();
    consumer?.onFatal(error);
    const sets = Array.from(this.channels.values());
    this.channels.clear();
    const cause = this.closed ? Cause5.interrupt() : Cause5.fail(error);
    for (const set of sets) {
      for (const queue of set) Queue.failCauseUnsafe(queue, cause);
    }
  }
  retire() {
    if (this.closed) return;
    for (const hook of this.retireHooks) hook();
  }
  closeUnsafe() {
    this.closed = true;
    let destroySocket = true;
    if (this.deadWith === void 0 && this.session.socket.writable) {
      try {
        this.session.socket.end(encodeTerminate());
        destroySocket = false;
      } catch {
      }
    }
    this.fatal(new SqlError2({
      reason: new ConnectionError2({
        cause: new Error("Connection is closed"),
        message: "PgConnection: Connection is closed",
        operation: "query"
      })
    }), destroySocket);
  }
  /** Plans one execution. `cache` is `undefined` to force the unnamed path. */
  encodeQuery = (sql, params, cache) => encodeQuery(sql, params, this.registry, this.bindEncoder, cache);
  /**
   * Routes backend messages to the oldest statement still on the wire.
   *
   * Every cycle carries its own `Sync`, so the backend answers them in order
   * and finishes each with a `ReadyForQuery`. That boundary is what advances
   * the queue, and it is also why a statement the backend rejects only skips
   * the rest of its own cycle: the ones queued behind it still run.
   */
  pipelineConsumer = {
    onMessage: (message) => {
      const entry = this.pipelineInFlight[this.pipelineHead];
      if (entry === void 0) {
        return this.fatal(connectionQueryError(new Error(`Unexpected ${message._tag} without an in-flight query`), `PgConnection: Unexpected ${message._tag} without an in-flight query`));
      }
      entry.machine.onMessage(message);
    },
    onBatchEnd: () => this.flushPipeline(),
    onFatal: (error) => {
      const entries = [...this.pipelineInFlight.slice(this.pipelineHead), ...this.pipelinePending];
      this.pipelineInFlight.length = 0;
      this.pipelineHead = 0;
      this.pipelinePending.length = 0;
      this.pipelineFlushScheduled = false;
      for (const entry of entries) {
        if (!entry.abandoned) Deferred.doneUnsafe(entry.deferred, Effect20.fail(error));
      }
      this.notifyPipelineIdle();
    }
  };
  pipelineDepth = () => this.pipelineInFlight.length - this.pipelineHead;
  pipelineIsIdle = () => this.pipelineDepth() === 0 && this.pipelinePending.length === 0;
  notifyPipelineIdle = () => {
    if (!this.pipelineIsIdle()) return;
    this.consumer = void 0;
    this.session.parser.readField = void 0;
    const waiters = Array.from(this.pipelineIdleWaiters);
    this.pipelineIdleWaiters.clear();
    for (const waiter of waiters) waiter();
  };
  /** Resolves once nothing is on the wire, so `pin` can take the connection. */
  waitPipelineIdle = /* @__PURE__ */ Effect20.callback((resume) => {
    if (this.pipelineIsIdle()) return resume(Effect20.void);
    const waiter = () => resume(Effect20.void);
    this.pipelineIdleWaiters.add(waiter);
    return Effect20.sync(() => this.pipelineIdleWaiters.delete(waiter));
  });
  finishPipelineEntry = (entry, result3) => {
    if (this.pipelineInFlight[this.pipelineHead] !== entry) {
      return this.fatal(connectionQueryError(new Error("A pipelined query completed out of order"), "PgConnection: A pipelined query completed out of order"));
    }
    this.pipelineHead++;
    this.session.parser.readField = this.pipelineInFlight[this.pipelineHead]?.machine.readField;
    if (!entry.abandoned) Deferred.doneUnsafe(entry.deferred, result3);
    if (this.pipelineHead === this.pipelineInFlight.length) {
      this.pipelineInFlight.length = 0;
      this.pipelineHead = 0;
    }
  };
  /** Writes everything queued since the last flush as one batch. */
  flushPipeline = () => {
    this.pipelineFlushScheduled = false;
    if (this.deadWith !== void 0) return;
    let capacity = maxPipelineDepth - this.pipelineDepth();
    if (capacity <= 0) return;
    const wasEmpty = this.pipelineDepth() === 0;
    const batch = [];
    let index = 0;
    while (capacity > 0 && index < this.pipelinePending.length) {
      const entry = this.pipelinePending[index++];
      if (entry.abandoned) {
        if (entry.plan.parses && entry.plan.prepared !== void 0) {
          entry.plan.prepared.parsing = false;
        }
        continue;
      }
      batch.push(entry);
      this.pipelineInFlight.push(entry);
      capacity--;
    }
    this.pipelinePending.splice(0, index);
    if (batch.length === 0) {
      this.notifyPipelineIdle();
      return;
    }
    if (wasEmpty) this.session.parser.readField = batch[0].machine.readField;
    const frame = batch.length === 1 ? batch[0].plan.frame : concat(batch.map((entry) => entry.plan.frame));
    try {
      this.session.socket.write(frame);
    } catch (cause) {
      this.fatal(connectionQueryError(cause, "PgConnection: Failed to write query batch"));
    }
  };
  schedulePipelineFlush = () => {
    if (this.pipelineFlushScheduled || this.pipelineDepth() >= maxPipelineDepth) return;
    this.pipelineFlushScheduled = true;
    queueMicrotask(this.flushPipeline);
  };
  /**
   * One cycle on a multiplexed connection. The `owner` permit is only taken to
   * queue the statement, so a pin still orders against submissions without
   * serializing them.
   */
  pipelineCycle = (sql, params, wantRows, cache) => Effect20.flatMap(this.owner.withPermit(Effect20.suspend(() => {
    if (this.deadWith !== void 0) return Effect20.fail(this.deadWith);
    let plan2;
    try {
      plan2 = this.encodeQuery(sql, params, cache);
    } catch (cause) {
      return Effect20.fail(queryError(cause, "PgConnection: Failed to encode query"));
    }
    const deferred = Deferred.makeUnsafe();
    let entry;
    const machine = new QueryMachine(this, plan2, wantRows, (result3) => this.finishPipelineEntry(entry, result3));
    entry = {
      plan: plan2,
      deferred,
      machine,
      abandoned: false
    };
    this.pipelinePending.push(entry);
    this.consumer = this.pipelineConsumer;
    this.schedulePipelineFlush();
    return Effect20.succeed(entry);
  })), (entry) => {
    const awaited = Deferred.await(entry.deferred).pipe(Effect20.onInterrupt(() => Effect20.sync(() => {
      entry.abandoned = true;
    })));
    if (cache === void 0 || entry.plan.parses) return awaited;
    return retryStale(entry.plan, cache, awaited, () => this.pipelineCycle(sql, params, wantRows, void 0));
  });
  /**
   * One extended-query cycle for a caller that shares the session with others:
   * the fibers inside a transaction, and a stream running beside them. The
   * wire permit is what serializes them.
   */
  cycle = (sql, params, wantRows, cache) => this.wire.withPermit(this.cycleOwned(sql, params, wantRows, cache));
  /**
   * Runs one cycle for a caller that owns the session. No wire permit is needed
   * because competing pinned work and streams must acquire `owner` first.
   */
  cycleOwned = (sql, params, wantRows, cache) => Effect20.suspend(() => this.attempt(sql, params, wantRows, cache));
  /**
   * Runs one cycle. A reused statement the backend has since dropped, or whose
   * plan no longer matches its columns, is parsed again on a second attempt;
   * that attempt skips the cache, so it cannot loop.
   */
  attempt = (sql, params, wantRows, cache) => {
    if (this.deadWith !== void 0) return Effect20.fail(this.deadWith);
    let plan2;
    try {
      plan2 = this.encodeQuery(sql, params, cache);
    } catch (cause) {
      return Effect20.fail(queryError(cause, "PgConnection: Failed to encode query"));
    }
    const run3 = runQuery(this, plan2, wantRows);
    if (cache === void 0 || plan2.parses) return run3;
    return retryStale(plan2, cache, run3, () => this.attempt(sql, params, wantRows, void 0));
  };
  /** Sends a `CancelRequest` for this session on a side connection. */
  cancel = /* @__PURE__ */ Effect20.suspend(() => {
    if (this.deadWith !== void 0) return Effect20.void;
    this.cancelPending = true;
    if (this.consumer === void 0) this.retire();
    return sendCancelRequest(this.resolved, this.session);
  });
  pin = /* @__PURE__ */ Effect20.suspend(() => {
    const reserve2 = this[internalsKey].reserve;
    return reserve2 === void 0 ? this.pinExclusive : Effect20.andThen(reserve2, this.pinExclusive);
  });
  pinExclusive = /* @__PURE__ */ Effect20.acquireRelease(/* @__PURE__ */ Effect20.flatMap(/* @__PURE__ */ this.owner.take(1), () => (
    // Holding `owner` stops new submissions; a pipeline already on the wire
    // still has to drain before this fiber owns the connection.
    Effect20.as(Effect20.tap(Effect20.onInterrupt(this.waitPipelineIdle, () => this.owner.release(1)), () => Effect20.sync(() => {
      this.pinned = true;
    })), this.pinnedView)
  )), () => Effect20.suspend(() => {
    this.pinned = false;
    return this.owner.release(1);
  }));
  run = (sql, params, wantRows, prepare) => {
    const cache = prepare ? this.prepared : void 0;
    return this.multiplex ? this.pipelineCycle(sql, params, wantRows, cache) : this.owner.withPermit(this.cycleOwned(sql, params, wantRows, cache));
  };
  query = (sql, params, prepare = true) => Effect20.map(this.run(sql, params ?? emptyParams, true, prepare), takeResult);
  queryValues = (sql, params, prepare = true) => Effect20.map(this.run(sql, params ?? emptyParams, false, prepare), takeValues);
  stream = (sql, params) => streamRows(this, this.pin, sql, params ?? emptyParams);
  listen = (channel) => listenChannel(this, this.pin, channel);
  interrupt = /* @__PURE__ */ Effect20.suspend(() => this.multiplex && !this.pinned ? Effect20.void : this.cancel);
};
var PinnedPgConnection = class {
  [TypeId] = TypeId;
  base;
  [internalsKey];
  pin;
  interrupt;
  constructor(base) {
    this.base = base;
    this[internalsKey] = base[internalsKey];
    this.pin = Effect20.succeed(this);
    this.interrupt = base.cancel;
  }
  get config() {
    return this.base.config;
  }
  get processId() {
    return this.base.processId;
  }
  query = (sql, params, prepare = true) => Effect20.map(this.base.cycle(sql, params ?? emptyParams, true, prepare ? this.base.prepared : void 0), takeResult);
  queryValues = (sql, params, prepare = true) => Effect20.map(this.base.cycle(sql, params ?? emptyParams, false, prepare ? this.base.prepared : void 0), takeValues);
  stream = (sql, params) => streamRows(this.base, this.pin, sql, params ?? emptyParams);
  listen = (channel) => listenChannel(this.base, this.pin, channel);
};
var INT32_MIN2 = -2147483648;
var INT32_MAX2 = 2147483647;
var inferredParameter = (oid2, value3) => ({
  [ParameterTypeId]: ParameterTypeId,
  oid: oid2,
  value: value3
});
var inferScalar = (value3) => {
  if (isParameter(value3)) return value3;
  if (value3 === null || value3 === void 0) return inferredParameter(0, null);
  switch (typeof value3) {
    case "boolean":
      return inferredParameter(OID.bool, value3);
    case "bigint":
      return inferredParameter(OID.int8, value3);
    case "number":
      if (Number.isInteger(value3)) {
        if (value3 >= INT32_MIN2 && value3 <= INT32_MAX2) {
          return inferredParameter(OID.int4, value3);
        }
        if (Number.isSafeInteger(value3)) {
          return inferredParameter(OID.int8, BigInt(value3));
        }
      }
      return inferredParameter(OID.float8, value3);
    case "string":
      return inferredParameter(0, value3);
  }
  if (value3 instanceof Date) return inferredParameter(OID.timestamptz, value3);
  if (value3 instanceof Uint8Array) return inferredParameter(OID.bytea, value3);
  if (value3 instanceof Int8Array) {
    return inferredParameter(OID.bytea, new Uint8Array(value3.buffer, value3.byteOffset, value3.byteLength));
  }
  throw new CodecError({
    message: `Cannot infer a PostgreSQL type for ${String(value3)}`
  });
};
var inferParameter = (value3, registry) => {
  if (!Array.isArray(value3)) return inferScalar(value3);
  if (value3.length === 0) {
    throw new CodecError({
      message: "Cannot infer the type of an empty array; use PgTypes.array"
    });
  }
  let elementOid;
  const values = new Array(value3.length);
  for (let index = 0; index < value3.length; index++) {
    const element = value3[index];
    if (Array.isArray(element)) {
      throw new CodecError({
        message: "Nested array parameters are not supported"
      });
    }
    const parameter2 = inferScalar(element);
    let oid2 = parameter2.oid;
    if (oid2 === 0) {
      if (parameter2.value === null) {
        values[index] = null;
        continue;
      }
      oid2 = OID.text;
    }
    if (Array.isArray(parameter2.value)) {
      throw new CodecError({
        message: "Nested array parameters are not supported"
      });
    }
    if (elementOid === void 0) elementOid = oid2;
    else if (elementOid !== oid2) {
      throw new CodecError({
        message: "Array parameter elements must have the same inferred OID"
      });
    }
    values[index] = parameter2.value;
  }
  if (elementOid === void 0) {
    throw new CodecError({
      message: "Cannot infer the type of an array containing only null values"
    });
  }
  const arrayOid = arrayOidFor(elementOid, registry);
  if (arrayOid === void 0) {
    throw new CodecError({
      message: `No array type known for element OID ${elementOid}`
    });
  }
  return inferredParameter(arrayOid, values);
};
var concat = (chunks) => {
  let length = 0;
  for (let index = 0; index < chunks.length; index++) length += chunks[index].length;
  const output = Buffer.allocUnsafe(length);
  let offset = 0;
  for (let index = 0; index < chunks.length; index++) {
    output.set(chunks[index], offset);
    offset += chunks[index].length;
  }
  return output;
};
var emptyParams = [];
var takeResult = (output) => output.result;
var takeValues = (output) => output.values;
var describeExecuteSync = /* @__PURE__ */ concat([/* @__PURE__ */ encodeDescribe({
  target: "portal",
  name: ""
}), /* @__PURE__ */ encodeExecute({
  portal: "",
  maxRows: 0
}), /* @__PURE__ */ encodeSync()]);
var executeSync = /* @__PURE__ */ concat([/* @__PURE__ */ encodeExecute({
  portal: "",
  maxRows: 0
}), /* @__PURE__ */ encodeSync()]);
var defaultPreparedStatements = 100;
var encodeUnnamed = (sql, parameters, parameterTypes, encodeBind) => {
  const parse = encodeParse({
    name: "",
    query: sql,
    parameterTypes
  });
  if (EffectResult.isFailure(parse)) throw parse.failure;
  const bind = encodeBind({
    portal: "",
    statement: "",
    parameters
  });
  if (EffectResult.isFailure(bind)) throw bind.failure;
  return {
    frame: concat([parse.success, bind.success, describeExecuteSync]),
    closes: 0,
    parses: true,
    describes: true,
    prepared: void 0,
    description: void 0,
    stale: false
  };
};
var encodeQuery = (sql, params, registry, encodeBind, cache) => {
  const count = params.length;
  const parameters = new Array(count);
  const parameterTypes = new Array(count);
  for (let index = 0; index < count; index++) {
    const parameter2 = inferParameter(params[index], registry);
    parameters[index] = parameter2;
    parameterTypes[index] = parameter2.oid;
  }
  if (cache === void 0) {
    return encodeUnnamed(sql, parameters, parameterTypes, encodeBind);
  }
  const prepared = cache.get(sql, parameterTypes);
  if (!prepared.ready && prepared.parsing) {
    return encodeUnnamed(sql, parameters, parameterTypes, encodeBind);
  }
  const bind = encodeBind({
    portal: "",
    statement: prepared.name,
    parameters
  });
  if (EffectResult.isFailure(bind)) throw bind.failure;
  const parse = prepared.ready ? void 0 : encodeParse({
    name: prepared.name,
    query: sql,
    parameterTypes
  });
  if (parse !== void 0 && EffectResult.isFailure(parse)) throw parse.failure;
  const closeFrames = cache.takeCloses();
  if (parse === void 0) {
    return {
      frame: closeFrames === void 0 ? concat([bind.success, executeSync]) : concat([closeFrames.frames, bind.success, executeSync]),
      closes: closeFrames?.count ?? 0,
      parses: false,
      describes: false,
      prepared,
      description: prepared.description,
      stale: false
    };
  }
  prepared.parsing = true;
  return {
    frame: closeFrames === void 0 ? concat([parse.success, bind.success, describeExecuteSync]) : concat([closeFrames.frames, parse.success, bind.success, describeExecuteSync]),
    closes: closeFrames?.count ?? 0,
    parses: true,
    describes: true,
    prepared,
    description: void 0,
    stale: false
  };
};
var PreparedCache = class {
  max;
  statements = /* @__PURE__ */ new Map();
  namespace = /* @__PURE__ */ randomBytes(8).toString("hex");
  closes;
  counter = 0;
  constructor(max) {
    this.max = max;
  }
  get(sql, parameterTypes) {
    const key = parameterTypes.length === 0 ? sql : `${sql}\0${parameterTypes.join(",")}`;
    const found = this.statements.get(key);
    if (found !== void 0) {
      this.statements.delete(key);
      this.statements.set(key, found);
      this.trim(found);
      return found;
    }
    const prepared = {
      name: `effect_${this.namespace}_${++this.counter}`,
      key,
      ready: false,
      parsing: false,
      description: void 0
    };
    this.statements.set(key, prepared);
    this.trim(prepared);
    return prepared;
  }
  /**
   * A statement still being parsed cannot be closed yet: its `Parse` may not
   * have reached the socket. Let the cache exceed its bound temporarily, then
   * discard abandoned entries and close excess ready statements on access.
   */
  trim(protectedStatement) {
    while (this.statements.size > this.max) {
      let evicted;
      for (const prepared of this.statements.values()) {
        if (prepared !== protectedStatement && (prepared.ready || !prepared.parsing)) {
          evicted = prepared;
          break;
        }
      }
      if (evicted === void 0) return;
      this.statements.delete(evicted.key);
      if (evicted.ready) this.close(evicted.name);
    }
  }
  /**
   * Drops a statement the backend no longer holds, or whose plan went stale.
   *
   * The name is closed either way. A plan that went stale is still held under
   * it, and re-parsing would collide; a name the backend has already lost
   * ignores the `Close`, which Postgres treats as a success.
   */
  evict(prepared) {
    if (prepared.parsing) return;
    if (this.statements.delete(prepared.key) && prepared.ready) this.close(prepared.name);
  }
  /**
   * Drops a statement whose parsing cycle failed before its columns arrived.
   *
   * A `Parse` that completed before the error outlives the failed cycle, so
   * the backend may hold the name while the entry can never become ready. The
   * name is closed either way: closing one the backend never registered is a
   * no-op.
   */
  evictFailed(prepared) {
    this.statements.delete(prepared.key);
    this.close(prepared.name);
  }
  close(name2) {
    ;
    (this.closes ??= []).push(encodeClose({
      target: "statement",
      name: name2
    }));
  }
  takeCloses() {
    const closes = this.closes;
    if (closes === void 0) return void 0;
    this.closes = void 0;
    return {
      frames: closes.length === 1 ? closes[0] : concat(closes),
      count: closes.length
    };
  }
};
var isStalePreparedStatement = (code) => code === "26000" || code === "0A000";
var defaultBindEncoder = /* @__PURE__ */ makeBindEncoder(writeParameter, isTextFormat);
var makeBindEncoder2 = (registry) => registry === void 0 ? defaultBindEncoder : makeBindEncoder((sink, parameter2) => writeParameter(sink, parameter2, registry), isTextFormat);
var queryError = (cause, message) => new SqlError2({
  reason: new UnknownError2({
    cause,
    message,
    operation: "query"
  })
});
var retryStale = (plan2, cache, run3, rerun) => Effect20.catchCause(run3, (cause) => {
  if (!plan2.stale) return Effect20.failCause(cause);
  cache.evict(plan2.prepared);
  return rerun();
});
var connectionQueryError = (cause, message) => new SqlError2({
  reason: new ConnectionError2({
    cause,
    message,
    operation: "query"
  })
});
var escapeIdentifier = (identifier2) => `"${identifier2.replaceAll('"', '""')}"`;
var parseCommandTag = (tag) => {
  const firstSpace = tag.indexOf(" ");
  if (firstSpace < 0) return {
    command: tag,
    oid: null,
    rowCount: 0
  };
  const command = tag.slice(0, firstSpace);
  const secondSpace = tag.indexOf(" ", firstSpace + 1);
  if (command === "INSERT" && secondSpace > 0) {
    return {
      command,
      oid: Number(tag.slice(firstSpace + 1, secondSpace)),
      rowCount: Number(tag.slice(secondSpace + 1))
    };
  }
  const last = tag.slice((secondSpace < 0 ? firstSpace : secondSpace) + 1);
  return {
    command,
    oid: null,
    rowCount: isDigits(last) ? Number(last) : 0
  };
};
var isDigits = (value3) => {
  if (value3.length === 0) return false;
  for (let index = 0; index < value3.length; index++) {
    const code = value3.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
};
var QueryMachine = class {
  conn;
  plan;
  finish;
  /** Installed on the parser while this machine is at the head of the queue. */
  readField;
  /** Object rows, or `undefined` when the caller asked for positional ones. */
  rows;
  values;
  closes;
  phase;
  fieldCount;
  resultFields;
  rowBuilder;
  command = "";
  rowCount = 0;
  oid = null;
  failure;
  done = false;
  aborted = false;
  drainDone;
  constructor(conn, plan2, wantRows, finish) {
    this.conn = conn;
    this.plan = plan2;
    this.finish = finish;
    this.rows = wantRows ? [] : void 0;
    this.values = wantRows ? void 0 : [];
    this.closes = plan2.closes;
    this.phase = plan2.closes > 0 ? "close" : plan2.parses ? "parse" : "bind";
    const description = plan2.description;
    this.readField = description?.readField;
    this.fieldCount = description?.resultFields.length ?? 0;
    this.resultFields = description?.resultFields ?? emptyFields;
    this.rowBuilder = description?.rowBuilder;
  }
  isDone() {
    return this.done;
  }
  abort(onDrained) {
    if (this.done) return onDrained();
    this.aborted = true;
    this.drainDone = onDrained;
  }
  complete(effect) {
    if (this.done) return;
    this.done = true;
    const prepared = this.plan.prepared;
    if (prepared !== void 0) prepared.parsing = false;
    this.finish(effect);
  }
  failDesync(message) {
    this.conn.fatal(connectionQueryError(new Error(message), `PgConnection: ${message}`));
  }
  onFatal(error) {
    if (this.done) return;
    this.done = true;
    const prepared = this.plan.prepared;
    if (prepared !== void 0) prepared.parsing = false;
    if (this.aborted) this.drainDone?.();
    else this.finish(Effect20.fail(error));
  }
  onMessage(message) {
    if (this.aborted) {
      if (message._tag === "ReadyForQuery") {
        this.done = true;
        this.drainDone?.();
      }
      return;
    }
    if (this.phase === "error") {
      if (message._tag === "ReadyForQuery") return this.complete(Effect20.fail(this.failure));
      return this.failDesync(`Unexpected ${message._tag} after ErrorResponse`);
    }
    switch (message._tag) {
      case "CloseComplete":
        if (this.phase !== "close") return this.failDesync(`Unexpected CloseComplete during ${this.phase}`);
        if (--this.closes === 0) this.phase = this.plan.parses ? "parse" : "bind";
        return;
      case "ParseComplete":
        if (this.phase !== "parse") return this.failDesync(`Unexpected ParseComplete during ${this.phase}`);
        this.phase = "bind";
        return;
      case "BindComplete":
        if (this.phase !== "bind") return this.failDesync(`Unexpected BindComplete during ${this.phase}`);
        this.phase = this.plan.describes ? "describe" : "rows";
        return;
      case "RowDescription": {
        if (this.phase !== "describe") return this.failDesync(`Unexpected RowDescription during ${this.phase}`);
        const description = describe(message.fields, this.conn.registry);
        if (EffectResult.isFailure(description)) {
          return this.conn.fatal(queryError(description.failure, "PgConnection: Failed to decode row"));
        }
        this.fieldCount = message.fields.length;
        this.resultFields = description.success.resultFields;
        this.rowBuilder = description.success.rowBuilder;
        this.conn.session.parser.readField = description.success.readField;
        const prepared = this.plan.prepared;
        if (prepared !== void 0) {
          prepared.description = description.success;
          prepared.ready = true;
        }
        this.phase = "rows";
        return;
      }
      case "NoData": {
        if (this.phase !== "describe") return this.failDesync(`Unexpected NoData during ${this.phase}`);
        const prepared = this.plan.prepared;
        if (prepared !== void 0) {
          prepared.description = void 0;
          prepared.ready = true;
        }
        this.phase = "rows";
        return;
      }
      case "DataRow": {
        if (this.phase !== "rows" || this.rowBuilder === void 0) {
          return this.failDesync(`Unexpected DataRow during ${this.phase}`);
        }
        const rowValues = message.values;
        if (rowValues.length !== this.fieldCount) {
          return this.failDesync(`DataRow has ${rowValues.length} values for ${this.fieldCount} fields`);
        }
        if (this.rows !== void 0) this.rows.push(this.rowBuilder(rowValues));
        else this.values.push(rowValues);
        return;
      }
      case "CommandComplete": {
        if (this.phase !== "rows") return this.failDesync(`Unexpected CommandComplete during ${this.phase}`);
        const parsed = parseCommandTag(message.commandTag);
        this.command = parsed.command;
        this.rowCount = parsed.rowCount;
        this.oid = parsed.oid;
        this.phase = "complete";
        return;
      }
      case "EmptyQueryResponse":
        if (this.phase !== "rows") return this.failDesync(`Unexpected EmptyQueryResponse during ${this.phase}`);
        this.phase = "complete";
        return;
      case "ErrorResponse": {
        if (isStalePreparedStatement(message.fields.code)) this.plan.stale = true;
        const prepared = this.plan.prepared;
        if (this.plan.parses && prepared !== void 0 && !prepared.ready) {
          this.conn.prepared?.evictFailed(prepared);
        }
        this.failure = new SqlError2({
          reason: classifyFields(message.fields, "PgConnection: Query failed", "query")
        });
        this.phase = "error";
        return;
      }
      case "ReadyForQuery":
        if (this.phase !== "complete") return this.failDesync(`Unexpected ReadyForQuery during ${this.phase}`);
        return this.complete(Effect20.succeed({
          result: {
            command: this.command,
            rowCount: this.rowCount,
            oid: this.oid,
            rows: this.rows ?? emptyRows,
            fields: this.resultFields
          },
          values: this.values ?? emptyValues
        }));
      case "CopyInResponse":
      case "CopyOutResponse":
      case "CopyBothResponse":
      case "CopyData":
      case "CopyDone":
        return this.failDesync(`Unexpected ${message._tag}; COPY is not supported`);
      default:
        return this.failDesync(`Unexpected ${message._tag} during ${this.phase}`);
    }
  }
};
var emptyRows = [];
var emptyValues = [];
var drainAborted = (conn, timeoutMessage, abort) => {
  const drained = Deferred.makeUnsafe();
  const timeout = setTimeout(() => conn.fatal(connectionQueryError(new Error(timeoutMessage), `PgConnection: ${timeoutMessage}`)), abortDrainTimeoutMillis);
  abort(() => {
    clearTimeout(timeout);
    Deferred.doneUnsafe(drained, Effect20.void);
  });
  const grace = Effect20.callback((resume) => {
    const timer = setTimeout(() => resume(Effect20.void), abortDrainGraceMillis);
    return Effect20.sync(() => clearTimeout(timer));
  });
  const cancelAndDrain = Effect20.andThen(conn.cancel, Deferred.await(drained));
  return Effect20.andThen(Effect20.raceFirst(Deferred.await(drained), grace), Effect20.suspend(() => Deferred.isDoneUnsafe(drained) ? Effect20.void : cancelAndDrain));
};
var runQuery = (conn, plan2, wantRows) => Effect20.callback((resume) => {
  if (conn.deadWith !== void 0) {
    resume(Effect20.fail(conn.deadWith));
    return;
  }
  const machine = new QueryMachine(conn, plan2, wantRows, (effect) => {
    conn.consumer = void 0;
    resume(effect);
  });
  conn.consumer = machine;
  conn.session.parser.readField = machine.readField;
  try {
    conn.session.socket.write(plan2.frame);
  } catch (cause) {
    conn.fatal(connectionQueryError(cause, "PgConnection: Failed to write query"));
  }
  return Effect20.suspend(() => {
    if (machine.isDone()) return Effect20.void;
    return drainAborted(conn, "Query cancellation timed out", (onDrained) => machine.abort(() => {
      conn.consumer = void 0;
      onDrained();
    }));
  });
});
var emptyFields = [];
var describe = (fields, registry) => {
  const reader = makeFieldReader(fields, registry);
  if (EffectResult.isFailure(reader)) return EffectResult.fail(reader.failure);
  const resultFields = new Array(fields.length);
  for (let index = 0; index < fields.length; index++) {
    resultFields[index] = {
      name: fields[index].name,
      dataTypeId: fields[index].dataTypeOid
    };
  }
  return EffectResult.succeed({
    readField: reader.success,
    rowBuilder: makeRowBuilder(fields),
    resultFields
  });
};
var makeRowBuilder = (fields) => {
  const names = new Array(fields.length);
  let hasProto = false;
  for (let index = 0; index < fields.length; index++) {
    const name2 = fields[index].name;
    names[index] = name2;
    if (name2 === "__proto__") hasProto = true;
  }
  if (hasProto) {
    return (rowValues) => {
      const row = {};
      for (let index = 0; index < names.length; index++) {
        Object.defineProperty(row, names[index], {
          value: rowValues[index],
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      return row;
    };
  }
  return (rowValues) => {
    const row = {};
    for (let index = 0; index < names.length; index++) {
      row[names[index]] = rowValues[index];
    }
    return row;
  };
};
var streamRows = (conn, pin, sql, params) => Stream.fromChannel(Channel.fromTransform(Effect20.fnUntraced(function* (_, scope) {
  yield* Scope.provide(pin, scope);
  yield* Scope.provide(Effect20.acquireRelease(conn.wire.take(1), () => conn.wire.release(1)), scope);
  if (conn.deadWith !== void 0) return yield* conn.deadWith;
  const plan2 = yield* Effect20.try({
    try: () => conn.encodeQuery(sql, params, void 0),
    catch: (cause) => queryError(cause, "PgConnection: Failed to encode query")
  });
  const frame = plan2.frame;
  const socket = conn.session.socket;
  const parser = conn.session.parser;
  let phase = "parse";
  let fieldCount = 0;
  let rowBuilder;
  let buffer = [];
  let failure;
  let finished = false;
  let done2 = false;
  let aborted = false;
  let paused = false;
  let pending;
  let drainDone;
  const setPaused = (value3) => {
    if (paused === value3) return;
    paused = value3;
    if (value3) socket.pause();
    else socket.resume();
  };
  const deliver = () => {
    if (pending === void 0) return;
    const resume = pending;
    if (buffer.length > 0) {
      const chunk = buffer;
      buffer = [];
      pending = void 0;
      resume(Effect20.succeed(chunk));
    } else if (finished) {
      pending = void 0;
      resume(failure !== void 0 ? Effect20.fail(failure) : Cause5.done());
    }
  };
  const onFatal = (error) => {
    if (done2) return;
    done2 = true;
    finished = true;
    if (failure === void 0) failure = error;
    drainDone?.();
    deliver();
  };
  const failFatal = (error) => {
    conn.fatal(error);
    onFatal(error);
  };
  const failDesync = (message) => failFatal(connectionQueryError(new Error(message), `PgConnection: ${message}`));
  const onMessage = (message) => {
    if (aborted) {
      if (message._tag === "ReadyForQuery") {
        done2 = true;
        conn.consumer = void 0;
        drainDone?.();
      }
      return;
    }
    if (phase === "error") {
      switch (message._tag) {
        case "ReadyForQuery":
          finished = true;
          done2 = true;
          conn.consumer = void 0;
          deliver();
          return;
        default:
          return failDesync(`Unexpected ${message._tag} after ErrorResponse`);
      }
    }
    switch (message._tag) {
      case "ParseComplete":
        if (phase !== "parse") return failDesync(`Unexpected ParseComplete during ${phase}`);
        phase = "bind";
        return;
      case "BindComplete":
        if (phase !== "bind") return failDesync(`Unexpected BindComplete during ${phase}`);
        phase = "describe";
        return;
      case "RowDescription": {
        if (phase !== "describe") return failDesync(`Unexpected RowDescription during ${phase}`);
        const description = describe(message.fields, conn.registry);
        if (EffectResult.isFailure(description)) {
          return failFatal(queryError(description.failure, "PgConnection: Failed to decode row"));
        }
        fieldCount = message.fields.length;
        rowBuilder = description.success.rowBuilder;
        parser.readField = description.success.readField;
        phase = "rows";
        return;
      }
      case "NoData":
        if (phase !== "describe") return failDesync(`Unexpected NoData during ${phase}`);
        phase = "rows";
        return;
      case "DataRow": {
        if (phase !== "rows" || rowBuilder === void 0) {
          return failDesync(`Unexpected DataRow during ${phase}`);
        }
        const rowValues = message.values;
        if (rowValues.length !== fieldCount) {
          return failDesync(`DataRow has ${rowValues.length} values for ${fieldCount} fields`);
        }
        buffer.push(rowBuilder(rowValues));
        return;
      }
      case "CommandComplete":
        if (phase !== "rows") return failDesync(`Unexpected CommandComplete during ${phase}`);
        phase = "complete";
        return;
      case "EmptyQueryResponse":
        if (phase !== "rows") return failDesync(`Unexpected EmptyQueryResponse during ${phase}`);
        phase = "complete";
        return;
      case "ErrorResponse": {
        failure = new SqlError2({
          reason: classifyFields(message.fields, "PgConnection: Query failed", "query")
        });
        phase = "error";
        return;
      }
      case "ReadyForQuery":
        if (phase !== "complete") return failDesync(`Unexpected ReadyForQuery during ${phase}`);
        finished = true;
        done2 = true;
        conn.consumer = void 0;
        deliver();
        return;
      case "CopyInResponse":
      case "CopyOutResponse":
      case "CopyBothResponse":
      case "CopyData":
      case "CopyDone":
        return failDesync(`Unexpected ${message._tag}; COPY is not supported`);
      default:
        return failDesync(`Unexpected ${message._tag} during ${phase}`);
    }
  };
  const onBatchEnd = () => {
    if (done2 || aborted) return;
    if (pending !== void 0) deliver();
    else if (buffer.length >= streamPauseThreshold) setPaused(true);
  };
  yield* Scope.addFinalizer(scope, Effect20.suspend(() => {
    if (done2) return Effect20.void;
    aborted = true;
    const drain3 = drainAborted(conn, "Stream cancellation timed out", (onDrained) => {
      drainDone = onDrained;
    });
    setPaused(false);
    return drain3;
  }));
  conn.consumer = {
    onMessage,
    onBatchEnd,
    onFatal
  };
  parser.readField = void 0;
  try {
    socket.write(frame);
  } catch (cause) {
    failFatal(connectionQueryError(cause, "PgConnection: Failed to write query"));
  }
  return Effect20.callback((resume) => {
    pending = resume;
    setPaused(false);
    deliver();
    if (pending === void 0) return;
    return Effect20.sync(() => {
      if (pending === resume) pending = void 0;
    });
  });
})));
var listenChannel = (conn, pin, channel) => Effect20.uninterruptibleMask((restore) => Effect20.gen(function* () {
  const channelError = validateChannelName(channel, "listen");
  if (channelError !== void 0) return yield* Effect20.fail(channelError);
  const parentScope = yield* Scope.Scope;
  const scope = yield* Scope.fork(parentScope);
  return yield* restore(Effect20.gen(function* () {
    const pinned = yield* Scope.provide(pin, scope);
    if (conn.deadWith !== void 0) return yield* conn.deadWith;
    const queue = yield* Queue.unbounded();
    const identifier2 = escapeIdentifier(channel);
    let queues = conn.channels.get(channel);
    if (queues === void 0) {
      queues = /* @__PURE__ */ new Set();
      conn.channels.set(channel, queues);
    }
    queues.add(queue);
    yield* Scope.addFinalizer(scope, Effect20.suspend(() => {
      const current = conn.channels.get(channel);
      if (current === void 0) return Queue.shutdown(queue);
      current.delete(queue);
      if (current.size > 0) return Queue.shutdown(queue);
      conn.channels.delete(channel);
      const unlisten = conn.deadWith === void 0 ? Effect20.ignore(pinned.query(`UNLISTEN ${identifier2}`)) : Effect20.void;
      return Effect20.andThen(unlisten, Queue.shutdown(queue));
    }));
    yield* pinned.query(`LISTEN ${identifier2}`);
    return queue;
  })).pipe(Effect20.tapCause((cause) => Scope.close(scope, Exit.failCause(cause))));
}));
var sendCancelRequest = (config, session) => Effect20.callback((resume) => {
  let done2 = false;
  let socket;
  let timer;
  const finish = () => {
    if (done2) return;
    done2 = true;
    if (timer !== void 0) clearTimeout(timer);
    socket?.destroy();
    resume(Effect20.void);
  };
  const frame = encodeCancelRequest({
    pid: session.processId,
    secret: session.secretKey
  });
  const send = () => {
    socket.write(frame);
  };
  const begin2 = () => {
    if (config.ssl === false) return send();
    socket.once("data", (chunk) => {
      if (done2) return;
      if (chunk.length === 1 && chunk[0] === 78 && config.sslOptional && !session.encrypted) return send();
      if (chunk.length !== 1 || chunk[0] !== 83) return finish();
      const raw = socket;
      raw.off("error", finish);
      raw.off("close", finish);
      socket = Tls.connect({
        host: config.host,
        servername: Net.isIP(config.host) === 0 ? config.host : void 0,
        ...typeof config.ssl === "object" ? config.ssl : {},
        socket: raw
      });
      socket.on("error", finish);
      socket.on("close", finish);
      socket.once("secureConnect", send);
    });
    socket.write(encodeSslRequest());
  };
  try {
    socket = config.stream !== void 0 ? config.stream() : config.path !== void 0 ? Net.connect({
      path: config.path
    }) : Net.connect({
      host: config.host,
      port: config.port,
      noDelay: true
    });
  } catch {
    resume(Effect20.void);
    return;
  }
  timer = setTimeout(finish, cancelRequestTimeoutMillis);
  socket.on("error", finish);
  socket.on("close", finish);
  if (config.stream !== void 0) begin2();
  else socket.once("connect", begin2);
  return Effect20.sync(finish);
});
var connect3 = (config, resolvedPassword) => Effect20.callback((resume) => {
  let done2 = false;
  let socket;
  let encrypted3 = false;
  let parser;
  let sslErrorParser;
  let scram;
  let processId = 0;
  let secretKey = 0;
  const fail17 = (reason) => {
    if (done2) return;
    done2 = true;
    socket?.destroy();
    resume(Effect20.fail(new SqlError2({
      reason
    })));
  };
  const failConnect = (cause, message) => fail17(new ConnectionError2({
    cause,
    message,
    operation: "connect"
  }));
  const failAuth = (cause, message) => fail17(new AuthenticationError2({
    cause,
    message,
    operation: "connect"
  }));
  const onError = (cause) => failConnect(cause, "PgConnection: Failed to connect");
  const onClose = () => failConnect(new Error("Connection closed unexpectedly"), "PgConnection: Connection closed during startup");
  const password = () => {
    if (resolvedPassword === void 0) {
      failAuth(new Error("The server requested password authentication"), "PgConnection: No password configured");
      return void 0;
    }
    return resolvedPassword;
  };
  const handleMessage = (message) => {
    switch (message._tag) {
      case "AuthenticationOk":
      case "NoticeResponse":
      case "NegotiateProtocolVersion":
      case "ParameterStatus":
        return;
      case "AuthenticationCleartextPassword": {
        const secret = password();
        if (secret === void 0) return;
        socket.write(encodePasswordMessage({
          password: secret
        }));
        return;
      }
      case "AuthenticationMD5Password": {
        const secret = password();
        if (secret === void 0) return;
        const hashed = md5Password({
          user: config.username,
          password: secret,
          salt: message.salt
        });
        if (EffectResult.isFailure(hashed)) {
          return failAuth(hashed.failure, "PgConnection: MD5 authentication failed");
        }
        socket.write(encodePasswordMessage({
          password: hashed.success
        }));
        return;
      }
      case "AuthenticationSASL": {
        if (!message.mechanisms.includes(SCRAM_SHA_256)) {
          return failAuth(new Error(`Unsupported SASL mechanisms: ${message.mechanisms.join(", ")}`), `PgConnection: Only ${SCRAM_SHA_256} is supported`);
        }
        const secret = password();
        if (secret === void 0) return;
        const init = scramInit({
          password: secret,
          nonce: randomBytes(18).toString("base64")
        });
        if (EffectResult.isFailure(init)) {
          return failAuth(init.failure, "PgConnection: SCRAM authentication failed");
        }
        scram = init.success.state;
        socket.write(encodeSASLInitialResponse({
          mechanism: SCRAM_SHA_256,
          initialResponse: init.success.response
        }));
        return;
      }
      case "AuthenticationSASLContinue": {
        if (scram === void 0 || scram._tag !== "ScramFirst") {
          return failConnect(new Error("Unexpected AuthenticationSASLContinue"), "PgConnection: Protocol desync");
        }
        const next = scramContinue(scram, message.data);
        if (EffectResult.isFailure(next)) {
          return failAuth(next.failure, "PgConnection: SCRAM authentication failed");
        }
        scram = next.success.state;
        socket.write(encodeSASLResponse({
          data: next.success.response
        }));
        return;
      }
      case "AuthenticationSASLFinal": {
        if (scram === void 0 || scram._tag !== "ScramFinal") {
          return failConnect(new Error("Unexpected AuthenticationSASLFinal"), "PgConnection: Protocol desync");
        }
        const verified = scramFinish(scram, message.data);
        if (EffectResult.isFailure(verified)) {
          return failAuth(verified.failure, "PgConnection: SCRAM server verification failed");
        }
        scram = void 0;
        return;
      }
      case "AuthenticationUnsupported":
        return failAuth(new Error(`Authentication method ${message.method} is not supported`), "PgConnection: Unsupported authentication method");
      case "BackendKeyData":
        processId = message.pid;
        secretKey = message.secret;
        return;
      case "ErrorResponse":
        return fail17(classifyFields(message.fields, "PgConnection: Failed to connect", "connect"));
      case "ReadyForQuery":
        if (scram !== void 0) {
          return failAuth(new Error("The server completed authentication without proving its identity"), "PgConnection: SCRAM exchange did not complete");
        }
        done2 = true;
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
        socket.on("error", ignoreError);
        resume(Effect20.succeed({
          socket,
          encrypted: encrypted3,
          parser,
          processId,
          secretKey
        }));
        return;
      default:
        return failConnect(new Error(`Unexpected ${message._tag} message during startup`), "PgConnection: Protocol desync");
    }
  };
  const onData = (chunk) => {
    let messages;
    try {
      messages = parser.push(chunk);
    } catch (cause) {
      return failConnect(cause, "PgConnection: Failed to parse server response");
    }
    for (const message of messages) {
      if (done2) return;
      handleMessage(message);
    }
  };
  const startup = () => {
    parser = makeParser({
      maxMessageSize: config.maxMessageSize
    });
    socket.on("data", onData);
    socket.write(encodeStartupMessage(config.startupParameters));
  };
  const onSslResponse = (chunk) => {
    if (done2) return;
    if (sslErrorParser !== void 0 || chunk[0] === 69) {
      sslErrorParser ??= makeParser({
        maxMessageSize: config.maxMessageSize
      });
      let messages;
      try {
        messages = sslErrorParser.push(chunk);
      } catch (cause) {
        return failConnect(cause, "PgConnection: Failed to parse SSLRequest error response");
      }
      if (messages.length === 0) return;
      socket.off("data", onSslResponse);
      const message = messages[0];
      if (messages.length !== 1 || message._tag !== "ErrorResponse") {
        return failConnect(new Error("Expected one ErrorResponse after SSLRequest"), "PgConnection: Invalid SSLRequest response");
      }
      return fail17(classifyFields(message.fields, "PgConnection: Failed to negotiate TLS", "connect"));
    }
    socket.off("data", onSslResponse);
    if (chunk.length !== 1) {
      return failConnect(new Error(`Received ${chunk.length} bytes in response to SSLRequest`), "PgConnection: Invalid SSLRequest response");
    }
    const response = decodeSslResponse(chunk[0]);
    if (EffectResult.isFailure(response)) {
      return failConnect(response.failure, "PgConnection: Invalid SSLRequest response");
    }
    if (response.success === "N") {
      if (config.sslOptional) return startup();
      return failConnect(new Error("The server does not support TLS"), "PgConnection: Server refused TLS");
    }
    const raw = socket;
    raw.off("error", onError);
    raw.off("close", onClose);
    socket = Tls.connect({
      host: config.host,
      servername: Net.isIP(config.host) === 0 ? config.host : void 0,
      ...typeof config.ssl === "object" ? config.ssl : {},
      socket: raw
    });
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.once("secureConnect", () => {
      encrypted3 = true;
      startup();
    });
  };
  const begin2 = () => {
    if (config.ssl === false) return startup();
    socket.on("data", onSslResponse);
    socket.write(encodeSslRequest());
  };
  try {
    socket = config.stream !== void 0 ? config.stream() : config.path !== void 0 ? Net.connect({
      path: config.path
    }) : Net.connect({
      host: config.host,
      port: config.port,
      noDelay: true
    });
  } catch (cause) {
    resume(Effect20.fail(new SqlError2({
      reason: new ConnectionError2({
        cause,
        message: "PgConnection: Failed to connect",
        operation: "connect"
      })
    })));
    return;
  }
  socket.on("error", onError);
  socket.on("close", onClose);
  if (config.stream !== void 0) {
    begin2();
  } else {
    socket.once("connect", begin2);
  }
  return Effect20.sync(() => {
    if (done2) return;
    done2 = true;
    socket.destroy();
  });
});
var ignoreError = (_) => {
};
var configError = (message, cause) => new SqlError2({
  reason: new ConnectionError2({
    cause: cause ?? new Error(message),
    message: `PgConnection: ${message}`,
    operation: "connect"
  })
});
var resolveConfig = (options) => Effect20.suspend(() => {
  const parsed = options.url !== void 0 ? parseUrl(Redacted3.value(options.url)) : EffectResult.succeed({});
  if (EffectResult.isFailure(parsed)) return Effect20.fail(parsed.failure);
  const url = parsed.success;
  const host = options.host ?? url.host ?? "localhost";
  const port = options.port ?? url.port ?? 5432;
  const username = options.username ?? url.username ?? process.env.USER ?? process.env.USERNAME;
  if (username === void 0) {
    return Effect20.fail(configError("No username configured"));
  }
  const named = /* @__PURE__ */ Object.create(null);
  for (const [name2, value3] of Object.entries(options.startupParameters ?? {})) {
    const key = name2.toLowerCase();
    if (key === "user" || key === "database" || key === "replication" || key === "options") {
      return Effect20.fail(configError(`Reserved startup parameter: "${name2}"`));
    }
    if (key === "client_encoding") {
      const encoding = value3.toUpperCase();
      if (encoding !== "UTF8" && encoding !== "UTF-8") {
        return Effect20.fail(configError("Startup parameter client_encoding must be UTF8 or UTF-8"));
      }
      named[key] = "UTF8";
    } else {
      named[key] = value3;
    }
    if (name2 === "" || name2.includes("\0") || value3.includes("\0")) {
      return Effect20.fail(configError("Startup parameter names must be nonempty and names/values must not contain NUL"));
    }
  }
  const startupParameters = {
    ...named,
    user: username,
    database: options.database ?? url.database,
    application_name: options.applicationName ?? named.application_name ?? url.applicationName ?? "@effect/sql-pg",
    options: options.startupOptions ?? url.options
  };
  for (const [name2, value3] of Object.entries(startupParameters)) {
    if (value3?.includes("\0")) {
      return Effect20.fail(configError(`Startup parameter "${name2}" must not contain NUL`));
    }
  }
  return Effect20.succeed({
    host,
    port,
    path: options.path ?? (host.startsWith("/") ? `${host}/.s.PGSQL.${port}` : void 0),
    ssl: options.ssl ?? (url.ssl === "prefer" ? true : url.ssl ?? false),
    sslOptional: options.ssl === void 0 && url.ssl === "prefer",
    username,
    password: options.password ?? (url.password !== void 0 ? Redacted3.make(url.password) : void 0),
    connectTimeout: Duration.fromInputUnsafe(options.connectTimeout ?? url.connectTimeout ?? Duration.seconds(5)),
    startupParameters,
    stream: options.stream,
    maxMessageSize: options.maxMessageSize
  });
});
var decodeComponent = (value3, what) => {
  try {
    return EffectResult.succeed(decodeURIComponent(value3));
  } catch {
    return EffectResult.fail(configError(`Invalid percent-encoding in URL ${what}`));
  }
};
var parsePort = (value3, what) => {
  const port = Number(value3);
  return !Number.isInteger(port) || port < 1 || port > 65535 ? EffectResult.fail(configError(`Invalid port in URL ${what}: "${value3}"`)) : EffectResult.succeed(port);
};
var parseUrl = (raw) => {
  let url;
  try {
    url = new URL(raw);
  } catch (cause) {
    return EffectResult.fail(configError("Invalid connection URL", cause));
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return EffectResult.fail(configError(`Unsupported connection URL protocol: "${url.protocol}"`));
  }
  const config = {};
  if (url.hostname !== "") {
    if (url.hostname.startsWith("[") && url.hostname.endsWith("]")) {
      config.host = url.hostname.slice(1, -1);
    } else {
      const host = decodeComponent(url.hostname, "host");
      if (EffectResult.isFailure(host)) return EffectResult.fail(host.failure);
      config.host = host.success;
    }
  }
  if (url.port !== "") {
    const port = parsePort(url.port, "authority");
    if (EffectResult.isFailure(port)) return EffectResult.fail(port.failure);
    config.port = port.success;
  }
  if (url.username !== "") {
    const username = decodeComponent(url.username, "username");
    if (EffectResult.isFailure(username)) return EffectResult.fail(username.failure);
    config.username = username.success;
  }
  if (url.password !== "") {
    const password = decodeComponent(url.password, "password");
    if (EffectResult.isFailure(password)) return EffectResult.fail(password.failure);
    config.password = password.success;
  }
  const database = decodeComponent(url.pathname.replace(/^\//, ""), "database");
  if (EffectResult.isFailure(database)) return EffectResult.fail(database.failure);
  if (database.success !== "") config.database = database.success;
  for (const [key, value3] of url.searchParams) {
    switch (key) {
      case "host":
        config.host = value3;
        break;
      case "port": {
        const port = parsePort(value3, "port parameter");
        if (EffectResult.isFailure(port)) return EffectResult.fail(port.failure);
        config.port = port.success;
        break;
      }
      case "user":
        config.username = value3;
        break;
      case "password":
        config.password = value3;
        break;
      case "dbname":
        config.database = value3;
        break;
      case "application_name":
        config.applicationName = value3;
        break;
      case "options":
        config.options = value3;
        break;
      case "connect_timeout": {
        const seconds3 = Number(value3);
        if (!Number.isInteger(seconds3) || seconds3 < 0) {
          return EffectResult.fail(configError(`Invalid connect_timeout in URL: "${value3}"`));
        }
        config.connectTimeout = seconds3 === 0 ? Duration.infinity : Duration.seconds(seconds3);
        break;
      }
      case "sslmode":
        switch (value3) {
          case "disable":
            config.ssl = false;
            break;
          case "require":
          case "verify-ca":
          case "verify-full":
            config.ssl = true;
            break;
          case "prefer":
          case "allow":
            config.ssl = "prefer";
            break;
          default:
            return EffectResult.fail(configError(`Unrecognized sslmode in URL: "${value3}"`));
        }
        break;
    }
  }
  return EffectResult.succeed(config);
};
var classifyFields = (fields, message, operation2) => {
  const cause = Object.assign(new Error(fields.message ?? "Unknown PostgreSQL error"), fields);
  return classifySqlState(fields.code, fields.constraint, {
    cause,
    message,
    operation: operation2
  });
};

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgPool.js
import * as Clock from "effect/Clock";
import * as Context12 from "effect/Context";
import * as Duration2 from "effect/Duration";
import * as Effect21 from "effect/Effect";
import * as Pool from "effect/Pool";
var defaultMultiplexConcurrency = 32;
var TypeId2 = "~@effect/sql-pg/PgPool";
var make13 = /* @__PURE__ */ Effect21.fnUntraced(function* (options) {
  const clock2 = yield* Clock.Clock;
  const runFork = Effect21.runForkWith(yield* Effect21.context());
  const multiplex = options.multiplex ?? false;
  const connectionTTL = options.connectionTTL !== void 0 ? Duration2.toMillis(Duration2.fromInputUnsafe(options.connectionTTL)) : void 0;
  const deadConnections = /* @__PURE__ */ new Set();
  const createdAt = /* @__PURE__ */ new WeakMap();
  const checkedOut = /* @__PURE__ */ new WeakSet();
  let pool;
  const acquire = Effect21.tap(make12(options), (connection) => Effect21.sync(() => {
    createdAt.set(connection, clock2.currentTimeMillisUnsafe());
    const internals = connectionInternals(connection);
    internals.retireHooks.add(() => {
      deadConnections.add(connection);
      runFork(Pool.invalidate(pool, connection));
    });
    if (multiplex) internals.reserve = Pool.reserve(pool, connection);
  }));
  const maxConnections = options.maxConnections ?? 10;
  pool = yield* Pool.makeWithTTL({
    acquire,
    min: options.minConnections ?? 0,
    max: maxConnections,
    concurrency: multiplex ? Math.max(1, options.multiplexConcurrency ?? defaultMultiplexConcurrency) : 1,
    timeToLive: options.idleTimeout ?? Duration2.seconds(10),
    timeToLiveStrategy: "usage"
  });
  const expired = (connection) => {
    if (connectionInternals(connection).deadError() !== void 0) return true;
    if (connectionTTL === void 0) return false;
    if (!checkedOut.has(connection)) {
      checkedOut.add(connection);
      return false;
    }
    const openedAt = createdAt.get(connection);
    return openedAt !== void 0 && clock2.currentTimeMillisUnsafe() - openedAt >= connectionTTL;
  };
  const retry = Effect21.gen(function* () {
    while (true) {
      if (deadConnections.size > 0) {
        const dead = Array.from(deadConnections);
        deadConnections.clear();
        yield* Effect21.forEach(dead, (connection2) => Pool.invalidate(pool, connection2), {
          discard: true
        });
      }
      const connection = yield* Pool.get(pool);
      if (expired(connection)) {
        yield* Pool.invalidate(pool, connection);
        continue;
      }
      return connection;
    }
  });
  const get2 = Effect21.suspend(() => deadConnections.size > 0 ? retry : Effect21.flatMap(Pool.get(pool), (connection) => expired(connection) ? Effect21.andThen(Pool.invalidate(pool, connection), retry) : Effect21.succeed(connection)));
  const reserve2 = Effect21.flatMap(get2, (connection) => connection.pin);
  const use2 = (f) => Effect21.suspend(() => connectionTTL === void 0 && deadConnections.size === 0 ? Pool.use(pool, f) : Effect21.scoped(Effect21.flatMap(get2, f)));
  const pgPool = {
    [TypeId2]: TypeId2,
    config: options,
    get: get2,
    reserve: reserve2,
    use: use2,
    invalidate: (connection) => Pool.invalidate(pool, connectionInternals(connection).base)
  };
  return pgPool;
});

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgClient.js
var TypeId3 = "~@effect/sql-pg/PgClient";
var make16 = (options) => Effect22.flatMap(make13(options), (pool) => makeImpl({
  acquirer: Effect22.map(pool.get, makeConnection),
  borrower: (f) => pool.use((connection) => f(makeConnection(connection))),
  transactionAcquirer: Effect22.map(pool.reserve, makeConnection),
  listenAcquirer: pool.reserve,
  config: options
}));
var makeImpl = /* @__PURE__ */ Effect22.fnUntraced(function* (options) {
  const config = options.config;
  const compiler = makeCompiler2(config.transformQueryNames, config.transformJson);
  const transformRows = config.transformResultNames ? Statement.defaultTransforms(config.transformResultNames, config.transformJson).array : void 0;
  const listen = (channel) => Effect22.flatMap(options.listenAcquirer, (connection) => connection.listen(channel));
  return Object.assign(yield* Client.make({
    acquirer: options.acquirer,
    borrower: options.borrower,
    // Postgres prepares transaction control like anything else, and a client
    // with preparation turned off falls back to the unnamed path anyway.
    prepareTransactionControls: true,
    commit,
    releaseSavepoint: (name2) => `RELEASE SAVEPOINT ${name2}`,
    transactionAcquirer: options.transactionAcquirer,
    compiler,
    spanAttributes: [...config.spanAttributes ? Object.entries(config.spanAttributes) : [], [ATTR_DB_SYSTEM_NAME, "postgresql"], [ATTR_DB_NAMESPACE, config.database ?? config.username ?? "postgres"], [ATTR_SERVER_ADDRESS, config.host ?? "localhost"], [ATTR_SERVER_PORT, config.port ?? 5432]],
    transformRows
  }), {
    [TypeId3]: TypeId3,
    config,
    json: (_) => Statement.fragment([PgJson(_)]),
    listen,
    notify: (channel, payload2) => {
      const channelError = validateChannelName(channel, "notify");
      return channelError !== void 0 ? Effect22.fail(channelError) : Effect22.asVoid(Effect22.scoped(Effect22.flatMap(options.acquirer, (conn) => conn.executeRaw(`SELECT pg_notify($1, $2)`, [channel, payload2]))));
    }
  });
});
var ConnectionImpl = class {
  connection;
  streamAcquirer;
  constructor(connection, streamAcquirer) {
    this.connection = connection;
    this.streamAcquirer = streamAcquirer;
  }
  run(query, params, prepare = true) {
    return Effect22.map(this.connection.query(query, params, prepare), (result3) => result3.rows);
  }
  execute(sql, params, transformRows) {
    return transformRows ? Effect22.map(this.run(sql, params), transformRows) : this.run(sql, params);
  }
  executeRaw(sql, params) {
    return this.connection.query(sql, params);
  }
  executeWithoutTransform(sql, params) {
    return this.run(sql, params);
  }
  executeValues(sql, params) {
    return this.connection.queryValues(sql, params);
  }
  executeValuesUnprepared(sql, params) {
    return this.connection.queryValues(sql, params, false);
  }
  executeUnprepared(sql, params, transformRows) {
    const operation2 = this.run(sql, params, false);
    return transformRows ? Effect22.map(operation2, transformRows) : operation2;
  }
  executeStream(sql, params, transformRows) {
    const stream = this.streamAcquirer === void 0 ? this.connection.stream(sql, params) : Stream2.unwrap(Effect22.map(this.streamAcquirer, (connection) => connection.stream(sql, params)));
    return transformRows ? Stream2.mapArray(stream, (rows) => transformRows(rows)) : stream;
  }
};
var commit = (conn) => Effect22.flatMap(conn.executeRaw("COMMIT", []), (result3) => result3.command === "ROLLBACK" ? Effect22.fail(new SqlError3({
  reason: new UnknownError3({
    cause: new Error("COMMIT rolled back an aborted transaction"),
    message: "PgClient: COMMIT rolled back an aborted transaction",
    operation: "commit"
  })
})) : Effect22.void);
var makeConnection = (connection, streamAcquirer) => new ConnectionImpl(connection, streamAcquirer);
var makeCompiler2 = (transform, transformJson = true) => {
  const transformValue = transformJson && transform ? Statement.defaultTransforms(transform).value : void 0;
  return Statement.makeCompiler({
    dialect: "pg",
    placeholder(_) {
      return `$${_}`;
    },
    onIdentifier: transform ? function(value3, withoutTransform) {
      return withoutTransform ? escape(value3) : escape(transform(value3));
    } : escape,
    onRecordUpdate(placeholders, valueAlias, valueColumns, values, returning) {
      return [`(values ${placeholders}) AS ${valueAlias}${valueColumns}${returning ? ` RETURNING ${returning[0]}` : ""}`, returning ? values.flat().concat(returning[1]) : values.flat()];
    },
    onCustom(type, placeholder, withoutTransform) {
      switch (type.kind) {
        case "PgJson": {
          const value3 = withoutTransform || transformValue === void 0 ? type.paramA : transformValue(type.paramA);
          return [placeholder(void 0), [jsonb(value3)]];
        }
      }
    }
  });
};
var escape = /* @__PURE__ */ Statement.defaultEscape('"');
var PgJson = /* @__PURE__ */ Statement.custom("PgJson");
var ATTR_DB_SYSTEM_NAME = "db.system.name";
var ATTR_DB_NAMESPACE = "db.namespace";
var ATTR_SERVER_ADDRESS = "server.address";
var ATTR_SERVER_PORT = "server.port";

// apps/playground-worker/src/execution/Event.ts
import { SqlClient as SqlClient10 } from "effect/sql/SqlClient";
import * as Native from "effect-jobs/PostgreSqlNative";
import * as Backend from "effect-jobs/PostgreSqlJobs";
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction";
import { JobEnqueue as JobEnqueue4 } from "effect-jobs/JobEnqueue";

// apps/playground-worker/src/persistence/authority/PostgreSqlAuthority.ts
import { Cause as Cause6, Effect as Effect25, Layer as Layer9, Option as Option3, Redacted as Redacted4, Schema as Schema21 } from "effect";
import { SqlClient as SqlClient6 } from "effect/sql/SqlClient";
import { isSqlError as isSqlError3 } from "effect/sql/SqlError";

// apps/playground-worker/src/scenarios/PrivateTraffic.ts
import { Duration as Duration4, Effect as Effect24 } from "effect";
import { SqlClient as SqlClient5 } from "effect/sql/SqlClient";
import { JobEnqueue } from "effect-jobs/JobEnqueue";
import * as Policy from "effect-jobs/JobPolicy";

// apps/playground-worker/src/scenarios/Plan.ts
import { Data as Data4, Duration as Duration3, Effect as Effect23, Schema as Schema20 } from "effect";
import * as JobPolicy from "effect-jobs/JobPolicy";
var InvalidScenario = class extends Data4.TaggedError("InvalidScenario") {
};
var workloads = Workload.literals;
var behavior = (scenario) => {
  switch (scenario) {
    case "delayed-success":
    case "success":
    case "deduplication":
      return "success";
    case "retry-then-success":
      return "retry-then-success";
    case "isolated":
      return "isolated";
    case "terminal-failure":
      return "dead";
    case "unknown-outcome":
      return "accepted-response-lost";
  }
};
var plan = Effect23.fn("Playground.plan")(function* (input, authorized, seed2, availableAt, namespace) {
  const command = yield* Schema20.decodeUnknownEffect(ScenarioCommand)(input, {
    onExcessProperty: "error"
  }).pipe(Effect23.mapError(() => new InvalidScenario()));
  if (command.sandbox.sandboxId !== authorized.sandboxId || command.sandbox.generation !== authorized.generation || !Schema20.is(Payload.fields.seed)(seed2) || availableAt !== void 0 && !Schema20.is(JobPolicy.EpochMillis)(availableAt)) {
    return yield* new InvalidScenario();
  }
  const bytes2 = new TextEncoder().encode(
    JSON.stringify([
      authorized.sandboxId,
      authorized.generation,
      command.requestId,
      ...namespace === void 0 ? [] : [namespace]
    ])
  );
  const digest2 = yield* Effect23.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", bytes2),
    catch: () => new InvalidScenario()
  });
  const operationId = `sandbox-request-${Array.from(new Uint8Array(digest2), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const jobs = [];
  for (let index = 0; index < command.count; index++) {
    const workload = workloads[(seed2 + index) % workloads.length];
    jobs.push({
      workload,
      payload: {
        sandbox: { ...authorized },
        version: 1,
        seed: seed2,
        sequence: index + 1,
        behavior: behavior(command.scenario),
        actor: "demo-customer",
        tenant: (seed2 + index) % 2 === 0 ? "demo-tenant-a" : "demo-tenant-b",
        order: (seed2 + index) % 2 === 0 ? "demo-order-a" : "demo-order-b"
      },
      producer: Producer.identity({ operationId, slot: workload }),
      policy: JobPolicy.make(
        command.scenario === "retry-then-success" ? { retryDelay: Duration3.seconds(120) } : {}
      ),
      ...availableAt === void 0 ? {} : { availableAt }
    });
  }
  return jobs.map((job) => ({
    ...job,
    producer: Producer.identity({
      operationId: `${operationId}-${job.payload.sequence}`,
      slot: job.workload
    })
  }));
});
var exportPayload = (payload2) => ({
  ...payload2,
  document: {
    subject: payload2.actor,
    tenant: payload2.tenant,
    note: "synthetic private export v1"
  }
});
var enqueue = (job) => {
  const input = {
    producer: job.producer,
    policy: job.policy,
    payload: job.payload,
    ...job.availableAt === void 0 ? {} : { availableAt: job.availableAt }
  };
  switch (job.workload) {
    case "welcome-email":
      return WelcomeEmail.enqueue(input);
    case "image-processing":
      return ImageProcessing.enqueue(input);
    case "webhook-delivery":
      return WebhookDelivery.enqueue(input);
    case "private-data-export":
      return SyntheticDocumentExport.enqueue({
        ...input,
        payload: exportPayload(job.payload)
      });
    case "catalog-sync":
      return CatalogSync.enqueue(input);
    case "simulated-payment":
      return SimulatedPayment.enqueue(input);
  }
};

// apps/playground-worker/src/scenarios/PrivateTraffic.ts
var interactionMillis = 12e4;
var starterScenarios = [
  "success",
  "delayed-success",
  "retry-then-success",
  "terminal-failure",
  "isolated",
  "deduplication"
];
var starterCount = starterScenarios.length;
var make19 = (schema) => Effect24.gen(function* () {
  const sql = yield* SqlClient5;
  const local = yield* LocalPrivate;
  const retainedMaximum2 = retainedMaximum(local);
  const admissionMaximum2 = admissionMaximum(local);
  const producer3 = yield* JobEnqueue;
  const keys2 = yield* DocumentKeys;
  const t = relations(schema);
  const query = (text3, values = []) => sql.unsafe(text3, values).pipe(Effect24.mapError(() => new PlaygroundError({ code: "unavailable" })));
  const append = (ref, requestId, scenarios, now, seed2 = 0) => Effect24.gen(function* () {
    if (!Number.isInteger(scenarios.length) || scenarios.length < 1 || scenarios.length > 10) {
      return yield* new PlaygroundError({ code: "limit-reached" });
    }
    const [budget] = yield* query(
      `SELECT count(*) AS n FROM ${t.admission} WHERE sandbox_id=$1`,
      [ref.sandboxId]
    );
    if (Number(budget.n) >= admissionMaximum2) {
      return yield* new PlaygroundError({ code: "limit-reached" });
    }
    const reserved = yield* query(
      `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+$3::int
        WHERE sandbox_id=$1 AND generation=$2 AND NOT demo_owned AND retained_jobs<=${retainedMaximum2}-$3::int RETURNING sandbox_id`,
      [ref.sandboxId, ref.generation, scenarios.length]
    );
    if (!reserved.length) {
      return yield* new PlaygroundError({ code: "limit-reached" });
    }
    yield* query(
      `INSERT INTO ${t.admission}(sandbox_id,generation,operation,request_id) VALUES ($1,$2,'PrivateTraffic',$3)`,
      [ref.sandboxId, ref.generation, requestId]
    );
    const jobIds = [];
    for (let index = 0; index < scenarios.length; index++) {
      const scenario = scenarios[index];
      const [job] = yield* plan(
        { sandbox: ref, requestId: `${requestId}-${index}`, scenario, count: 1 },
        ref,
        seed2 + index,
        scenario === "delayed-success" ? now + interactionMillis : now,
        "private-traffic-v1"
      ).pipe(Effect24.mapError(() => new PlaygroundError({ code: "unavailable" })));
      const planned = {
        ...job,
        policy: Policy.make({ retryDelay: Duration4.millis(interactionMillis) })
      };
      const enqueue2 = enqueue(planned).pipe(
        Effect24.provideService(JobEnqueue, producer3),
        Effect24.provideService(DocumentKeys, keys2),
        Effect24.mapError(() => new PlaygroundError({ code: "unavailable" }))
      );
      const produced = yield* enqueue2;
      if (scenario === "deduplication") {
        const duplicate = yield* enqueue2;
        if (duplicate._tag !== "AlreadyPresent" || duplicate.jobId !== produced.jobId) {
          return yield* new PlaygroundError({ code: "unavailable" });
        }
      }
      yield* query(`INSERT INTO ${t.associations} VALUES ($1,$2,$3,$4::jsonb)`, [
        ref.sandboxId,
        ref.generation,
        produced.jobId,
        JSON.stringify({
          syntheticActor: job.payload.actor,
          syntheticTenant: job.payload.tenant,
          syntheticOrderId: job.payload.order
        })
      ]);
      jobIds.push(produced.jobId);
    }
    yield* query(
      `INSERT INTO ${t.receipts} VALUES ($1,$2,'PrivateTraffic',$3,$4::jsonb)`,
      [
        ref.sandboxId,
        ref.generation,
        requestId,
        JSON.stringify({ sandbox: ref, requestId, scenarios, jobIds })
      ]
    );
    yield* query(
      `INSERT INTO ${t.audit} VALUES ($1,$2,'PrivateTraffic','synthetic-scenario',$3,$4)`,
      [ref.sandboxId, ref.generation, scenarios.length, now]
    );
  });
  const ensure = (ref, now) => Effect24.gen(function* () {
    const prior = yield* query(
      `SELECT request_id FROM ${t.receipts} WHERE sandbox_id=$1 AND generation=$2 AND operation='PrivateTraffic' AND request_id='starter-v1'`,
      [ref.sandboxId, ref.generation]
    );
    if (!prior.length) {
      yield* append(ref, "starter-v1", starterScenarios, now);
    }
  });
  return { ensure, append };
});

// apps/playground-worker/src/persistence/authority/PostgreSqlAuthority.ts
var viewerMillis = 15e3;
var dbTime2 = "floor(extract(epoch FROM clock_timestamp())*1000)::bigint";
var fail14 = (code) => new PlaygroundError({ code });
var controls3 = (effect) => effect.pipe(
  Effect25.catchCause(
    (cause) => Effect25.failCause(
      Cause6.fromReasons(
        cause.reasons.map((reason) => {
          if (Cause6.isFailReason(reason) && isSqlError3(reason.error) || Cause6.isDieReason(reason) && isSqlError3(reason.defect)) {
            return Cause6.makeFailReason(
              new CommandTransactionFailure({ commitKnowledge: "Unknown" })
            );
          }
          return reason;
        })
      )
    )
  )
);
var digest = (value3) => Effect25.tryPromise({
  try: async () => Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value3))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join(""),
  catch: () => fail14("unavailable")
});
var view2 = (row, local = false) => Schema21.decodeUnknownEffect(SandboxView)(
  {
    ref: { sandboxId: row.sandbox_id, generation: Number(row.generation) },
    expiresAt: Number(row.expires_at),
    ...row.demo_owned === true ? {} : {
      capacity: {
        mode: local ? "local" : "bounded",
        retainedJobs: Number(row.retained_jobs),
        admittedCommands: Number(row.admitted_commands ?? 0)
      }
    },
    capabilities: {
      runScenario: row.demo_owned !== true,
      resetSandbox: row.demo_owned !== true,
      retryJob: row.demo_owned !== true,
      redriveJob: row.demo_owned !== true,
      cancelJob: row.demo_owned !== true
    }
  },
  { onExcessProperty: "error" }
).pipe(Effect25.mapError(() => fail14("unavailable")));
var make20 = (schema) => Effect25.gen(function* () {
  const sql = yield* SqlClient6;
  const local = yield* LocalPrivate;
  const retainedMaximum2 = retainedMaximum(local);
  const admissionMaximum2 = admissionMaximum(local);
  const t = relations(schema);
  const traffic = yield* make19(schema);
  const query = (text3, values = []) => sql.unsafe(text3, values).pipe(
    Effect25.mapError(
      () => new CommandTransactionFailure({ commitKnowledge: "Unknown" })
    )
  );
  const described = (id) => query(
    `SELECT s.*,((SELECT count(*) FROM ${t.admission} WHERE sandbox_id=s.sandbox_id)+(SELECT count(*) FROM "${schema}"."repair_admission" WHERE sandbox_id=s.sandbox_id)) AS admitted_commands FROM ${t.sandboxes} s WHERE sandbox_id=$1`,
    [id]
  );
  const locked = (id) => Effect25.gen(function* () {
    const rows = yield* query(
      `SELECT * FROM ${t.sandboxes} WHERE sandbox_id=$1 FOR UPDATE`,
      [id]
    );
    const [clock2] = yield* query(`SELECT ${dbTime2} AS db_now`);
    return rows.map((row) => ({ ...row, db_now: clock2.db_now }));
  });
  const guard4 = (rows, expected) => Effect25.gen(function* () {
    const row = rows[0];
    if (!row) {
      return yield* fail14("not-found");
    }
    if (Number(row.expires_at) <= Number(row.db_now)) {
      return yield* fail14("sandbox-expired");
    }
    if (expected && Number(row.generation) !== expected.generation) {
      return yield* fail14("stale-generation");
    }
    return row;
  });
  const publicEffect = (effect) => effect.pipe(
    Effect25.mapError(
      (error) => error instanceof PlaygroundError ? error : fail14("unavailable")
    )
  );
  const renew = (access) => sql.withTransaction(
    Effect25.gen(function* () {
      const row = yield* guard4(
        yield* locked(access.sandbox.ref.sandboxId),
        access.sandbox.ref
      );
      yield* query(
        `UPDATE ${t.sandboxes} SET viewer_until=LEAST(expires_at,$2::bigint+$3::bigint) WHERE sandbox_id=$1`,
        [row.sandbox_id, row.db_now, viewerMillis]
      );
      if (row.demo_owned !== true) {
        yield* traffic.ensure((yield* view2(row, local)).ref, Number(row.db_now)).pipe(
          Effect25.catchTag(
            "PlaygroundError",
            (error) => error.code === "limit-reached" ? Effect25.void : Effect25.fail(error)
          )
        );
      }
      return yield* view2((yield* described(String(row.sandbox_id)))[0], local);
    })
  ).pipe(publicEffect);
  const authority = SandboxAuthority.of({
    issue: () => Effect25.gen(function* () {
      const credential = yield* Effect25.sync(
        () => Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (byte) => byte.toString(16).padStart(2, "0")
        ).join("")
      );
      const hash = yield* digest(credential);
      const id = yield* Effect25.sync(() => crypto.randomUUID());
      return yield* sql.withTransaction(
        Effect25.gen(function* () {
          const rows = yield* query(
            `INSERT INTO ${t.sandboxes}(sandbox_id,generation,expires_at,credential_hash,viewer_until,next_generation_at)
        VALUES ($1,1,${dbTime2}+$3::bigint,$2,${dbTime2}+$4::bigint,${dbTime2}+5000) RETURNING *,${dbTime2} AS db_now`,
            [id, hash, limits.sandboxLifetimeMillis, viewerMillis]
          );
          yield* traffic.ensure(
            (yield* view2(rows[0], local)).ref,
            Number(rows[0].db_now)
          );
          const [created] = yield* described(id);
          return {
            sandbox: yield* view2(created, local),
            credential: Redacted4.make(credential)
          };
        })
      );
    }).pipe(publicEffect),
    authenticate: (credential) => Effect25.gen(function* () {
      if (!/^[0-9a-f]{64}$/.test(Redacted4.value(credential))) {
        return yield* fail14("not-found");
      }
      const hash = yield* digest(Redacted4.value(credential));
      const row = yield* guard4(
        yield* query(
          `SELECT s.*,${dbTime2} AS db_now,((SELECT count(*) FROM ${t.admission} WHERE sandbox_id=s.sandbox_id)+(SELECT count(*) FROM "${schema}"."repair_admission" WHERE sandbox_id=s.sandbox_id)) AS admitted_commands FROM ${t.sandboxes} s WHERE credential_hash=$1`,
          [hash]
        )
      );
      return { sandbox: yield* view2(row, local) };
    }).pipe(publicEffect),
    describe: renew
  });
  const receipt = (ref, requestId, operation2) => query(
    `SELECT receipt FROM ${t.receipts} WHERE sandbox_id=$1 AND generation=$2 AND operation=$3 AND request_id=$4`,
    [ref.sandboxId, ref.generation, operation2, requestId]
  ).pipe(
    Effect25.flatMap(
      (rows) => rows[0] ? Schema21.decodeUnknownEffect(StoredReceipt)(rows[0].receipt, {
        onExcessProperty: "error"
      }).pipe(Effect25.mapError(() => fail14("unavailable"))) : Effect25.succeed(null)
    )
  );
  const transactions = CommandTransactions.of({
    owned: (access, request, operation2, body) => Effect25.gen(function* () {
      if (Option3.isSome(yield* Effect25.serviceOption(sql.transactionService))) {
        return yield* new CommandTransactionFailure({
          commitKnowledge: "NotCommitted"
        });
      }
      if (request.sandbox.sandboxId !== access.sandbox.ref.sandboxId) {
        return yield* fail14("not-found");
      }
      const fresh = yield* controls3(
        sql.withTransaction(
          Effect25.gen(function* () {
            const admitted = yield* guard4(yield* locked(request.sandbox.sandboxId));
            if (admitted.demo_owned === true) {
              return yield* fail14("capability-unavailable");
            }
            const prior = yield* query(
              `SELECT request_id FROM ${t.admission} WHERE sandbox_id=$1 AND generation=$2 AND operation=$3 AND request_id=$4`,
              [
                request.sandbox.sandboxId,
                request.sandbox.generation,
                operation2,
                request.requestId
              ]
            );
            if (prior.length) {
              return false;
            }
            const [budget] = yield* query(
              `SELECT count(*) AS n FROM ${t.admission} WHERE sandbox_id=$1`,
              [request.sandbox.sandboxId]
            );
            if (Number(budget.n) >= admissionMaximum2) {
              return yield* fail14("limit-reached");
            }
            const inserted = yield* query(
              `INSERT INTO ${t.admission}(sandbox_id,generation,operation,request_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING request_id`,
              [
                request.sandbox.sandboxId,
                request.sandbox.generation,
                operation2,
                request.requestId
              ]
            );
            return inserted.length === 1;
          })
        )
      );
      return yield* controls3(
        sql.withTransaction(
          Effect25.gen(function* () {
            const row = yield* guard4(yield* locked(request.sandbox.sandboxId));
            if (request.requestId.startsWith("auto-") && Number(row.viewer_until) <= Number(row.db_now)) {
              return yield* fail14("sandbox-expired");
            }
            if (row.demo_owned === true) {
              return yield* fail14("capability-unavailable");
            }
            const current = (yield* view2(row, local)).ref;
            return yield* body({
              admission: fresh ? "Fresh" : "Unresolved",
              current,
              dbNow: Number(row.db_now),
              expiresAt: Number(row.expires_at),
              receipt: (req, op) => receipt(req.sandbox, req.requestId, op),
              reserve: (count) => Effect25.gen(function* () {
                if (!Number.isInteger(count) || count < 1 || count > 10) {
                  return yield* fail14("limit-reached");
                }
                const reserved = yield* query(
                  `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+$2::int
              WHERE sandbox_id=$1 AND retained_jobs<=${retainedMaximum2}-$2::int RETURNING sandbox_id`,
                  [current.sandboxId, count]
                );
                if (!reserved.length) {
                  return yield* fail14("limit-reached");
                }
              }),
              associate: (jobId, job) => query(`INSERT INTO ${t.associations} VALUES ($1,$2,$3,$4::jsonb)`, [
                current.sandboxId,
                current.generation,
                jobId,
                JSON.stringify({
                  syntheticActor: job.payload.actor,
                  syntheticTenant: job.payload.tenant,
                  syntheticOrderId: job.payload.order
                })
              ]).pipe(Effect25.asVoid),
              advanceGeneration: (expected) => Effect25.gen(function* () {
                const [capacity] = yield* query(
                  `SELECT retained_jobs,(SELECT count(*) FROM ${t.admission} WHERE sandbox_id=$1) AS admissions FROM ${t.sandboxes} WHERE sandbox_id=$1`,
                  [expected.sandboxId]
                );
                if (Number(capacity.retained_jobs) > retainedMaximum2 - starterCount || Number(capacity.admissions) >= admissionMaximum2) {
                  return yield* fail14("limit-reached");
                }
                const updated = yield* query(
                  `UPDATE ${t.sandboxes} SET generation=generation+1, next_generation_at=${dbTime2}+5000
              WHERE sandbox_id=$1 AND generation=$2 AND generation<9007199254740991 RETURNING *`,
                  [expected.sandboxId, expected.generation]
                );
                if (!updated.length) {
                  return yield* fail14("stale-generation");
                }
                const advanced = (yield* view2(updated[0], local)).ref;
                yield* traffic.ensure(advanced, Number(row.db_now));
                return advanced;
              }),
              saveReceipt: (value3) => query(`INSERT INTO ${t.receipts} VALUES ($1,$2,$3,$4,$5::jsonb)`, [
                request.sandbox.sandboxId,
                request.sandbox.generation,
                operation2,
                request.requestId,
                JSON.stringify(value3)
              ]).pipe(Effect25.asVoid),
              audit: (entry) => query(`INSERT INTO ${t.audit} VALUES ($1,$2,$3,$4,$5,${dbTime2})`, [
                current.sandboxId,
                current.generation,
                entry.operation,
                entry.reason,
                entry.count
              ]).pipe(Effect25.asVoid)
            });
          })
        )
      );
    }),
    lookup: (access, request, operation2) => controls3(
      sql.withTransaction(
        Effect25.gen(function* () {
          if (request.sandbox.sandboxId !== access.sandbox.ref.sandboxId) {
            return yield* fail14("not-found");
          }
          const row = yield* guard4(yield* locked(request.sandbox.sandboxId));
          if (request.sandbox.generation > Number(row.generation)) {
            return yield* fail14("stale-generation");
          }
          return yield* receipt(request.sandbox, request.requestId, operation2);
        })
      )
    )
  });
  return { authority, transactions };
});
var transactionsLayerNoDeps = (schema) => Layer9.effect(
  CommandTransactions,
  make20(schema).pipe(Effect25.map((services) => services.transactions))
);

// apps/playground-worker/src/persistence/commands/Persistence.ts
import { Cause as Cause7, Effect as Effect26, Layer as Layer10, Schema as Schema22 } from "effect";
import { EpochMillis as EpochMillis5 } from "effect-jobs/JobPolicy";
import { JobBackendError, JobEnqueue as JobEnqueue2 } from "effect-jobs/JobEnqueue";
var fail15 = (code) => new PlaygroundError({ code });
var decode6 = (schema, input, code = "invalid-request") => Schema22.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
  Effect26.mapError(() => fail15(code))
);
var sanitizeCause = (cause) => Cause7.fromReasons(
  cause.reasons.map((reason) => {
    if (Cause7.isInterruptReason(reason)) {
      return reason;
    }
    if (Cause7.isDieReason(reason)) {
      return Cause7.makeDieReason(new Error("Command persistence defect"));
    }
    return Cause7.makeFailReason(
      fail15(reason.error instanceof PlaygroundError ? reason.error.code : "unavailable")
    );
  })
);
var recoverMutation = (cause, unknown3, producer3 = false) => {
  const reason = cause.reasons.length === 1 ? cause.reasons[0] : void 0;
  if (reason !== void 0 && Cause7.isFailReason(reason) && (reason.error instanceof CommandTransactionFailure || producer3 && reason.error instanceof JobBackendError) && reason.error.commitKnowledge === "Unknown") {
    return Effect26.succeed(unknown3);
  }
  return Effect26.failCause(sanitizeCause(cause));
};
var sameRef3 = (a, b) => a.sandboxId === b.sandboxId && a.generation === b.generation;
var guard3 = Effect26.fnUntraced(function* (access, expected, tx) {
  const current = yield* decode6(SandboxRef, tx.current, "unavailable");
  yield* decode6(EpochMillis5, tx.dbNow, "unavailable");
  yield* decode6(EpochMillis5, tx.expiresAt, "unavailable");
  if (current.sandboxId !== access.sandbox.ref.sandboxId || expected.sandboxId !== current.sandboxId) {
    return yield* fail15("not-found");
  }
  if (tx.expiresAt <= tx.dbNow) {
    return yield* fail15("sandbox-expired");
  }
  if (expected.generation > current.generation) {
    return yield* fail15("stale-generation");
  }
  return current;
});
var validateReceipt = Effect26.fnUntraced(function* (raw, request, operation2) {
  const receipt = yield* decode6(StoredReceipt, raw, "unavailable");
  const ref = receipt.result._tag === "Committed" && receipt._tag === "Scenario" ? receipt.result.sandbox : receipt._tag === "Reset" ? receipt.result.previous : receipt.command.sandbox;
  if (receipt._tag !== operation2 || receipt.result._tag !== "Committed" || receipt.command.requestId !== request.requestId || receipt.result.requestId !== request.requestId || !sameRef3(receipt.command.sandbox, request.sandbox) || !sameRef3(ref, request.sandbox)) {
    return yield* fail15("unavailable");
  }
  if (receipt._tag === "Scenario" && receipt.result.jobIds.length !== receipt.command.count) {
    return yield* fail15("unavailable");
  }
  return receipt;
});
var make21 = Effect26.gen(function* () {
  const transactions = yield* CommandTransactions;
  const producer3 = yield* JobEnqueue2;
  const keys2 = yield* DocumentKeys;
  const enqueue2 = (job) => enqueue(job).pipe(
    Effect26.provideService(JobEnqueue2, producer3),
    Effect26.provideService(DocumentKeys, keys2)
  );
  const run3 = Effect26.fn("Commands.persistScenario")(function* (access, input) {
    const command = yield* decode6(ScenarioCommand, input);
    return yield* transactions.owned(
      access,
      command,
      "Scenario",
      (tx) => Effect26.gen(function* () {
        const current = yield* guard3(access, command.sandbox, tx);
        const stored = yield* tx.receipt(command, "Scenario");
        if (stored !== null) {
          const receipt = yield* validateReceipt(stored, command, "Scenario");
          if (receipt._tag !== "Scenario" || receipt.command.scenario !== command.scenario || receipt.command.count !== command.count) {
            return yield* fail15("invalid-request");
          }
          return receipt.result;
        }
        if (!sameRef3(current, command.sandbox)) {
          return yield* fail15("stale-generation");
        }
        if (tx.admission === "Unresolved") {
          return {
            _tag: "OutcomeUnknown",
            sandbox: command.sandbox,
            requestId: command.requestId
          };
        }
        const jobs = yield* plan(
          command,
          current,
          0,
          command.scenario === "delayed-success" ? tx.dbNow + 12e4 : void 0
        ).pipe(Effect26.mapError(() => fail15("invalid-request")));
        yield* tx.reserve(jobs.length);
        const jobIds = [];
        for (const job of jobs) {
          const produced = yield* enqueue2(job);
          if (command.scenario === "deduplication") {
            const duplicate = yield* enqueue2(job);
            if (duplicate.jobId !== produced.jobId || duplicate._tag !== "AlreadyPresent") {
              return yield* fail15("unavailable");
            }
          }
          yield* tx.associate(produced.jobId, job);
          jobIds.push(produced.jobId);
        }
        const result3 = yield* decode6(
          ScenarioResult.members[0],
          {
            _tag: "Committed",
            sandbox: command.sandbox,
            requestId: command.requestId,
            jobIds
          },
          "unavailable"
        );
        yield* tx.audit({
          operation: "Scenario",
          reason: "synthetic-scenario",
          count: jobs.length
        });
        yield* tx.saveReceipt({ _tag: "Scenario", command, result: result3 });
        return result3;
      })
    ).pipe(
      Effect26.catchCause(
        (cause) => recoverMutation(
          cause,
          {
            _tag: "OutcomeUnknown",
            sandbox: command.sandbox,
            requestId: command.requestId
          },
          true
        )
      )
    );
  });
  const reset = Effect26.fn("Commands.persistReset")(function* (access, input) {
    const command = yield* decode6(ResetCommand, input);
    return yield* transactions.owned(
      access,
      command,
      "Reset",
      (tx) => Effect26.gen(function* () {
        const current = yield* guard3(access, command.sandbox, tx);
        const stored = yield* tx.receipt(command, "Reset");
        if (stored !== null) {
          const receipt = yield* validateReceipt(stored, command, "Reset");
          if (receipt._tag !== "Reset") {
            return yield* fail15("unavailable");
          }
          return receipt.result;
        }
        if (!sameRef3(current, command.sandbox)) {
          return yield* fail15("stale-generation");
        }
        if (tx.admission === "Unresolved") {
          return {
            _tag: "OutcomeUnknown",
            previous: command.sandbox,
            requestId: command.requestId
          };
        }
        if (current.generation === Number.MAX_SAFE_INTEGER) {
          return yield* fail15("limit-reached");
        }
        const advanced = yield* tx.advanceGeneration(command.sandbox);
        const result3 = yield* decode6(
          ResetResult,
          {
            _tag: "Committed",
            previous: command.sandbox,
            current: advanced,
            requestId: command.requestId
          },
          "unavailable"
        );
        yield* tx.audit({
          operation: "Reset",
          reason: "generation-revocation",
          count: 0
        });
        yield* tx.saveReceipt({ _tag: "Reset", command, result: result3 });
        return result3;
      })
    ).pipe(
      Effect26.catchCause(
        (cause) => recoverMutation(cause, {
          _tag: "OutcomeUnknown",
          previous: command.sandbox,
          requestId: command.requestId
        })
      )
    );
  });
  const lookup3 = (operation2, access, input) => Effect26.gen(function* () {
    const request = yield* decode6(ReceiptRequest, input);
    if (request.sandbox.sandboxId !== access.sandbox.ref.sandboxId) {
      return yield* fail15("not-found");
    }
    if (request.sandbox.generation > access.sandbox.ref.generation) {
      return yield* fail15("stale-generation");
    }
    const raw = yield* transactions.lookup(access, request, operation2).pipe(Effect26.catchCause((cause) => Effect26.failCause(sanitizeCause(cause))));
    if (raw === null) {
      return null;
    }
    return yield* validateReceipt(raw, request, operation2);
  });
  return CommandPersistence.of({
    run: run3,
    reset,
    scenarioReceipt: Effect26.fn("Commands.scenarioReceipt")(function* (access, request) {
      const receipt = yield* lookup3("Scenario", access, request);
      if (receipt === null) {
        return {
          _tag: "OutcomeUnknown",
          sandbox: request.sandbox,
          requestId: request.requestId
        };
      }
      if (receipt._tag !== "Scenario") {
        return yield* fail15("unavailable");
      }
      return receipt.result;
    }),
    resetReceipt: Effect26.fn("Commands.resetReceipt")(function* (access, request) {
      const receipt = yield* lookup3("Reset", access, request);
      if (receipt === null) {
        return {
          _tag: "OutcomeUnknown",
          previous: request.sandbox,
          requestId: request.requestId
        };
      }
      if (receipt._tag !== "Reset") {
        return yield* fail15("unavailable");
      }
      return receipt.result;
    })
  });
});
var layerNoDeps6 = Layer10.effect(CommandPersistence, make21);

// apps/playground-worker/src/execution/Executor.ts
import { Clock as Clock4, Context as Context16, Effect as Effect31, Layer as Layer13, Schema as Schema24 } from "effect";
import { SqlClient as SqlClient8 } from "effect/sql/SqlClient";
import * as Consumer from "effect-jobs/JobConsumer";
import * as Runtime from "effect-jobs/JobWorkerRuntime";
import * as Worker from "effect-jobs/JobWorker";
import * as Registry from "effect-jobs/JobRegistry";
import { PostgreSqlJobs as PostgreSqlJobs3 } from "effect-jobs/PostgreSqlJobs";
import { JobEnqueue as JobEnqueue3 } from "effect-jobs/JobEnqueue";

// apps/playground-worker/src/scenarios/Handlers.ts
import { Cause as Cause8, Effect as Effect28, Layer as Layer11, Match } from "effect";
import * as FailureCode from "effect-jobs/FailureCode";
import { JobFailures } from "effect-jobs/JobFailure";
import * as Codec3 from "effect-jobs/JobPayloadCodec";

// apps/playground-worker/src/providers/FakeProvider.ts
import { Context as Context14, Data as Data5 } from "effect";
var RetryRejected = class extends Data5.TaggedError("RetryRejected") {
};
var TerminalRejected = class extends Data5.TaggedError("TerminalRejected") {
};
var InvariantViolation = class extends Data5.TaggedError("InvariantViolation") {
};
var ResponseLost = class extends Data5.TaggedError("ResponseLost") {
};
var PayloadConflict = class extends Data5.TaggedError("PayloadConflict") {
};
var LedgerFull = class extends Data5.TaggedError("LedgerFull") {
};
var FakeProvider = class extends Context14.Service()(
  "playground/FakeProvider"
) {
};

// apps/playground-worker/src/scenarios/Handlers.ts
var codes = FailureCode.define({
  rejected: "fake_provider_retry_rejected",
  terminal: "fake_provider_terminal_rejected",
  invariant: "fake_provider_invariant",
  lost: "fake_provider_response_lost",
  conflict: "fake_provider_payload_conflict",
  capacity: "fake_provider_ledger_full",
  codec: "scenario_codec_invalid"
});
var toJobFailure = Match.type().pipe(
  Match.when(
    { _tag: "RetryRejected" },
    () => JobFailures.Retry({ code: codes.rejected })
  ),
  Match.when(
    { _tag: "TerminalRejected" },
    () => JobFailures.Dead({ code: codes.terminal })
  ),
  Match.when(
    { _tag: "InvariantViolation" },
    () => JobFailures.Isolate({ code: codes.invariant })
  ),
  Match.when(
    { _tag: "ResponseLost" },
    () => JobFailures.OutcomeUnknown({ code: codes.lost })
  ),
  Match.when(
    { _tag: "PayloadConflict" },
    () => JobFailures.Isolate({ code: codes.conflict })
  ),
  Match.when({ _tag: "LedgerFull" }, () => JobFailures.Dead({ code: codes.capacity })),
  Match.exhaustive
);
var execute = (workload) => Effect28.fn("Playground.execute")(function* ({
  payload: payload2,
  context: context2
}) {
  const provider = yield* FakeProvider;
  const encoded = yield* Codec3.encodeJobPayload(Payload, payload2).pipe(
    Effect28.catchCause(
      (cause) => Effect28.failCause(
        Cause8.map(cause, () => JobFailures.Isolate({ code: codes.codec }))
      )
    )
  );
  yield* provider.execute({
    sandbox: payload2.sandbox,
    producer: context2.producer,
    workload,
    behavior: payload2.behavior,
    semanticProjection: encoded.semanticProjectionBytes
  }).pipe(
    Effect28.catchCause((cause) => Effect28.failCause(Cause8.map(cause, toJobFailure)))
  );
});
var executeExport = Effect28.fn("Playground.executeExport")(function* ({
  payload: payload2,
  context: context2
}) {
  const provider = yield* FakeProvider;
  if (payload2.document.subject !== payload2.actor || payload2.document.tenant !== payload2.tenant) {
    return yield* Effect28.fail(JobFailures.Isolate({ code: codes.invariant }));
  }
  const encoded = yield* Codec3.encodeJobPayload(ExportPayload, payload2).pipe(
    Effect28.catchCause(
      (cause) => Effect28.failCause(Cause8.map(cause, () => JobFailures.Isolate({ code: codes.codec })))
    )
  );
  yield* provider.execute({
    sandbox: payload2.sandbox,
    producer: context2.producer,
    workload: "private-data-export",
    behavior: payload2.behavior,
    semanticProjection: encoded.semanticProjectionBytes
  }).pipe(Effect28.catchCause((cause) => Effect28.failCause(Cause8.map(cause, toJobFailure))));
});
var executeSyntheticExport = Effect28.fn("Playground.executeSyntheticExport")(
  function* ({ payload: payload2, context: context2 }) {
    const provider = yield* FakeProvider;
    if (payload2.document.subject !== payload2.actor || payload2.document.tenant !== payload2.tenant) {
      return yield* Effect28.fail(JobFailures.Isolate({ code: codes.invariant }));
    }
    const encoded = yield* Codec3.encodeJobPayload(
      SyntheticExportPayload,
      payload2
    ).pipe(
      Effect28.catchCause(
        (cause) => Effect28.failCause(
          Cause8.map(cause, () => JobFailures.Isolate({ code: codes.codec }))
        )
      )
    );
    yield* provider.execute({
      sandbox: payload2.sandbox,
      producer: context2.producer,
      workload: "synthetic-document-export",
      behavior: payload2.behavior,
      semanticProjection: encoded.semanticProjectionBytes
    }).pipe(
      Effect28.catchCause((cause) => Effect28.failCause(Cause8.map(cause, toJobFailure)))
    );
  }
);
var layerNoDeps7 = Layer11.mergeAll(
  WelcomeEmail.handlerLayer(execute("welcome-email"), Codec3.decodeJobPayload),
  ImageProcessing.handlerLayer(
    execute("image-processing"),
    Codec3.decodeJobPayload
  ),
  WebhookDelivery.handlerLayer(
    execute("webhook-delivery"),
    Codec3.decodeJobPayload
  ),
  SyntheticDocumentExport.handlerLayer(
    executeSyntheticExport,
    Codec3.decodeJobPayload
  ),
  PrivateDataExport.handlerLayer(executeExport, Codec3.decodeJobPayload),
  CatalogSync.handlerLayer(execute("catalog-sync"), Codec3.decodeJobPayload),
  SimulatedPayment.handlerLayer(
    execute("simulated-payment"),
    Codec3.decodeJobPayload
  )
);

// apps/playground-worker/src/execution/PostgreSqlProvider.ts
import { Cause as Cause9, Effect as Effect29, Layer as Layer12 } from "effect";
import { SqlClient as SqlClient7 } from "effect/sql/SqlClient";

// apps/playground-worker/src/demo/Traffic.ts
var maxRetainedJobs = 2e4;

// apps/playground-worker/src/execution/PostgreSqlProvider.ts
var make22 = (schema) => Effect29.gen(function* () {
  const sql = yield* SqlClient7;
  const local = yield* LocalPrivate;
  const t = relations(schema);
  return FakeProvider.of({
    execute: (command) => Effect29.gen(function* () {
      const projection = new Uint8Array(command.semanticProjection);
      const signature = yield* Effect29.tryPromise({
        try: async () => JSON.stringify([
          command.workload,
          command.behavior,
          Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", projection))
          )
        ]),
        catch: () => new InvariantViolation()
      });
      const outcome = yield* sql.withTransaction(
        Effect29.gen(function* () {
          const rows = yield* sql.unsafe(
            `SELECT *
          FROM ${t.sandboxes} WHERE sandbox_id=$1 FOR UPDATE`,
            [command.sandbox.sandboxId]
          );
          const sandbox = rows[0];
          const [clock2] = yield* sql.unsafe(
            "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now"
          );
          if (!sandbox || Number(sandbox.generation) !== command.sandbox.generation || Number(sandbox.expires_at) <= Number(clock2.now)) {
            return new InvariantViolation();
          }
          const jobs = yield* sql.unsafe(
            `SELECT j.id FROM ${t.jobs} j JOIN ${t.associations} a ON a.job_id=j.id
          WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.operation=$3 AND j.operation_id=$4 AND j.slot=$5 AND j.kind=$6`,
            [
              command.sandbox.sandboxId,
              command.sandbox.generation,
              command.producer.operation,
              command.producer.operationId,
              command.producer.slot,
              `playground.${command.workload}`
            ]
          );
          const job = jobs[0];
          if (!job) {
            return new InvariantViolation();
          }
          const existing = (yield* sql.unsafe(
            `SELECT * FROM ${t.ledger} WHERE job_id=$1`,
            [job.id]
          ))[0];
          if (existing && existing.signature !== signature) {
            return new PayloadConflict();
          }
          if (!existing) {
            const size = (yield* sql.unsafe(
              `SELECT count(*) AS n FROM ${t.ledger} WHERE sandbox_id=$1`,
              [command.sandbox.sandboxId]
            ))[0].n;
            if (Number(size) >= (sandbox.demo_owned === true ? maxRetainedJobs : retainedMaximum(local))) {
              return new LedgerFull();
            }
          }
          const invocations = Math.min(
            Number(existing?.invocations ?? 0) + 1,
            1e6
          );
          const alreadyAccepted = existing?.accepted === true;
          const accepted = alreadyAccepted || command.behavior !== "dead" && command.behavior !== "isolated" && !(command.behavior === "retry-then-success" && invocations === 1);
          yield* sql.unsafe(
            `INSERT INTO ${t.ledger} VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (sandbox_id,generation,job_id) DO UPDATE SET accepted=EXCLUDED.accepted,invocations=EXCLUDED.invocations`,
            [
              command.sandbox.sandboxId,
              command.sandbox.generation,
              job.id,
              signature,
              accepted,
              invocations
            ]
          );
          if (alreadyAccepted) {
            return void 0;
          }
          switch (command.behavior) {
            case "success":
              return void 0;
            case "retry-then-success":
              return invocations === 1 ? new RetryRejected() : void 0;
            case "dead":
              return new TerminalRejected();
            case "isolated":
              return new InvariantViolation();
            case "accepted-response-lost":
              return new ResponseLost();
          }
        })
      ).pipe(
        Effect29.catchCause(
          (cause) => Effect29.failCause(Cause9.map(cause, () => new ResponseLost()))
        )
      );
      if (outcome) {
        return yield* Effect29.fail(outcome);
      }
    }),
    // Mock observation DTO has source="mock"; a durable ledger must not impersonate it.
    inspect: () => Effect29.succeed(void 0)
  });
});
var layerNoDeps8 = (schema) => Layer12.effect(FakeProvider, make22(schema));

// apps/playground-worker/src/cloudflare/WakeCycle.ts
import { Clock as Clock3, Context as Context15, Effect as Effect30, Schema as Schema23 } from "effect";
import * as JobWorkerRuntime from "effect-jobs/JobWorkerRuntime";
var Delay = Schema23.Int.pipe(
  Schema23.check(Schema23.isBetween({ minimum: 0, maximum: 36e5 }))
);
var WakeSnapshot = Schema23.Struct({
  expiresInMillis: Delay,
  dueInMillis: Schema23.NullOr(Delay),
  recoveryInMillis: Schema23.NullOr(Delay)
});
var WakeUnavailable = class extends Schema23.TaggedError()(
  "WakeUnavailable",
  {}
) {
};
var WakeSchedule = class extends Context15.Service()("playground/cloudflare/WakeSchedule") {
};
var WakeAlarm = class extends Context15.Service()("playground/cloudflare/WakeAlarm") {
};
var limits2 = Object.freeze({
  cycleMillis: 5e3,
  backlogMillis: 100,
  backoffMillis: 1e3,
  repairMillis: 3e4,
  claimLimit: 10,
  recoveryLimit: 10,
  concurrency: 2
});

// apps/playground-worker/src/execution/Executor.ts
var limits3 = Object.freeze({
  cycleMillis: 5e3,
  generationMillis: 5e3,
  repairMillis: 5e3,
  claimLimit: 10,
  recoveryLimit: 10,
  concurrency: 2
});
var queueNames = [
  "playground-communications",
  "playground-media",
  "playground-commerce",
  "playground-private"
];
var ExecutionHints = class extends Context16.Service()("playground/ExecutionHints") {
};
var ExecutionDeadline = class extends Schema24.TaggedError()(
  "ExecutionDeadline",
  {}
) {
};
var consumers = Effect31.forEach(
  queueNames,
  (name2) => Consumer.make(
    definitions.find((definition2) => definition2.queue.name === name2).queue,
    {
      localConcurrency: limits3.concurrency,
      claimLimitPerRun: limits3.claimLimit,
      recoveryLimitPerRun: limits3.recoveryLimit
    }
  )
);
var workerLayerNoDeps = (schema) => Layer13.unwrap(
  Effect31.gen(function* () {
    const backend = yield* PostgreSqlJobs3;
    return Worker.layer(backend.store, {
      catalog: definitions,
      operationResponseBudgetMillis: 500
    }).pipe(
      Layer13.provide(layerNoDeps7),
      Layer13.provide(Registry.layer),
      Layer13.provide(layerNoDeps8(schema))
    );
  })
);

// apps/website/src/server/read/PostgreSqlRead.ts
import { Cause as Cause10, Context as Context18, Effect as Effect34, Layer as Layer15, Schema as Schema28 } from "effect";

// packages/playground-contracts/dist/Jobs.js
import { Schema as Schema25 } from "effect";
import { JobId as JobId4 } from "effect-jobs/JobId";
import { CatalogIdentity as CatalogIdentity2, ProducerIdentity } from "effect-jobs/JobIdentity";
import { Counter as Counter3, JobState as JobState2 } from "effect-jobs/JobLifecycle";
import { EpochMillis as EpochMillis6, PersistedJobPolicy } from "effect-jobs/JobPolicy";
import { FailureCode as FailureCode2 } from "effect-jobs/JobFailure";
var Cursor = Schema25.String.pipe(Schema25.check(Schema25.isMinLength(1), Schema25.isMaxLength(1024)));
var JobFilters = Schema25.Struct({
  state: Schema25.optional(JobState2),
  kind: Schema25.optional(CatalogIdentity2.fields.kind),
  resolution: Schema25.optional(JobResolutionState),
  needsAttention: Schema25.optional(Schema25.Literal(true))
});
var ListJobs = Schema25.Struct({
  sandbox: SandboxRef,
  filters: JobFilters,
  cursor: Schema25.optional(Cursor),
  limit: Schema25.Int.pipe(Schema25.check(Schema25.isBetween({ minimum: 1, maximum: 50 })))
});
var JobSummary = Schema25.Struct({
  jobId: JobId4,
  catalog: CatalogIdentity2,
  state: JobState2,
  availableAt: EpochMillis6,
  updatedAt: EpochMillis6,
  completedAt: Schema25.NullOr(EpochMillis6),
  attemptsMade: Counter3,
  stalledCount: Counter3,
  lifecycleVersion: Counter3,
  lastFailureCode: Schema25.NullOr(FailureCode2)
}).pipe(Schema25.check(Schema25.makeFilter((job) => (job.state === "Completed" || job.state === "Dead" || job.state === "Cancelled") === (job.completedAt !== null))));
var JobStats = Schema25.Struct({
  total: Counter3,
  Pending: Counter3,
  RetryScheduled: Counter3,
  Active: Counter3,
  Completed: Counter3,
  Dead: Counter3,
  Cancelled: Counter3,
  Isolated: Counter3
}).pipe(Schema25.check(Schema25.makeFilter((stats) => stats.total === stats.Pending + stats.RetryScheduled + stats.Active + stats.Completed + stats.Dead + stats.Isolated + stats.Cancelled)));
var JobAttentionStats = Schema25.Struct({
  Open: Counter3,
  InProgress: Counter3,
  Resolved: Counter3,
  needsAttention: Counter3
}).pipe(Schema25.check(Schema25.makeFilter((s) => s.needsAttention === s.Open + s.InProgress)));
var JobPage = Schema25.Struct({
  sandbox: SandboxRef,
  items: Schema25.Array(JobSummary).pipe(Schema25.check(Schema25.isMaxLength(50))),
  nextCursor: Schema25.NullOr(Cursor),
  // Matching rows before the cursor predicate, from the same scoped SQL snapshot.
  filteredTotal: Counter3,
  stats: JobStats,
  attentionStats: JobAttentionStats
});
var JobDetailRequest = Schema25.Struct({ sandbox: SandboxRef, jobId: JobId4 });
var ApplicationRelations = Schema25.Struct({
  syntheticOrderId: Schema25.optional(Schema25.Literals(["demo-order-a", "demo-order-b"])),
  syntheticActor: Schema25.optional(Schema25.Literal("demo-customer")),
  syntheticTenant: Schema25.optional(Schema25.Literals(["demo-tenant-a", "demo-tenant-b"]))
});
var Observation = Schema25.Struct({
  source: Schema25.Literals(["mock", "local", "workerd", "hosted"]),
  observedAt: EpochMillis6,
  outcome: Schema25.Literals(["success", "retry", "dead", "isolated", "unknown"])
});
var JobRedriveKind = Schema25.Literals(["Redrive", "CorrectedRedrive"]);
var JobLineage = Schema25.Struct({
  originalSourceJobId: JobId4,
  sourceJobId: Schema25.NullOr(JobId4),
  kind: JobRedriveKind
});
var JobPayloadView = Schema25.Union([
  Schema25.TaggedStruct("Available", {
    formatVersion: Schema25.Literal(1),
    catalog: CatalogIdentity2,
    encoded: JsonValue,
    validation: Schema25.Literal("Valid"),
    encryption: Schema25.Literals(["None", "PrivateDocumentV1", "SyntheticDocumentV1"])
  }),
  Schema25.TaggedStruct("Unavailable", {
    reason: Schema25.Literals(["not-stored", "invalid-artifact", "unsupported-catalog"])
  })
]);
var JobHistoryItem = Schema25.Union([
  Schema25.TaggedStruct("Snapshot", { job: JobSummary, observedAt: EpochMillis6 }),
  Schema25.TaggedStruct("Operator", {
    requestId: RequestId,
    action: Schema25.Literals(["retry-now", "cancel", "redrive", "corrected-redrive"]),
    sourceJobId: JobId4,
    resultJobId: JobId4,
    observedAt: EpochMillis6
  }),
  Schema25.TaggedStruct("Resolution", {
    rootJobId: JobId4,
    state: JobResolutionState,
    kind: Schema25.Literals([
      "SuccessorCompleted",
      "OperatorReconciled",
      "ManualClose",
      "Reopened"
    ]),
    reason: Schema25.NullOr(Reason),
    observedAt: EpochMillis6
  })
]);
var JobHistory = Schema25.Struct({
  coverage: Schema25.Literal("RetainedFacts"),
  attempts: Schema25.Null,
  items: Schema25.Array(JobHistoryItem).pipe(Schema25.check(Schema25.isMaxLength(50))),
  nextCursor: Schema25.NullOr(Cursor)
});
var JobRelatedItem = Schema25.Struct({
  jobId: JobId4,
  state: Schema25.NullOr(JobState2),
  kind: Schema25.NullOr(JobRedriveKind),
  sourceAvailable: Schema25.Boolean
});
var JobRelatedPage = Schema25.Struct({
  items: Schema25.Array(JobRelatedItem).pipe(Schema25.check(Schema25.isMaxLength(50))),
  nextCursor: Schema25.NullOr(Cursor)
});
var JobDetailPageRequest = Schema25.Struct({
  sandbox: SandboxRef,
  jobId: JobId4,
  cursor: Schema25.optional(Cursor),
  limit: Schema25.Int.pipe(Schema25.check(Schema25.isBetween({ minimum: 1, maximum: 50 })))
});
var JobProblemRow = Schema25.Struct({
  problem: JobProblem,
  representative: Schema25.NullOr(JobSummary)
});
var JobProblemPage = Schema25.Struct({
  sandbox: SandboxRef,
  items: Schema25.Array(JobProblemRow).pipe(Schema25.check(Schema25.isMaxLength(50))),
  nextCursor: Schema25.NullOr(Cursor),
  filteredTotal: Counter3,
  stats: JobStats,
  attentionStats: JobAttentionStats
});
var repairEligibility = Schema25.Struct({
  enabled: Schema25.Boolean,
  reason: Schema25.NullOr(JobRepairReason)
});
var JobDetail = Schema25.Struct({
  sandbox: SandboxRef,
  job: JobSummary,
  producer: ProducerIdentity,
  policy: PersistedJobPolicy,
  relations: ApplicationRelations,
  observation: Schema25.optional(Observation),
  createdAt: Schema25.Null,
  payload: JobPayloadView,
  result: Schema25.TaggedStruct("Unavailable", { reason: Schema25.Literal("not-stored") }),
  history: JobHistory,
  provider: Schema25.NullOr(Schema25.Struct({
    source: Schema25.Literal("synthetic-postgresql"),
    accepted: Schema25.Boolean,
    invocations: Counter3,
    observedAt: Schema25.Null
  })),
  lineage: Schema25.NullOr(JobLineage),
  problem: Schema25.NullOr(JobProblem),
  related: JobRelatedPage,
  eligibility: Schema25.Struct({
    redrive: repairEligibility,
    correctedRedrive: repairEligibility
  })
});

// apps/playground-worker/src/persistence/read/Queries.ts
var identifier = (name2) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(name2)) {
    throw new Error("Invalid read mapping identifier");
  }
  return `"${name2}"`;
};
var summary = `jsonb_build_object(
  'jobId',j.id,'catalog',jsonb_build_object('queue',j.queue,'kind',j.kind,'version',j.version),
  'state',j.state,'availableAt',j.available_at,'updatedAt',j.updated_at,
  'completedAt',j.completed_at,'attemptsMade',j.attempts_made,
  'stalledCount',j.stalled_count,'lifecycleVersion',j.lifecycle_version,
  'lastFailureCode',j.last_failure_code)`;
var make24 = (mapping2) => {
  const schema = identifier(mapping2.schema);
  const jobs = `${schema}.${identifier(mapping2.jobsTable)}`;
  const sandboxes = `${schema}.${identifier(mapping2.sandboxesTable)}`;
  const associations = `${schema}.${identifier(mapping2.associationsTable)}`;
  const payloads = `${schema}.${identifier(mapping2.payloadsTable ?? "job_payloads")}`;
  const problems = `${schema}."job_problems"`;
  const members = `${schema}."job_repair_members"`;
  const audit = `${schema}."repair_audit"`;
  const receipts = `${schema}."command_receipts"`;
  const ledger = `${schema}."provider_ledger"`;
  if ((/* @__PURE__ */ new Set([mapping2.jobsTable, mapping2.sandboxesTable, mapping2.associationsTable])).size !== 3) {
    throw new Error("Read mapping tables must differ");
  }
  const authority = `WITH authority AS MATERIALIZED (
    SELECT CASE WHEN expires_at <= floor(extract(epoch FROM clock_timestamp())*1000)::bigint
      THEN 'sandbox-expired' WHEN generation <> $2 THEN 'stale-generation' ELSE 'ok' END AS status
    FROM ${sandboxes} WHERE sandbox_id=$1
  ), status AS (
    SELECT coalesce((SELECT status FROM authority),'sandbox-expired') AS code
  )`;
  const scoped3 = `FROM ${associations} a JOIN ${jobs} j ON j.id=a.job_id
    WHERE a.sandbox_id=$1 AND a.generation=$2 AND (SELECT code FROM status)='ok'`;
  const roots = `, retained AS MATERIALIZED (
    SELECT j.*,a.relations ${scoped3}
  ), recorded AS MATERIALIZED (
    SELECT p.root_job_id,p.problem,tip.state AS tip_state,tip.updated_at AS tip_updated_at
    FROM ${problems} p LEFT JOIN retained tip ON tip.id=p.problem->>'activeSuccessorJobId'
    WHERE p.sandbox_id=$1 AND p.generation=$2 AND (SELECT code FROM status)='ok'
  ), effective AS MATERIALIZED (
    SELECT root_job_id,CASE WHEN problem->>'state'='InProgress' AND
      (tip_state IS NULL OR tip_state IN ('Completed','Dead','Isolated','Cancelled'))
      THEN problem || jsonb_build_object('state',CASE WHEN tip_state='Completed' AND problem->>'outcomeKnowledge'='KnownFailure' THEN 'Resolved' ELSE 'Open' END,
        'version',(problem->>'version')::bigint+1,'updatedAt',coalesce(tip_updated_at,floor(extract(epoch FROM clock_timestamp())*1000)::bigint),
        'resolution',CASE WHEN tip_state='Completed' AND problem->>'outcomeKnowledge'='KnownFailure' THEN
          jsonb_build_object('kind','SuccessorCompleted','reason',NULL,'successorJobId',problem->>'activeSuccessorJobId','observedAt',tip_updated_at) ELSE NULL END)
      ELSE problem END AS problem FROM recorded
    UNION ALL
    SELECT j.id,jsonb_build_object('rootJobId',j.id,'state','Open','version',0,'updatedAt',j.updated_at,
       'activeSuccessorJobId',NULL,'outcomeKnowledge',CASE WHEN j.state='Dead' AND j.last_failure_code IN ('fake_provider_terminal_rejected','fake_provider_retry_rejected') AND EXISTS(SELECT 1 FROM ${ledger} l WHERE l.sandbox_id=$1 AND l.generation=$2 AND l.job_id=j.id AND l.accepted=false AND l.invocations>0) THEN 'KnownFailure' ELSE 'Unknown' END,'resolution',NULL)
    FROM retained j WHERE j.state IN ('Dead','Isolated')
      AND NOT EXISTS(SELECT 1 FROM ${members} m WHERE m.sandbox_id=$1 AND m.generation=$2 AND m.job_id=j.id)
      AND NOT EXISTS(SELECT 1 FROM recorded p WHERE p.root_job_id=j.id)
  ), representatives AS MATERIALIZED (
    SELECT e.root_job_id,e.problem,coalesce(
      (SELECT id FROM retained WHERE id=e.problem->>'activeSuccessorJobId'),
      (SELECT id FROM retained WHERE id=e.root_job_id),
      (SELECT j.id FROM ${members} m JOIN retained j ON j.id=m.job_id WHERE m.sandbox_id=$1 AND m.generation=$2 AND m.root_job_id=e.root_job_id ORDER BY j.id COLLATE "C" LIMIT 1)
    ) AS representative_id FROM effective e
  ), attention AS (
    SELECT jsonb_build_object('Open',count(*) FILTER(WHERE problem->>'state'='Open'),
      'InProgress',count(*) FILTER(WHERE problem->>'state'='InProgress'),
      'Resolved',count(*) FILTER(WHERE problem->>'state'='Resolved'),
      'needsAttention',count(*) FILTER(WHERE problem->>'state' IN ('Open','InProgress'))) AS stats FROM effective
  )`;
  const totals = `, totals AS (
    SELECT jsonb_build_object('total',count(*),
      'Pending',count(*) FILTER(WHERE j.state='Pending'),
      'RetryScheduled',count(*) FILTER(WHERE j.state='RetryScheduled'),
      'Active',count(*) FILTER(WHERE j.state='Active'),
      'Completed',count(*) FILTER(WHERE j.state='Completed'),
      'Cancelled',count(*) FILTER(WHERE j.state='Cancelled'),
      'Dead',count(*) FILTER(WHERE j.state='Dead'),
      'Isolated',count(*) FILTER(WHERE j.state='Isolated')) AS stats FROM retained j
  )`;
  const refValues = (ref) => [ref.sandboxId, ref.generation];
  const related = `SELECT m.job_id AS id,jsonb_build_object('jobId',m.job_id,'state',j.state,
      'kind',coalesce(j.redrive_kind,(SELECT CASE WHEN e.action='redrive' THEN 'Redrive' ELSE 'CorrectedRedrive' END FROM ${schema}."job_repairs" e WHERE e.sandbox_id=$1 AND e.generation=$2 AND e.result_job_id=m.job_id),
      (SELECT 'Redrive' FROM ${schema}."operator_redrives" e WHERE e.sandbox_id=$1 AND e.generation=$2 AND e.original_successor_job_id=m.job_id)),
      'sourceAvailable',j.id IS NOT NULL) AS item
    FROM ${members} m LEFT JOIN retained j ON j.id=m.job_id
    WHERE m.sandbox_id=$1 AND m.generation=$2 AND m.root_job_id=coalesce(
      (SELECT root_job_id FROM ${members} WHERE sandbox_id=$1 AND generation=$2 AND job_id=$3),$3)
      AND m.job_id<>$3`;
  const facts = `, facts AS MATERIALIZED (
    SELECT lpad(j.updated_at::text,15,'0')||':~snapshot' AS id,jsonb_build_object('_tag','Snapshot','job',${summary},'observedAt',j.updated_at) AS item
    FROM retained j WHERE j.id=$3
    UNION ALL
    SELECT lpad((r.receipt->'result'->>'observedAt'),15,'0')||':'||r.request_id||':'||(r.receipt->'result'->>'action'),
      jsonb_build_object('_tag','Operator','requestId',r.request_id,'action',r.receipt->'result'->>'action',
        'sourceJobId',r.receipt->'result'->>'sourceJobId','resultJobId',r.receipt->'result'->>'resultJobId',
        'observedAt',(r.receipt->'result'->>'observedAt')::bigint)
    FROM ${receipts} r WHERE r.sandbox_id=$1 AND r.generation=$2 AND r.operation='Operator' AND r.receipt->'result'->>'_tag'='Committed'
      AND (r.receipt->'result'->>'sourceJobId'=$3 OR r.receipt->'result'->>'resultJobId'=$3)
    UNION ALL
    SELECT lpad(a.observed_at::text,15,'0')||':'||a.identity||':'||a.action,
      a.fact - ARRAY['repairReason','operatorCategory','investigation','changes','validation']::text[]
    FROM ${audit} a WHERE a.sandbox_id=$1 AND a.generation=$2 AND a.root_job_id=coalesce(
      (SELECT root_job_id FROM ${members} WHERE sandbox_id=$1 AND generation=$2 AND job_id=$3),$3)
  )`;
  return {
    list: (ref, request, after) => ({
      text: `${authority}${roots}${totals}, page AS (
        SELECT j.id,${summary} AS item FROM retained j
        WHERE ($3::text IS NULL OR j.state=$3) AND ($4::text IS NULL OR j.kind=$4)
          AND ($5::text IS NULL OR j.id COLLATE "C">$5 COLLATE "C") ORDER BY j.id COLLATE "C" LIMIT $6
      ), filtered AS (
        SELECT count(*) AS n FROM retained j WHERE ($3::text IS NULL OR j.state=$3) AND ($4::text IS NULL OR j.kind=$4)
      ) SELECT (SELECT code FROM status) AS status,(SELECT stats FROM totals) AS stats,
        (SELECT stats FROM attention) AS "attentionStats",(SELECT n FROM filtered)::double precision AS "filteredTotal",
        coalesce(jsonb_agg(item ORDER BY id COLLATE "C"),'[]'::jsonb) AS items FROM page`,
      values: [
        ...refValues(ref),
        request.filters.state ?? null,
        request.filters.kind ?? null,
        after,
        request.limit + 1
      ]
    }),
    problems: (ref, request, after) => ({
      text: `${authority}${roots}${totals}, filtered AS MATERIALIZED (
        SELECT r.root_job_id,jsonb_build_object('problem',r.problem,'representative',CASE WHEN j.id IS NULL THEN NULL ELSE ${summary} END) AS item
        FROM representatives r LEFT JOIN retained j ON j.id=r.representative_id
        WHERE ($3::text IS NULL OR j.state=$3) AND ($4::text IS NULL OR j.kind=$4)
          AND ($5::text IS NULL OR r.problem->>'state'=$5)
          AND (NOT $6::boolean OR r.problem->>'state' IN ('Open','InProgress'))
      ), page AS (
        SELECT * FROM filtered WHERE ($7::text IS NULL OR root_job_id COLLATE "C">$7 COLLATE "C") ORDER BY root_job_id COLLATE "C" LIMIT $8
      ) SELECT (SELECT code FROM status) AS status,(SELECT stats FROM totals) AS stats,(SELECT stats FROM attention) AS "attentionStats",
        (SELECT count(*) FROM filtered)::double precision AS "filteredTotal",coalesce(jsonb_agg(item ORDER BY root_job_id COLLATE "C"),'[]'::jsonb) AS items FROM page`,
      values: [
        ...refValues(ref),
        request.filters.state ?? null,
        request.filters.kind ?? null,
        request.filters.resolution ?? null,
        request.filters.needsAttention === true,
        after,
        request.limit + 1
      ]
    }),
    detail: (ref, request) => ({
      text: `${authority}${roots}${facts}, related_page AS (${related} ORDER BY m.job_id COLLATE "C" LIMIT 51), history_page AS (SELECT * FROM facts ORDER BY id COLLATE "C" LIMIT 51)
      SELECT (SELECT code FROM status) AS status,(
        SELECT jsonb_build_object('sandbox',jsonb_build_object('sandboxId',$1::text,'generation',$2::bigint),'job',${summary},
          'producer',jsonb_build_object('operation',j.operation,'operationId',j.operation_id,'slot',j.slot),'policy',j.policy,'relations',j.relations)
        FROM retained j WHERE j.id=$3) AS detail,
        (SELECT jsonb_build_object('rootJobId',e.root_job_id,'problem',e.problem) FROM effective e WHERE e.root_job_id=coalesce((SELECT root_job_id FROM ${members} WHERE sandbox_id=$1 AND generation=$2 AND job_id=$3),$3)) AS problem,
        (SELECT jsonb_build_object('accepted',l.accepted,'invocations',l.invocations) FROM ${ledger} l WHERE l.sandbox_id=$1 AND l.generation=$2 AND l.job_id=$3 AND EXISTS(SELECT 1 FROM retained WHERE id=$3)) AS provider,
        (SELECT jsonb_build_object('originalSourceJobId',j.original_source_job_id,'sourceJobId',j.source_job_id,'kind',j.redrive_kind) FROM retained j WHERE j.id=$3 AND j.original_source_job_id IS NOT NULL) AS lineage,
        (SELECT format_version FROM ${payloads} WHERE job_id=$3 AND EXISTS(SELECT 1 FROM retained WHERE id=$3)) AS format_version,
        (SELECT payload FROM ${payloads} WHERE job_id=$3 AND EXISTS(SELECT 1 FROM retained WHERE id=$3)) AS payload,
        (SELECT projection FROM ${payloads} WHERE job_id=$3 AND EXISTS(SELECT 1 FROM retained WHERE id=$3)) AS projection,
        coalesce((SELECT jsonb_agg(item ORDER BY id COLLATE "C") FROM related_page),'[]'::jsonb) AS related,
        coalesce((SELECT jsonb_agg(jsonb_build_object('key',id,'item',item) ORDER BY id COLLATE "C") FROM history_page),'[]'::jsonb) AS history`,
      values: [...refValues(ref), request.jobId]
    }),
    related: (ref, request, after) => ({
      text: `${authority}${roots}, page AS (${related} AND ($4::text IS NULL OR m.job_id COLLATE "C">$4 COLLATE "C") ORDER BY m.job_id COLLATE "C" LIMIT $5)
      SELECT (SELECT code FROM status) AS status,EXISTS(SELECT 1 FROM retained WHERE id=$3) AS found,coalesce(jsonb_agg(item ORDER BY id COLLATE "C"),'[]'::jsonb) AS items FROM page`,
      values: [...refValues(ref), request.jobId, after, request.limit + 1]
    }),
    history: (ref, request, after) => ({
      text: `${authority}${roots}${facts}, page AS (SELECT * FROM facts WHERE ($4::text IS NULL OR id COLLATE "C">$4 COLLATE "C") ORDER BY id COLLATE "C" LIMIT $5)
      SELECT (SELECT code FROM status) AS status,EXISTS(SELECT 1 FROM retained WHERE id=$3) AS found,coalesce(jsonb_agg(jsonb_build_object('key',id,'item',item) ORDER BY id COLLATE "C"),'[]'::jsonb) AS items FROM page`,
      values: [...refValues(ref), request.jobId, after, request.limit + 1]
    })
  };
};

// apps/website/src/server/read/JobDetailsProjection.ts
import { Effect as Effect32, Schema as Schema26 } from "effect";
import * as Codec4 from "effect-jobs/JobPayloadCodec";
var unavailable2 = (reason) => ({ _tag: "Unavailable", reason });
var payload = (detail, row) => Effect32.gen(function* () {
  const catalog = detail.job.catalog;
  const definition2 = definitions.find(
    (entry) => entry.catalog.kind === catalog.kind && entry.catalog.queue === catalog.queue && entry.catalog.version === catalog.version
  );
  if (!definition2) {
    return unavailable2("unsupported-catalog");
  }
  if (row.payload === null || row.payload === void 0) {
    return unavailable2("not-stored");
  }
  const bytes2 = yield* artifact(row);
  const wire = yield* Codec4.decodeJobPayload(
    Schema26.toEncoded(definition2.payload),
    bytes2
  );
  if (wire.sandbox.sandboxId !== detail.sandbox.sandboxId || wire.sandbox.generation !== detail.sandbox.generation) {
    return unavailable2("invalid-artifact");
  }
  let encryption = "None";
  if ("document" in wire) {
    const document = wire.document;
    if (document.ciphertext.length < 16 || !/^[a-f0-9]{64}$/u.test(document.fingerprint)) {
      return unavailable2("invalid-artifact");
    }
    encryption = String(definition2.catalog.kind) === "playground.synthetic-document-export" ? "SyntheticDocumentV1" : "PrivateDocumentV1";
  }
  return {
    _tag: "Available",
    formatVersion: 1,
    catalog,
    encoded: wire,
    validation: "Valid",
    encryption
  };
}).pipe(
  Effect32.catchTag(
    "RepairSourceRejected",
    () => Effect32.succeed(unavailable2("invalid-artifact"))
  ),
  Effect32.catchTag(
    "JobPayloadCodecError",
    () => Effect32.succeed(unavailable2("invalid-artifact"))
  )
);
var eligibility2 = (detail, problem, payloadView) => {
  const selected = definitions.find(
    (entry2) => entry2.catalog.kind === detail.job.catalog.kind && entry2.catalog.queue === detail.job.catalog.queue && entry2.catalog.version === detail.job.catalog.version
  );
  const entry = (reason) => ({ enabled: reason === null, reason });
  const state = detail.job.state;
  const common = state === "Active" ? "active-execution" : state !== "Dead" && state !== "Isolated" ? "not-eligible" : problem?.state === "InProgress" ? "repair-in-progress" : problem?.state === "Resolved" ? "already-resolved" : problem && (problem.activeSuccessorJobId ?? problem.rootJobId) !== detail.job.jobId ? "resolution-conflict" : null;
  const plain = common ?? (payloadView._tag === "Unavailable" ? payloadView.reason === "unsupported-catalog" ? "unsupported-catalog" : "invalid-artifact" : null);
  const correction = common ?? (selected === SyntheticDocumentExport && payloadView._tag === "Unavailable" ? "invalid-artifact" : null) ?? (selected && "document" in selected.payload.fields && selected !== SyntheticDocumentExport || payloadView._tag === "Available" && payloadView.encryption !== "None" && !(selected === SyntheticDocumentExport && payloadView.encryption === "SyntheticDocumentV1") ? "encrypted-correction-unavailable" : payloadView._tag === "Unavailable" && payloadView.reason === "unsupported-catalog" ? "unsupported-catalog" : null);
  return { redrive: entry(plain), correctedRedrive: entry(correction) };
};
var retainedFields = {
  createdAt: null,
  result: { _tag: "Unavailable", reason: "not-stored" }
};

// apps/website/src/server/read/CursorCodec.ts
import { Context as Context17, Effect as Effect33, Layer as Layer14, Schema as Schema27 } from "effect";
var After = Schema27.String.pipe(
  Schema27.check(Schema27.isMinLength(1), Schema27.isMaxLength(128))
);
var Position = Schema27.Union([
  Schema27.Struct({
    version: Schema27.Literal(1),
    sandbox: SandboxRef,
    filters: JobFilters,
    after: After
  }).pipe(
    Schema27.check(
      Schema27.makeFilter(
        (p) => p.filters.resolution === void 0 && p.filters.needsAttention === void 0
      )
    )
  ),
  Schema27.Struct({
    version: Schema27.Literal(2),
    view: Schema27.Literals(["jobs", "problems"]),
    sandbox: SandboxRef,
    filters: JobFilters,
    after: After
  }),
  Schema27.Struct({
    version: Schema27.Literal(2),
    view: Schema27.Literals(["history", "related"]),
    sandbox: SandboxRef,
    jobId: After,
    after: Schema27.String.pipe(
      Schema27.check(Schema27.isMinLength(1), Schema27.isMaxLength(512))
    )
  })
]);
var CursorCodec = class extends Context17.Service()("playground/read/CursorCodec") {
};
var utf8 = new TextEncoder();
var text2 = new TextDecoder("utf-8", { fatal: true });
var encodeBytes = (bytes2) => btoa(String.fromCharCode(...bytes2)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
var decodeBytes = (value3) => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value3)) {
    throw new Error("Invalid cursor encoding");
  }
  const bytes2 = Uint8Array.from(
    atob(value3.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0)
  );
  if (encodeBytes(bytes2) !== value3) {
    throw new Error("Noncanonical cursor encoding");
  }
  return bytes2;
};
var make25 = (key) => {
  const algorithm = key.algorithm;
  if (key.type !== "secret" || algorithm.name !== "HMAC" || algorithm.hash.name !== "SHA-256" || algorithm.length < 256 || !key.usages.includes("sign") || !key.usages.includes("verify")) {
    throw new Error("Cursor key requires HMAC SHA-256 and sign/verify usages");
  }
  return {
    encode: (position) => Schema27.decodeUnknownEffect(Position)(position, { onExcessProperty: "error" }).pipe(
      Effect33.mapError(() => new PlaygroundError({ code: "unavailable" })),
      Effect33.flatMap(
        (decoded) => Effect33.tryPromise({
          try: async () => {
            const body = utf8.encode(JSON.stringify(decoded));
            const signature = await crypto.subtle.sign("HMAC", key, body);
            return `${encodeBytes(body)}.${encodeBytes(new Uint8Array(signature))}`;
          },
          catch: () => new PlaygroundError({ code: "unavailable" })
        })
      ),
      Effect33.flatMap(
        (value3) => Schema27.decodeUnknownEffect(Cursor)(value3).pipe(
          Effect33.mapError(() => new PlaygroundError({ code: "unavailable" }))
        )
      )
    ),
    decode: (cursor) => Schema27.decodeUnknownEffect(Cursor)(cursor).pipe(
      Effect33.mapError(() => new PlaygroundError({ code: "invalid-request" })),
      Effect33.flatMap(
        (cursor2) => Effect33.tryPromise({
          try: async () => {
            const parts = cursor2.split(".");
            if (parts.length !== 2) {
              throw new Error("Invalid cursor");
            }
            const body = decodeBytes(parts[0]);
            const signature = decodeBytes(parts[1]);
            if (signature.byteLength !== 32 || !await crypto.subtle.verify("HMAC", key, signature, body)) {
              throw new Error("Invalid cursor signature");
            }
            return JSON.parse(text2.decode(body));
          },
          catch: () => new PlaygroundError({ code: "invalid-request" })
        }).pipe(
          Effect33.flatMap(
            (value3) => Schema27.decodeUnknownEffect(Position)(value3, {
              onExcessProperty: "error"
            }).pipe(
              Effect33.mapError(() => new PlaygroundError({ code: "invalid-request" }))
            )
          )
        )
      )
    )
  };
};
var layer4 = (key) => Layer14.succeed(CursorCodec, make25(key));

// apps/website/src/server/read/PostgreSqlRead.ts
var ReadDatabase = class extends Context18.Service()("playground/read/ReadDatabase") {
};
var Status = Schema28.Literals(["ok", "sandbox-expired", "stale-generation"]);
var listRows = (item) => Schema28.Array(
  Schema28.Struct({
    status: Status,
    items: Schema28.Array(item).pipe(Schema28.check(Schema28.isMaxLength(51))),
    filteredTotal: JobPage.fields.filteredTotal,
    stats: JobStats,
    attentionStats: JobPage.fields.attentionStats
  })
).pipe(Schema28.check(Schema28.isMinLength(1), Schema28.isMaxLength(1)));
var ListRows = listRows(JobSummary);
var ProblemRows = listRows(JobProblemRow);
var BaseDetail = Schema28.Struct({
  sandbox: JobDetail.fields.sandbox,
  job: JobDetail.fields.job,
  producer: JobDetail.fields.producer,
  policy: JobDetail.fields.policy,
  relations: JobDetail.fields.relations
});
var KeyedHistory = Schema28.Struct({
  key: Schema28.String.pipe(Schema28.check(Schema28.isMaxLength(512))),
  item: JobHistoryItem
});
var DetailRows = Schema28.Array(
  Schema28.Struct({
    status: Status,
    detail: Schema28.NullOr(BaseDetail),
    problem: Schema28.NullOr(
      Schema28.Struct({
        rootJobId: JobSummary.fields.jobId,
        problem: JobDetail.fields.problem
      })
    ),
    provider: Schema28.NullOr(
      Schema28.Struct({
        accepted: Schema28.Boolean,
        invocations: JobSummary.fields.attemptsMade
      })
    ),
    lineage: JobDetail.fields.lineage,
    format_version: Schema28.Unknown,
    payload: Schema28.Unknown,
    projection: Schema28.Unknown,
    related: Schema28.Array(JobRelatedItem).pipe(Schema28.check(Schema28.isMaxLength(51))),
    history: Schema28.Array(KeyedHistory).pipe(Schema28.check(Schema28.isMaxLength(51)))
  })
).pipe(Schema28.check(Schema28.isMinLength(1), Schema28.isMaxLength(1)));
var Subread = Schema28.Struct({
  ...JobDetailRequest.fields,
  cursor: Schema28.optional(Cursor),
  limit: ListJobs.fields.limit
});
var invalid2 = () => new PlaygroundError({ code: "invalid-request" });
var unavailable3 = () => new PlaygroundError({ code: "unavailable" });
var strict = { onExcessProperty: "error" };
var sameRef4 = (left, right) => left.sandboxId === right.sandboxId && left.generation === right.generation;
var authorize = (access, requested) => {
  if (access.sandbox.ref.sandboxId !== requested.sandboxId) {
    return Effect34.fail(new PlaygroundError({ code: "not-found" }));
  }
  if (!sameRef4(access.sandbox.ref, requested)) {
    return Effect34.fail(new PlaygroundError({ code: "stale-generation" }));
  }
  return Effect34.void;
};
var checkStatus = (status) => status === "ok" ? Effect34.void : Effect34.fail(new PlaygroundError({ code: status }));
var unavailableCause = (cause) => Effect34.failCause(Cause10.map(cause, () => new PlaygroundError({ code: "unavailable" })));
var make26 = (mapping2) => Effect34.gen(function* () {
  const database = yield* ReadDatabase;
  const cursor = yield* CursorCodec;
  const queries = make24(mapping2);
  const execute3 = (query) => database.execute(query).pipe(
    Effect34.catchCause(unavailableCause),
    Effect34.timeoutOrElse({
      duration: "2 seconds",
      orElse: () => Effect34.fail(new PlaygroundError({ code: "unavailable" }))
    })
  );
  const position = (request, view3) => Effect34.gen(function* () {
    if (request.cursor === void 0) {
      return null;
    }
    const decoded = yield* cursor.decode(request.cursor);
    if (!sameRef4(decoded.sandbox, request.sandbox) || (decoded.version === 1 ? view3 !== "jobs" : decoded.view !== view3) || !("filters" in decoded) || decoded.filters.state !== request.filters.state || decoded.filters.kind !== request.filters.kind || decoded.filters.resolution !== request.filters.resolution || decoded.filters.needsAttention !== request.filters.needsAttention) {
      return yield* invalid2();
    }
    return decoded.after;
  });
  const list = Effect34.fn("JobsRead.list")(
    function* (access, input) {
      const request = yield* Schema28.decodeUnknownEffect(ListJobs)(input, strict).pipe(
        Effect34.mapError(invalid2)
      );
      if (request.filters.resolution !== void 0 || request.filters.needsAttention !== void 0) {
        return yield* invalid2();
      }
      yield* authorize(access, request.sandbox);
      const after = yield* position(request, "jobs");
      const rows = yield* execute3(
        queries.list(access.sandbox.ref, request, after)
      ).pipe(
        Effect34.flatMap((value3) => Schema28.decodeUnknownEffect(ListRows)(value3, strict)),
        Effect34.catchCause(unavailableCause)
      );
      const row = rows[0];
      yield* checkStatus(row.status);
      const items = row.items.slice(0, request.limit);
      const nextCursor = row.items.length > request.limit ? yield* cursor.encode({
        version: 2,
        view: "jobs",
        sandbox: request.sandbox,
        filters: request.filters,
        after: items.at(-1).jobId
      }) : null;
      return yield* Schema28.decodeUnknownEffect(JobPage)(
        {
          sandbox: request.sandbox,
          items,
          nextCursor,
          filteredTotal: row.filteredTotal,
          stats: row.stats,
          attentionStats: row.attentionStats
        },
        strict
      ).pipe(Effect34.mapError(unavailable3));
    }
  );
  const problems = Effect34.fn(
    "JobsRead.problems"
  )(function* (access, input) {
    const request = yield* Schema28.decodeUnknownEffect(ListJobs)(input, strict).pipe(
      Effect34.mapError(invalid2)
    );
    yield* authorize(access, request.sandbox);
    const after = yield* position(request, "problems");
    const rows = yield* execute3(
      queries.problems(access.sandbox.ref, request, after)
    ).pipe(
      Effect34.flatMap((value3) => Schema28.decodeUnknownEffect(ProblemRows)(value3, strict)),
      Effect34.catchCause(unavailableCause)
    );
    const row = rows[0];
    yield* checkStatus(row.status);
    const items = row.items.slice(0, request.limit);
    const nextCursor = row.items.length > request.limit ? yield* cursor.encode({
      version: 2,
      view: "problems",
      sandbox: request.sandbox,
      filters: request.filters,
      after: items.at(-1).problem.rootJobId
    }) : null;
    return yield* Schema28.decodeUnknownEffect(JobProblemPage)(
      {
        sandbox: request.sandbox,
        items,
        nextCursor,
        filteredTotal: row.filteredTotal,
        stats: row.stats,
        attentionStats: row.attentionStats
      },
      strict
    ).pipe(Effect34.mapError(unavailable3));
  });
  const historyPage = (request, items, limit) => Effect34.gen(function* () {
    const page = items.slice(0, limit);
    const nextCursor = items.length > limit ? yield* cursor.encode({
      version: 2,
      view: "history",
      sandbox: request.sandbox,
      jobId: request.jobId,
      after: page.at(-1).key
    }) : null;
    return {
      coverage: "RetainedFacts",
      attempts: null,
      items: page.map((entry) => entry.item),
      nextCursor
    };
  });
  const relatedPage = (request, items, limit) => Effect34.gen(function* () {
    const page = items.slice(0, limit);
    const nextCursor = items.length > limit ? yield* cursor.encode({
      version: 2,
      view: "related",
      sandbox: request.sandbox,
      jobId: request.jobId,
      after: page.at(-1).jobId
    }) : null;
    return { items: page, nextCursor };
  });
  const detail = Effect34.fn("JobsRead.detail")(
    function* (access, input) {
      const request = yield* Schema28.decodeUnknownEffect(JobDetailRequest)(
        input,
        strict
      ).pipe(Effect34.mapError(invalid2));
      if (request.jobId.length > 128) {
        return yield* invalid2();
      }
      yield* authorize(access, request.sandbox);
      const rows = yield* execute3(queries.detail(access.sandbox.ref, request)).pipe(
        Effect34.flatMap(
          (value3) => Schema28.decodeUnknownEffect(DetailRows)(value3, strict)
        ),
        Effect34.catchCause(unavailableCause)
      );
      const row = rows[0];
      yield* checkStatus(row.status);
      if (!row.detail) {
        return yield* new PlaygroundError({ code: "not-found" });
      }
      if (!sameRef4(row.detail.sandbox, request.sandbox) || row.detail.job.jobId !== request.jobId) {
        return yield* unavailable3();
      }
      const payload2 = yield* payload(row.detail, row);
      const problem = row.problem?.problem ?? null;
      const projected = {
        ...row.detail,
        ...retainedFields,
        payload: payload2,
        problem,
        lineage: row.lineage,
        provider: row.provider ? { source: "synthetic-postgresql", ...row.provider, observedAt: null } : null,
        history: yield* historyPage(request, row.history, 50),
        related: yield* relatedPage(request, row.related, 50),
        eligibility: eligibility2(row.detail, problem, payload2)
      };
      return yield* Schema28.decodeUnknownEffect(JobDetail)(projected, strict).pipe(
        Effect34.mapError(unavailable3)
      );
    }
  );
  const subread = (access, input, view3) => Effect34.gen(function* () {
    const request = yield* Schema28.decodeUnknownEffect(Subread)(input, strict).pipe(
      Effect34.mapError(invalid2)
    );
    yield* authorize(access, request.sandbox);
    if (request.jobId.length > 128) {
      return yield* invalid2();
    }
    let after = null;
    if (request.cursor !== void 0) {
      const decoded = yield* cursor.decode(request.cursor);
      if (decoded.version !== 2 || decoded.view !== view3 || !("jobId" in decoded) || !sameRef4(decoded.sandbox, request.sandbox) || decoded.jobId !== request.jobId) {
        return yield* invalid2();
      }
      after = decoded.after;
    }
    if (view3 === "history") {
      const rows2 = yield* execute3(
        queries.history(request.sandbox, request, after)
      ).pipe(
        Effect34.flatMap(
          (value3) => Schema28.decodeUnknownEffect(
            Schema28.Array(
              Schema28.Struct({
                status: Status,
                found: Schema28.Boolean,
                items: Schema28.Array(KeyedHistory).pipe(
                  Schema28.check(Schema28.isMaxLength(51))
                )
              })
            ).pipe(Schema28.check(Schema28.isMinLength(1), Schema28.isMaxLength(1)))
          )(value3, strict)
        ),
        Effect34.catchCause(unavailableCause)
      );
      const row2 = rows2[0];
      yield* checkStatus(row2.status);
      if (!row2.found) {
        return yield* new PlaygroundError({ code: "not-found" });
      }
      return yield* Schema28.decodeUnknownEffect(JobHistory)(
        yield* historyPage(request, row2.items, request.limit),
        strict
      ).pipe(Effect34.mapError(unavailable3));
    }
    const rows = yield* execute3(
      queries.related(request.sandbox, request, after)
    ).pipe(
      Effect34.flatMap(
        (value3) => Schema28.decodeUnknownEffect(
          Schema28.Array(
            Schema28.Struct({
              status: Status,
              found: Schema28.Boolean,
              items: Schema28.Array(JobRelatedItem).pipe(
                Schema28.check(Schema28.isMaxLength(51))
              )
            })
          ).pipe(Schema28.check(Schema28.isMinLength(1), Schema28.isMaxLength(1)))
        )(value3, strict)
      ),
      Effect34.catchCause(unavailableCause)
    );
    const row = rows[0];
    yield* checkStatus(row.status);
    if (!row.found) {
      return yield* new PlaygroundError({ code: "not-found" });
    }
    return yield* Schema28.decodeUnknownEffect(JobRelatedPage)(
      yield* relatedPage(request, row.items, request.limit),
      strict
    ).pipe(Effect34.mapError(unavailable3));
  });
  return JobsRead.of({
    list,
    detail,
    problems,
    history: (access, input) => subread(access, input, "history").pipe(
      Effect34.flatMap(
        (value3) => Schema28.decodeUnknownEffect(JobHistory)(value3, strict)
      ),
      Effect34.mapError(
        (error) => error instanceof PlaygroundError ? error : unavailable3()
      )
    ),
    related: (access, input) => subread(access, input, "related").pipe(
      Effect34.flatMap(
        (value3) => Schema28.decodeUnknownEffect(JobRelatedPage)(value3, strict)
      ),
      Effect34.mapError(
        (error) => error instanceof PlaygroundError ? error : unavailable3()
      )
    )
  });
});
var layerNoDeps9 = (mapping2) => Layer15.effect(JobsRead, make26(mapping2));

// apps/website/src/server/read/NativeReadDatabase.ts
import { Effect as Effect35, Layer as Layer16 } from "effect";
import { SqlClient as SqlClient9 } from "effect/sql/SqlClient";
var layerNoDeps10 = Layer16.effect(
  ReadDatabase,
  Effect35.gen(function* () {
    const client = yield* SqlClient9;
    return ReadDatabase.of({
      execute: (query) => client.unsafe(query.text, query.values).pipe(Effect35.mapError(() => new PlaygroundError({ code: "unavailable" })))
    });
  })
);

// apps/website/src/server/commands/GuardedScenarios.ts
import { Effect as Effect36, Layer as Layer17, Schema as Schema29 } from "effect";
var fail16 = (code) => new PlaygroundError({ code });
var decode7 = (schema, value3, code = "invalid-request") => Schema29.decodeUnknownEffect(schema)(value3, { onExcessProperty: "error" }).pipe(
  Effect36.mapError(() => fail16(code))
);
var make27 = Effect36.gen(function* () {
  const authority = yield* SandboxAuthority;
  const persistence = yield* CommandPersistence;
  const authorize2 = Effect36.fnUntraced(function* (access, expected, operation2) {
    const view3 = yield* decode7(
      SandboxView,
      yield* authority.describe(access),
      "unavailable"
    );
    if (view3.ref.sandboxId !== access.sandbox.ref.sandboxId || expected.sandboxId !== view3.ref.sandboxId) {
      return yield* fail16("not-found");
    }
    if (operation2 === "receipt" ? expected.generation > view3.ref.generation : expected.generation !== view3.ref.generation) {
      return yield* fail16("stale-generation");
    }
    if (operation2 !== "receipt" && !view3.capabilities[operation2]) {
      return yield* fail16("capability-unavailable");
    }
    return { sandbox: view3 };
  });
  return Scenarios.of({
    run: Effect36.fn("Commands.run")(function* (access, input) {
      const command = yield* decode7(ScenarioCommand, input);
      const admitted = yield* authorize2(access, command.sandbox, "runScenario");
      const result3 = yield* decode7(
        ScenarioResult,
        yield* persistence.run(admitted, command),
        "unavailable"
      );
      if (result3.requestId !== command.requestId || result3.sandbox.sandboxId !== command.sandbox.sandboxId || result3.sandbox.generation !== command.sandbox.generation || result3._tag === "Committed" && result3.jobIds.length !== command.count) {
        return yield* fail16("unavailable");
      }
      return result3;
    }),
    reset: Effect36.fn("Commands.reset")(function* (access, input) {
      const command = yield* decode7(ResetCommand, input);
      const admitted = yield* authorize2(access, command.sandbox, "resetSandbox");
      const result3 = yield* decode7(
        ResetResult,
        yield* persistence.reset(admitted, command),
        "unavailable"
      );
      if (result3.requestId !== command.requestId || result3.previous.sandboxId !== command.sandbox.sandboxId || result3.previous.generation !== command.sandbox.generation) {
        return yield* fail16("unavailable");
      }
      return result3;
    }),
    scenarioReceipt: Effect36.fn("Commands.scenarioReceipt")(function* (access, input) {
      const request = yield* decode7(ReceiptRequest, input);
      const admitted = yield* authorize2(access, request.sandbox, "receipt");
      const result3 = yield* decode7(
        ScenarioResult,
        yield* persistence.scenarioReceipt(admitted, request),
        "unavailable"
      );
      if (result3.requestId !== request.requestId || result3.sandbox.sandboxId !== request.sandbox.sandboxId || result3.sandbox.generation !== request.sandbox.generation) {
        return yield* fail16("unavailable");
      }
      return result3;
    }),
    resetReceipt: Effect36.fn("Commands.resetReceipt")(function* (access, input) {
      const request = yield* decode7(ReceiptRequest, input);
      const admitted = yield* authorize2(access, request.sandbox, "receipt");
      const result3 = yield* decode7(
        ResetResult,
        yield* persistence.resetReceipt(admitted, request),
        "unavailable"
      );
      if (result3.requestId !== request.requestId || result3.previous.sandboxId !== request.sandbox.sandboxId || result3.previous.generation !== request.sandbox.generation) {
        return yield* fail16("unavailable");
      }
      return result3;
    })
  });
});
var layerNoDeps11 = Layer17.effect(Scenarios, make27);

// apps/playground-worker/src/execution/Event.ts
var mapping = (schema) => ({
  schema,
  jobsTable: "jobs",
  sandboxesTable: "sandboxes",
  associationsTable: "associations"
});
var bytes = (hex3) => {
  if (!/^[0-9a-f]{64}$/.test(hex3)) {
    throw new Error("Invalid synthetic key configuration");
  }
  return Uint8Array.from(hex3.match(/../g), (byte) => Number.parseInt(byte, 16));
};
var keys = (config) => Effect37.tryPromise({
  try: async () => ({
    encryption: await crypto.subtle.importKey(
      "raw",
      bytes(config.encryptionKey),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"]
    ),
    fingerprint: await crypto.subtle.importKey(
      "raw",
      bytes(config.fingerprintKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    ),
    cursor: await crypto.subtle.importKey(
      "raw",
      bytes(config.cursorKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    )
  }),
  catch: () => new PlaygroundError({ code: "unavailable" })
});
var run2 = (config, kick, operation2) => Effect37.scoped(
  Effect37.gen(function* () {
    const client = yield* make16({
      url: Redacted5.make(config.connectionString),
      minConnections: 0,
      maxConnections: 2,
      prepare: false,
      connectTimeout: "2 seconds",
      idleTimeout: "1 second"
    });
    const backend = yield* Backend.make({
      schema: config.schema,
      operationResponseBudgetMillis: 500
    }).pipe(
      Effect37.provideService(
        PostgreSqlApplication,
        Native.make({ client, operationTimeoutMillis: 2e3 })
      )
    );
    yield* backend.ready;
    const stable = yield* keys(config);
    const authority = (yield* make20(config.schema).pipe(
      Effect37.provideService(SqlClient10, client),
      Effect37.provideService(JobEnqueue4, backend.producer),
      Effect37.provideService(DocumentKeys, stable)
    )).authority;
    const activeAuthority = Layer18.succeed(SandboxAuthority, {
      ...authority,
      describe: (access) => authority.describe(access).pipe(Effect37.tap(() => kick))
    });
    const commands = layerNoDeps6.pipe(
      Layer18.provide(transactionsLayerNoDeps(config.schema)),
      Layer18.provide(Layer18.succeed(JobEnqueue4, backend.producer))
    );
    const worker = workerLayerNoDeps(config.schema).pipe(
      Layer18.provide(Layer18.succeed(Backend.PostgreSqlJobs, backend))
    );
    const read = layerNoDeps9(mapping(config.schema)).pipe(
      Layer18.provide(layerNoDeps10),
      Layer18.provide(layer4(stable.cursor))
    );
    const guarded = layerNoDeps11.pipe(
      Layer18.provide(Layer18.mergeAll(activeAuthority, commands))
    );
    const operators = Layer18.effect(
      Operators,
      make8.pipe(
        Effect37.map((service) => ({
          ...service,
          execute: (access, command) => service.execute(access, command).pipe(
            Effect37.tap(
              (result3) => result3._tag === "Committed" ? kick : Effect37.void
            )
          ),
          receipt: (access, request) => service.receipt(access, request).pipe(
            Effect37.tap(
              (result3) => result3._tag === "Committed" ? kick : Effect37.void
            )
          )
        }))
      )
    ).pipe(Layer18.provide(layerNoDeps5(config.schema)));
    const repairs = layerNoDeps2.pipe(
      Layer18.provide(layerNoDeps3(config.schema))
    );
    const syntheticRepairs = syntheticLayerNoDeps.pipe(
      Layer18.provide(syntheticLayerNoDeps2(config.schema))
    );
    const app = layerNoDeps.pipe(
      Layer18.provide(Layer18.mergeAll(activeAuthority, read, guarded, operators, repairs))
    );
    return yield* operation2.pipe(
      Effect37.provide(app),
      Effect37.provide(Layer18.mergeAll(worker, commands, syntheticRepairs, read)),
      Effect37.provideService(SqlClient10, client),
      Effect37.provideService(Backend.PostgreSqlJobs, backend),
      Effect37.provideService(DocumentKeys, stable)
    );
  })
).pipe(
  Effect37.provideService(LocalPrivate, config.localPrivate === true),
  Effect37.provide(Reactivity2.layer)
);

// apps/playground-worker/tests/integration/OperatorProbe.ts
var seed = (config, ref, state = "Pending", workload = 0) => run2(
  config,
  Effect38.void,
  Effect38.gen(function* () {
    const backend = yield* PostgreSqlJobs5;
    const sql = yield* SqlClient11;
    const id = yield* backend.withTransaction(
      () => Effect38.gen(function* () {
        const [clock2] = yield* sql.unsafe(
          "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now"
        );
        const [job] = yield* plan(
          {
            sandbox: ref,
            requestId: crypto.randomUUID(),
            scenario: "success",
            count: 1
          },
          ref,
          workload,
          state === "Pending" ? Number(clock2.now) + 36e5 : Number(clock2.now)
        );
        const result3 = yield* enqueue({
          ...job,
          policy: Policy2.make({ retryDelay: Duration5.seconds(600) })
        });
        yield* sql.unsafe(
          `INSERT INTO "${config.schema}".associations VALUES ($1,$2,$3,'{}'::jsonb)`,
          [ref.sandboxId, ref.generation, result3.jobId]
        );
        yield* sql.unsafe(
          `UPDATE "${config.schema}".sandboxes SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1`,
          [ref.sandboxId]
        );
        return result3.jobId;
      })
    );
    if (state !== "Pending") {
      const definition2 = definitions[workload];
      const claim = yield* backend.store.claim({
        queue: definition2.queue.name,
        supportedCatalog: [definition2.catalog],
        leaseToken: crypto.randomUUID()
      });
      if (claim._tag !== "Claimed" || claim.claim.snapshot.jobId !== id) {
        return yield* Effect38.die("fixture claim failed");
      }
      if (state !== "Active") {
        const finalization = state === "RetryScheduled" ? {
          _tag: "Retry",
          code: Schema30.decodeSync(FailureCode3)("fixture_retry")
        } : {
          _tag: state === "Dead" ? "Dead" : "Isolate",
          code: Schema30.decodeSync(FailureCode3)("fixture_terminal")
        };
        const result3 = yield* backend.store.finalize({
          ownership: claim.claim.ownership,
          before: claim.claim.snapshot,
          finalization
        });
        if (result3._tag !== "Applied") {
          return yield* Effect38.die("fixture finalize failed");
        }
      }
    }
    return id;
  })
);
var execute2 = (config, credential, command) => run2(
  config,
  Effect38.void,
  Effect38.gen(function* () {
    const app = yield* Application;
    return yield* app.execute(
      yield* app.authenticate(Redacted6.make(credential)),
      command
    );
  })
);
var lookup2 = (config, credential, request) => run2(
  config,
  Effect38.void,
  Effect38.gen(function* () {
    const app = yield* Application;
    return yield* app.receipt(
      yield* app.authenticate(Redacted6.make(credential)),
      request
    );
  })
);
var lostCommit = (config, credential, command) => run2(
  config,
  Effect38.void,
  Effect38.gen(function* () {
    const app = yield* Application;
    const access = yield* app.authenticate(Redacted6.make(credential));
    const transactions = yield* make9(config.schema);
    const service = yield* make8.pipe(
      Effect38.provideService(OperatorTransactions, {
        ...transactions,
        owned: (access2, command2, body) => transactions.owned(access2, command2, body).pipe(
          Effect38.flatMap(
            () => Effect38.fail(
              new CommandTransactionFailure({ commitKnowledge: "Unknown" })
            )
          )
        )
      })
    );
    return yield* service.execute(access, command);
  })
);
export {
  execute2 as execute,
  lookup2 as lookup,
  lostCommit,
  seed
};
