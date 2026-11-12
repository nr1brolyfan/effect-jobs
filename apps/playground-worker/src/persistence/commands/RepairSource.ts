import { Effect, Result, Schema } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import {
  JobRepairReason,
  type JobRepairCommand,
  type JobResolutionCommand
} from "@effect-jobs/playground-contracts/Repairs"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import * as Definitions from "../../scenarios/Definitions.js"

export class RepairSourceRejected extends Schema.TaggedError<RepairSourceRejected>()(
  "RepairSourceRejected",
  { reason: JobRepairReason }
) {}
const rejected = (reason: JobRepairReason) => new RepairSourceRejected({ reason })

// Bounded canonical JSON for admission identity. This is NOT a payload codec:
// selected definition encoding and canonical artifact validation still use core.
const scalars = (value: string) =>
  Array.from(value).every(
    (scalar) => scalar.codePointAt(0)! < 0xd800 || scalar.codePointAt(0)! > 0xdfff
  )
export const canonicalJson = (
  input: unknown,
  maximum = 65536
): Result.Result<string, void> => {
  // Scratch belongs to one synchronous validation. Only foreign object operations
  // can throw; expected bounds/shape failures return through Result.
  try {
    const seen = new Set<object>()
    let length = 0
    const emit = (text: string): Result.Result<string, void> => {
      length += new TextEncoder().encode(text).length
      return length > maximum ? Result.failVoid : Result.succeed(text)
    }
    const quote = (text: string): Result.Result<string, void> =>
      text.length > maximum || !scalars(text)
        ? Result.failVoid
        : emit(JSON.stringify(text))
    const visit = (value: unknown, depth: number): Result.Result<string, void> =>
      Result.gen(function* () {
        if (depth > 32) {
          return yield* Result.failVoid
        }
        if (value === null) {
          return yield* emit("null")
        }
        if (typeof value === "boolean") {
          return yield* emit(String(value))
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          return yield* emit(JSON.stringify(value))
        }
        if (typeof value === "string") {
          return yield* quote(value)
        }
        if (typeof value !== "object" || seen.has(value)) {
          return yield* Result.failVoid
        }
        const array = Array.isArray(value)
        if (
          !array &&
          Object.getPrototypeOf(value) !== Object.prototype &&
          Object.getPrototypeOf(value) !== null
        ) {
          return yield* Result.failVoid
        }
        seen.add(value)
        const descriptors = Object.getOwnPropertyDescriptors(value)
        const keys = Reflect.ownKeys(descriptors)
        for (const key of keys) {
          if (array && key === "length") {
            continue
          }
          const descriptor = descriptors[key as string]!
          if (
            typeof key !== "string" ||
            !scalars(key) ||
            !descriptor.enumerable ||
            !("value" in descriptor)
          ) {
            return yield* Result.failVoid
          }
        }
        const entries: string[] = []
        if (array) {
          if (keys.length !== value.length + 1) {
            return yield* Result.failVoid
          }
          yield* emit("[]")
          for (let index = 0; index < value.length; index++) {
            if (index > 0) {
              yield* emit(",")
            }
            const descriptor = descriptors[String(index)]
            if (!descriptor) {
              return yield* Result.failVoid
            }
            entries.push(yield* visit(descriptor.value, depth + 1))
          }
        } else {
          yield* emit("{}")
          for (const [index, key] of (keys as string[]).sort().entries()) {
            if (index > 0) {
              yield* emit(",")
            }
            const name = yield* quote(key)
            yield* emit(":")
            const member = yield* visit(descriptors[key]!.value, depth + 1)
            entries.push(`${name}:${member}`)
          }
        }
        seen.delete(value)
        return array ? `[${entries.join(",")}]` : `{${entries.join(",")}}`
      })
    return visit(input, 0)
  } catch {
    // Proxies and native reflection/encoding are unsafe JavaScript boundaries.
    return Result.failVoid
  }
}
const sha256 = (value: string) =>
  Effect.tryPromise({
    // WebCrypto FFI, no keys or retained mutable input.
    try: async () =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
        ),
        (byte) => byte.toString(16).padStart(2, "0")
      ).join(""),
    catch: () => rejected("unavailable")
  })
