/** Contract-first handler groups. Construction starts no worker or storage activity. */
/* oxlint-disable effecttsgo/any-unknown-in-error-context -- Unknown is only the
 * existential upper bound for heterogeneous handlers inside acquisition. The
 * exported Layer infers concrete requirements, verified by service-negative tests. */
import { Context, Data, Schema } from "effect"
import type { Effect } from "effect"
import type { EncodedJobPayload, HandlerInput, HandlerContext } from "./JobContract.js"
import type { JobPayloadCodecError } from "./JobContract.js"
import type { JobFailure } from "./JobFailure.js"
import { JobName, JobVersion } from "./JobIdentity.js"
import type { JobDefinition } from "./Job.js"

/** Named job contracts, independent of queue routing. */
export type Definitions = Readonly<Record<string, JobDefinition>>

/** Complete decoded handler implementations inferred from the group contracts. */
export type HandlersFrom<D extends Definitions> = {
  readonly [K in keyof D]: (
    input: HandlerInput<D[K]["payload"]["Type"]>
  ) => Effect.Effect<void, JobFailure, unknown>
}

/** Union of implementation service requirements captured during installation. */
export type HandlerServices<H> = [H] extends [never]
  ? never
  : H[keyof H] extends (...args: never[]) => Effect.Effect<unknown, unknown, infer R>
    ? R
    : never

/** Schema decoding requirements of every contract in the group. */
export type DecodingServices<D extends Definitions> =
  D[keyof D]["payload"]["DecodingServices"]

const HandlersTypeId: unique symbol = Symbol("effect-jobs/JobGroup/Handlers")

// Context keys need realm-local uniqueness, not randomness or durable identity.
// Share the counter across module copies without requiring request-scoped crypto.
const sequenceId = Symbol.for("effect-jobs/JobGroup/sequence")
const realm = globalThis as typeof globalThis & {
  [sequenceId]?: { value: bigint }
}
const sequence = (realm[sequenceId] ??= { value: 0n })

/** The group name and definitions participate in the worker's service requirement. */
export interface Handlers<Name extends string, D extends Definitions> {
  readonly [HandlersTypeId]: {
    readonly name: Name
    readonly definitions: (value: D) => D
  }
}

/** Encoded invocation boundary used by installed handler services. */
export type BoundHandler = (
  encoded: EncodedJobPayload,
  context: HandlerContext
) => Effect.Effect<void, JobFailure | JobPayloadCodecError>

/** Decoding and execution dependencies are captured when the Layer is acquired. */
export type InstalledHandlers<D extends Definitions> = {
  readonly [K in keyof D]: BoundHandler
}

/** Invalid static declaration; diagnostics expose aliases, never payload values. */
export class InvalidJobGroup extends Data.TaggedError("InvalidJobGroup")<{
  readonly reason: "empty-group" | "invalid-definition" | "duplicate-contract"
  readonly alias?: string
}> {}

/** Installation rejected incomplete handlers or an unsupported payload Schema. */
export class JobGroupConfigurationError extends Data.TaggedError(
  "JobGroupConfigurationError"
)<{
  readonly reason: "invalid-handlers" | "unsupported-schema"
  readonly alias?: string
}> {}

/** Immutable contract declaration with a distinct installation service identity. */
export interface JobGroup<Name extends string, D extends Definitions> {
  readonly name: Name
  readonly definitions: D
  readonly handlers: Context.Service<Handlers<Name, D>, InstalledHandlers<D>>
}

/**
 * Declares a named group, preserving aliases and payload types. The name is a
 * compile-time service identity, not a durable job identity. Each construction
 * allocates a distinct Context key, even for identical names and definitions.
 * Reuse the same group reference when installing handlers and building a worker.
 */
export const make = <const Name extends string, const D extends Definitions>(
  name: Name,
  definitions: D
): JobGroup<Name, D> => {
  const entries = Object.entries(definitions)
  if (entries.length === 0) {
    throw new InvalidJobGroup({ reason: "empty-group" })
  }
  const versions = new Map<string, Set<number>>()
  for (const [alias, definition] of entries) {
    if (
      typeof definition !== "object" ||
      definition === null ||
      !Schema.is(JobName)(definition.name) ||
      !Schema.is(JobVersion)(definition.version) ||
      !Schema.isSchema(definition.payload)
    ) {
      throw new InvalidJobGroup({ reason: "invalid-definition", alias })
    }
    const seen = versions.get(definition.name) ?? new Set<number>()
    if (seen.has(definition.version)) {
      throw new InvalidJobGroup({ reason: "duplicate-contract", alias })
    }
    seen.add(definition.version)
    versions.set(definition.name, seen)
  }
  // Snapshot declarations without freezing caller-owned objects. Schemas retain
  // their native identity, annotations and encoding/decoding service contracts.
  const snapshot = Object.freeze(
    Object.fromEntries(entries.map((entry) => [entry[0], Object.freeze({ ...entry[1] })]))
  ) as D
  const service = Context.Service<Handlers<Name, D>, InstalledHandlers<D>>(
    `effect-jobs/JobGroup/${name}/${sequence.value++}`
  )

  return Object.freeze({ name, definitions: snapshot, handlers: service })
}
