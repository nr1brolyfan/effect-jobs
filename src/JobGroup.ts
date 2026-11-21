/** Contract-first handler groups. Construction starts no worker or storage activity. */
/* oxlint-disable effecttsgo/any-unknown-in-error-context -- Unknown is only the
 * existential upper bound for heterogeneous handlers inside acquisition. The
 * exported Layer infers concrete requirements, verified by service-negative tests. */
import { Context, Data, Effect, Layer, Schema, Scope } from "effect"
import type { EncodedJobPayload, HandlerInput, HandlerContext } from "./JobContract.js"
import type { JobPayloadCodecError } from "./JobContract.js"
import type { JobFailure } from "./JobFailure.js"
import { JobName, JobVersion, OperationName } from "./JobIdentity.js"
import type { JobDefinition } from "./Job.js"
import { decodeJobPayload } from "./JobPayloadCodec.js"
import { observe } from "./JobTelemetry.js"
import { prepareProjection } from "./internal/codec/ProtectedProjection.js"
import type { SingleKey } from "./internal/DeclarationTypes.js"

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
  readonly reason:
    | "invalid-name"
    | "empty-group"
    | "invalid-definition"
    | "duplicate-contract"
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
): Effect.Effect<JobGroup<Name, D>, InvalidJobGroup> =>
  Effect.gen(function* () {
    if (!Schema.is(OperationName)(name)) {
      return yield* new InvalidJobGroup({ reason: "invalid-name" })
    }
    if (
      typeof definitions !== "object" ||
      definitions === null ||
      Array.isArray(definitions)
    ) {
      return yield* new InvalidJobGroup({ reason: "invalid-definition" })
    }
    const entries = Object.entries(definitions)
    if (entries.length === 0) {
      return yield* new InvalidJobGroup({ reason: "empty-group" })
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
        return yield* new InvalidJobGroup({ reason: "invalid-definition", alias })
      }
      const seen = versions.get(definition.name) ?? new Set<number>()
      if (seen.has(definition.version)) {
        return yield* new InvalidJobGroup({ reason: "duplicate-contract", alias })
      }
      seen.add(definition.version)
      versions.set(definition.name, seen)
    }
    // Snapshot declarations without freezing caller-owned objects. Schemas retain
    // their native identity, annotations and encoding/decoding service contracts.
    const snapshot = Object.freeze(
      Object.fromEntries(
        entries.map((entry) => [entry[0], Object.freeze({ ...entry[1] })])
      )
    ) as D
    const service = Context.Service<Handlers<Name, D>, InstalledHandlers<D>>(
      `effect-jobs/JobGroup/${name}/${sequence.value++}`
    )

    return Object.freeze({ name, definitions: snapshot, handlers: service })
  })

const BuilderTypeId: unique symbol = Symbol("effect-jobs/JobGroup/HandlerBuilder")

/** Immutable builder. A union alias cannot prove that every possible member ran. */
export interface HandlerBuilder<
  D extends Definitions,
  Remaining extends keyof D,
  R = never
> {
  readonly [BuilderTypeId]: { readonly remaining: Remaining; readonly services: R }
  readonly handle: <const K extends Remaining & string, Requirements>(
    alias: K,
    handler: (
      input: HandlerInput<D[K]["payload"]["Type"]>
    ) => Effect.Effect<void, JobFailure, Requirements>
  ) => HandlerBuilder<
    D,
    SingleKey<K> extends never ? Remaining : Exclude<Remaining, K>,
    R | Requirements
  >
}

type Complete = {
  readonly [BuilderTypeId]: { readonly remaining: never; readonly services: unknown }
}
interface State {
  readonly owner: object
  readonly implementations: Readonly<Record<string, unknown>>
  readonly invalid: boolean
}
const states = new WeakMap<object, State>()

const builder = <D extends Definitions, Remaining extends keyof D, R>(
  definitions: D,
  state: State
): HandlerBuilder<D, Remaining, R> => {
  const handle: HandlerBuilder<D, Remaining, R>["handle"] = (alias, handler) =>
    builder(definitions, {
      owner: state.owner,
      invalid:
        state.invalid ||
        !Object.hasOwn(definitions, alias) ||
        Object.hasOwn(state.implementations, alias) ||
        typeof handler !== "function",
      implementations: Object.freeze({ ...state.implementations, [alias]: handler })
    })
  const result: HandlerBuilder<D, Remaining, R> = Object.freeze({
    // Phantom fields carry only completeness and inferred requirements.
    [BuilderTypeId]: Object.freeze({
      remaining: undefined as never,
      services: undefined as R
    }),
    handle
  })
  states.set(result, state)
  return result
}