const canonical = (input: unknown, maximum = 65536) =>
  Effect.suspend(() => Effect.fromResult(canonicalJson(input, maximum))).pipe(
    Effect.mapError(() => rejected("invalid-input"))
  )
export const digestJson = (value: unknown) =>
  canonical(value, 131072).pipe(Effect.flatMap(sha256))
export const commandDigest = (command: JobRepairCommand | JobResolutionCommand) =>
  Effect.gen(function* () {
    const payload = yield* Effect.try({
      // The has/get traps are foreign JavaScript operations, not validation.
      try: () => ("payload" in command ? { value: command.payload } : undefined),
      catch: () => rejected("invalid-input")
    })
    if (payload !== undefined) {
      yield* canonical(payload.value)
    }
    return yield* canonical(command, 131072).pipe(Effect.flatMap(sha256))
  })
export const producerIdentity = (command: JobRepairCommand) =>
  sha256(
    JSON.stringify([
      command.sandbox.sandboxId,
      command.sandbox.generation,
      command.requestId,
      command.jobId,
      command.action
    ])
  ).pipe(
    Effect.map((operationId) =>
      Object.freeze({ operation: "playground.repair", operationId, slot: "replacement" })
    )
  )

export const definition = (row: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const definitions = yield* Definitions.Definitions
    const found = definitions.definitions.find(
      (candidate) =>
        definitions.catalogFor(candidate).queue === row.queue &&
        candidate.name === row.kind &&
        candidate.version === Number(row.version)
    )
    if (!found) {
      return yield* rejected("unsupported-catalog")
    }
    return found
  })
export const artifact = (row: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    // Snapshot foreign row access before validation and buffer copying.
    const input = yield* Effect.try({
      try: () => ({
        version: Number(row.format_version),
        payload: row.payload,
        projection: row.projection
      }),
      catch: () => rejected("invalid-artifact")
    })
    if (
      input.version !== 1 ||
      !(input.payload instanceof Uint8Array) ||
      !(input.projection instanceof Uint8Array)
    ) {
      return yield* rejected("invalid-artifact")
    }
    const { payload, projection } = input
    return yield* Effect.try({
      try: () => ({
        formatVersion: 1 as const,
        payloadBytes: new Uint8Array(payload),
        semanticProjectionBytes: new Uint8Array(projection)
      }),
      catch: () => rejected("invalid-artifact")
    })
  })

export const knownFailure = (row: Readonly<Record<string, unknown>>): boolean =>
  row.state === "Dead" &&
  row.accepted === false &&
  Number.isSafeInteger(Number(row.invocations)) &&
  Number(row.invocations) > 0 &&
  ["fake_provider_terminal_rejected", "fake_provider_retry_rejected"].includes(
    String(row.last_failure_code)
  )

export const investigate = (
  row: Readonly<Record<string, unknown>>,
  command: JobRepairCommand
) => {
  switch (command.investigation._tag) {
    case "KnownFailure":
      return knownFailure(row)
        ? Effect.succeed("KnownFailure" as const)
        : Effect.fail(rejected("investigation-required"))
    case "ConfirmedNotApplied":
      return row.state === "Isolated"
        ? Effect.succeed("KnownFailure" as const)
        : Effect.fail(rejected("investigation-required"))
    case "AcceptDuplicateRisk":
      return Effect.succeed("Unknown" as const)
    case "Unconfirmed":
      return Effect.fail(rejected("investigation-required"))
  }
}

const fieldChanges = (
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  keys: ReadonlyArray<string>,
  prefix: string
) =>
  Effect.forEach(keys, (key) =>
    Effect.gen(function* () {
      const left = yield* canonical(before[key])
      const right = yield* canonical(after[key])
      return left === right
        ? []
        : [{ kind: "Changed" as const, path: `${prefix}/${key}` }]
    })
  ).pipe(Effect.map((changes) => changes.flat()))
export const changedPaths = (before: Definitions.Payload, after: Definitions.Payload) =>
  fieldChanges(before, after, Object.keys(Definitions.Payload.fields), "")

