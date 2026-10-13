import { Effect, Schema } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as JobProducer from "effect-jobs/JobProducer"
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
const producer = JobProducer.make({
  operation: "playground.repair",
  slots: ["replacement"]
})

// Bounded canonical JSON for admission identity. This is NOT a payload codec:
// selected definition encoding and canonical artifact validation still use core.
const scalars = (value: string) =>
  Array.from(value).every(
    (scalar) => scalar.codePointAt(0)! < 0xd800 || scalar.codePointAt(0)! > 0xdfff
  )
export const canonicalJson = (input: unknown, maximum = 65536): string => {
  const seen = new Set<object>()
  let length = 0
  const emit = (text: string) => {
    length += new TextEncoder().encode(text).length
    if (length > maximum) {
      throw new Error("JSON size exceeded")
    }
    return text
  }
  const quote = (text: string) => {
    if (text.length > maximum || !scalars(text)) {
      throw new Error("Invalid JSON string")
    }
    return emit(JSON.stringify(text))
  }
  const visit = (value: unknown, depth: number): string => {
    if (depth > 32) {
      throw new Error("JSON depth exceeded")
    }
    if (value === null) {
      return emit("null")
    }
    if (typeof value === "boolean") {
      return emit(String(value))
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return emit(JSON.stringify(value))
    }
    if (typeof value === "string") {
      return quote(value)
    }
    if (typeof value !== "object" || value === null || seen.has(value)) {
      throw new Error("Invalid JSON")
    }
    const array = Array.isArray(value)
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new Error("Invalid JSON container")
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
        throw new Error("Invalid JSON descriptor")
      }
    }
    let result: string
    if (array) {
      if (keys.length !== value.length + 1) {
        throw new Error("Invalid JSON array")
      }
      emit("[]")
      const entries: string[] = []
      for (let index = 0; index < value.length; index++) {
        if (index > 0) {
          emit(",")
        }
        const descriptor = descriptors[String(index)]
        if (!descriptor) {
          throw new Error("Sparse JSON array")
        }
        entries.push(visit(descriptor.value, depth + 1))
      }
      result = `[${entries.join(",")}]`
    } else {
      emit("{}")
      result = `{${(keys as string[])
        .sort()
        .map((key, index) => {
          if (index > 0) {
            emit(",")
          }
          return `${quote(key)}${emit(":")}${visit(descriptors[key]!.value, depth + 1)}`
        })
        .join(",")}}`
    }
    seen.delete(value)
    return result
  }
  return visit(input, 0)
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
export const digestJson = (value: unknown) =>
  Effect.try({
    try: () => canonicalJson(value, 131072),
    catch: () => rejected("invalid-input")
  }).pipe(Effect.flatMap(sha256))
export const commandDigest = (command: JobRepairCommand | JobResolutionCommand) =>
  Effect.try({
    try: () => {
      if ("payload" in command) {
        canonicalJson(command.payload)
      }
      return canonicalJson(command, 131072)
    },
    catch: () => rejected("invalid-input")
  }).pipe(Effect.flatMap(sha256))
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
    Effect.map((operationId) => producer.identity({ operationId, slot: "replacement" }))
  )

export const definition = (row: Readonly<Record<string, unknown>>) => {
  const found = Definitions.definitions.find(
    (candidate) =>
      candidate.catalog.queue === row.queue &&
      candidate.catalog.kind === row.kind &&
      candidate.catalog.version === Number(row.version)
  )
  return found ? Effect.succeed(found) : Effect.fail(rejected("unsupported-catalog"))
}
export const artifact = (row: Readonly<Record<string, unknown>>) =>
  Effect.try({
    try: () => {
      if (
        Number(row.format_version) !== 1 ||
        !(row.payload instanceof Uint8Array) ||
        !(row.projection instanceof Uint8Array)
      ) {
        throw new Error("Absent artifact")
      }
      return {
        formatVersion: 1 as const,
        payloadBytes: new Uint8Array(row.payload),
        semanticProjectionBytes: new Uint8Array(row.projection)
      }
    },
    catch: () => rejected("invalid-artifact")
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

export const changedPaths = (before: Definitions.Payload, after: Definitions.Payload) =>
  Object.keys(Definitions.Payload.fields)
    .filter(
      (key) =>
        canonicalJson(before[key as keyof Definitions.Payload]) !==
        canonicalJson(after[key as keyof Definitions.Payload])
    )
    .map((key) => ({ kind: "Changed" as const, path: `/${key}` }))

// A corrected artifact can replace missing/corrupt old bytes. Invariant authority
// comes from retained association identity; valid old bytes constrain it further.
export const replacement = (
  row: Readonly<Record<string, unknown>>,
  current: SandboxRef,
  input: unknown
) =>
  Effect.gen(function* () {
    const selected = yield* definition(row)
    if ("document" in selected.payload.fields) {
      return yield* rejected("encrypted-correction-unavailable")
    }
    const next = yield* Schema.decodeUnknownEffect(Definitions.Payload)(input, {
      onExcessProperty: "error"
    }).pipe(Effect.mapError(() => rejected("invalid-payload")))
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
    const old = yield* artifact(row).pipe(
      Effect.flatMap((bytes) => Codec.decodeJobPayload(Definitions.Payload, bytes)),
      Effect.catchTag("RepairSourceRejected", () => Effect.succeed(null)),
      Effect.catchTag("JobPayloadCodecError", () => Effect.succeed(null))
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
    const encoded = yield* Codec.encodeJobPayload(Definitions.Payload, next).pipe(
      Effect.mapError(() => rejected("invalid-payload"))
    )
    yield* Codec.decodeJobPayload(Definitions.Payload, encoded).pipe(
      Effect.mapError(() => rejected("invalid-payload"))
    )
    return {
      definition: selected,
      payload: next,
      changes: old ? changedPaths(old, next) : null
    }
  })