/** Acquires callback dependencies once per Layer acquisition; invocation services
 * and Schema decoders use the existing per-job scoped installation runtime. */
export const handlers = <
  Name extends string,
  D extends Definitions,
  B extends Complete,
  E = never,
  R = never
>(
  declaration: JobGroup<Name, D> & NoInfer<SingleKey<Name>>,
  build: (handlers: HandlerBuilder<D, keyof D>) => B | Effect.Effect<B, E, R>
): Layer.Layer<
  Handlers<Name, D>,
  E | JobGroupConfigurationError,
  Exclude<R | B[typeof BuilderTypeId]["services"] | DecodingServices<D>, Scope.Scope>
> => {
  const acquisition = Effect.gen(function* () {
    const initial = builder<D, keyof D, never>(declaration.definitions, {
      owner: declaration.handlers,
      implementations: Object.freeze({}),
      invalid: false
    })
    const built = build(initial)
    const complete = Effect.isEffect(built) ? yield* built : built
    const state =
      typeof complete === "object" && complete !== null ? states.get(complete) : undefined
    if (!state || state.invalid || state.owner !== declaration.handlers) {
      return yield* new JobGroupConfigurationError({ reason: "invalid-handlers" })
    }
    return state.implementations as HandlersFrom<D>
  })
  // The erased runtime record is backed by exact builder E/R and completeness.
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unsafe-effect-type-assertion -- The existential record is validated at installation; B retains every concrete handler R, checked by positive and missing-service type fixtures.
  return install(declaration, acquisition) as Layer.Layer<
    Handlers<Name, D>,
    E | JobGroupConfigurationError,
    Exclude<R | B[typeof BuilderTypeId]["services"] | DecodingServices<D>, Scope.Scope>
  >
}

const install = <I, D extends Definitions, H extends HandlersFrom<D>, E, R>(
  group: {
    readonly definitions: D
    readonly handlers: Context.Key<I, InstalledHandlers<D>>
  },
  build: Effect.Effect<H, E, R>
): Layer.Layer<
  I,
  E | JobGroupConfigurationError,
  Exclude<R | HandlerServices<H> | DecodingServices<D>, Scope.Scope>
> => {
  const acquisition = Effect.gen(function* () {
    // Heterogeneous records are erased only inside acquisition. The public
    // mapped types retain each payload and the union of all actual services.
    const services = Context.omit(Scope.Scope)(yield* Effect.context<unknown>())
    const implementations = yield* build
    const aliases = Object.keys(group.definitions)
    const supplied = Object.keys(implementations)
    if (
      supplied.length !== aliases.length ||
      !aliases.every(
        (alias) =>
          Object.hasOwn(implementations, alias) &&
          typeof implementations[alias] === "function"
      )
    ) {
      return yield* new JobGroupConfigurationError({ reason: "invalid-handlers" })
    }
    const bound = yield* Effect.forEach(aliases, (alias) =>
      Effect.gen(function* () {
        const definition = group.definitions[alias]!
        yield* prepareProjection(definition.payload).pipe(
          Effect.mapError(
            () => new JobGroupConfigurationError({ reason: "unsupported-schema", alias })
          )
        )
        const execute = implementations[alias]!
        const handler: BoundHandler = (encoded, context) =>
          decodeJobPayload(definition.payload, encoded).pipe(
            Effect.flatMap((payload) =>
              Effect.suspend(() => execute({ payload, context })).pipe(
                observe("invoke", "handler")
              )
            ),
            Effect.provide(services),
            Effect.scoped
          )
        return [alias, handler] as const
      })
    )
    return Object.freeze(Object.fromEntries(bound)) as InstalledHandlers<D>
  })
  // Object iteration erases the mapped record's existential key and its R.
  // Acquisition captures exactly those requirements described by install.
  return Layer.effect(
    group.handlers,
    acquisition as Effect.Effect<
      InstalledHandlers<D>,
      E | JobGroupConfigurationError,
      R | HandlerServices<H> | DecodingServices<D>
    >
  )
}