// A corrected artifact can replace missing/corrupt old bytes. Invariant authority
// comes from retained association identity; valid old bytes constrain it further.
export const replacement = (
  row: Readonly<Record<string, unknown>>,
  current: SandboxRef,
  input: unknown
) =>
  Effect.gen(function* () {
    const definitions = yield* Definitions.Definitions

    const selected = yield* definition(row)
    const synthetic = selected === definitions.SyntheticDocumentExport
    if ("document" in selected.payload.fields && !synthetic) {
      return yield* rejected("encrypted-correction-unavailable")
    }
    // Decode/authenticate the encoded envelope, never accept a plaintext document.
    const nextSynthetic = synthetic
      ? yield* Schema.decodeUnknownEffect(definitions.SyntheticExportPayload)(input, {
          onExcessProperty: "error"
        }).pipe(Effect.mapError(() => rejected("invalid-payload")))
      : null
    const next =
      nextSynthetic ??
      (yield* Schema.decodeUnknownEffect(Definitions.Payload)(input, {
        onExcessProperty: "error"
      }).pipe(Effect.mapError(() => rejected("invalid-payload"))))
    if (
      nextSynthetic &&
      (nextSynthetic.document.subject !== next.actor ||
        nextSynthetic.document.tenant !== next.tenant)
    ) {
      return yield* rejected("invalid-payload")
    }
    if (
      next.sandbox.sandboxId !== current.sandboxId ||
      next.sandbox.generation !== current.generation
    ) {
      return yield* rejected("invalid-payload")
    }
    const relations = row.relations as Record<string, unknown> | null
    if (
      !relations ||
      relations.syntheticActor !== next.actor ||
      relations.syntheticOrderId !== next.order
    ) {
      return yield* rejected("invalid-payload")
    }
    const oldSynthetic = synthetic
      ? yield* artifact(row).pipe(
          Effect.flatMap((bytes) =>
            Codec.decodeJobPayload(definitions.SyntheticExportPayload, bytes)
          ),
          Effect.catchTags({ RepairSourceRejected: () => Effect.succeed(null) }),
          Effect.catchTags({ JobPayloadCodecError: () => Effect.succeed(null) })
        )
      : null
    const old = synthetic
      ? oldSynthetic
      : yield* artifact(row).pipe(
          Effect.flatMap((bytes) => Codec.decodeJobPayload(Definitions.Payload, bytes)),
          Effect.catchTags({ RepairSourceRejected: () => Effect.succeed(null) }),
          Effect.catchTags({ JobPayloadCodecError: () => Effect.succeed(null) })
        )
    if (
      old &&
      (old.actor !== next.actor ||
        old.tenant !== next.tenant ||
        old.order !== next.order ||
        old.sandbox.sandboxId !== current.sandboxId ||
        old.sandbox.generation !== current.generation)
    ) {
      return yield* rejected("invalid-payload")
    }
    // Tenant remains server-owned even when old bytes are corrupt/missing. The
    // serial registrar must add validated syntheticTenant to retained relations.
    if (!old && relations.syntheticTenant !== next.tenant) {
      return yield* rejected("invalid-payload")
    }
    if (nextSynthetic) {
      return {
        _tag: "Synthetic" as const,
        payload: nextSynthetic,
        changes: old
          ? [
              ...(yield* changedPaths(old, next)),
              ...(oldSynthetic
                ? yield* fieldChanges(
                    oldSynthetic.document,
                    nextSynthetic.document,
                    Object.keys(nextSynthetic.document),
                    "/document"
                  )
                : [])
            ]
          : null
      }
    }
    const encoded = yield* Codec.encodeJobPayload(Definitions.Payload, next).pipe(
      Effect.mapError(() => rejected("invalid-payload"))
    )
    yield* Codec.decodeJobPayload(Definitions.Payload, encoded).pipe(
      Effect.mapError(() => rejected("invalid-payload"))
    )
    return {
      _tag: "Plain" as const,
      definition: selected,
      payload: next,
      changes: old ? yield* changedPaths(old, next) : null
    }
  })
