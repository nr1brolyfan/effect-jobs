/** Queue-independent versioned domain contracts. Construction starts no work. */
import { Data, Effect, Schema } from "effect"
import { JobName, JobVersion } from "./JobIdentity.js"
import { prepareProjection } from "./internal/codec/ProtectedProjection.js"

/** Invalid static declaration; never contains payload values. @category errors */
export class InvalidJobDefinition extends Data.TaggedError("InvalidJobDefinition")<{
  readonly expected: string
}> {}

/** Schema preserves decoded/encoded types and both service requirements.
 * Routing and policy are selected during production, not by this contract.
 * @category models
 */
export interface JobDefinition<
  Payload extends Schema.Top = Schema.Top,
  Name extends string = string,
  Version extends number = number
> {
  readonly name: Name
  readonly version: Version
  readonly payload: Payload
}

/**
 * Lazily declares a frozen contract with version 1 when omitted. Each execution
 * snapshots the configuration. Invalid declarations and unsupported Schemas fail
 * with InvalidJobDefinition, without acquiring encoding or decoding services.
 * Install complete handlers with JobGroup; produce through JobProducer slots.
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import * as Job from "effect-jobs/Job"
 *
 * const definition = Job.make({
 *   name: "invoice.generate",
 *   payload: Schema.Struct({ invoiceId: Schema.String })
 * })
 * ```
 * @category constructors
 */
export function make<
  Payload extends Schema.Top,
  const Name extends string,
  const Version extends number
>(options: {
  readonly name: Name
  readonly version: Version
  readonly payload: Payload
}): Effect.Effect<JobDefinition<Payload, Name, Version>, InvalidJobDefinition>
export function make<Payload extends Schema.Top, const Name extends string>(options: {
  readonly name: Name
  readonly version?: undefined
  readonly payload: Payload
}): Effect.Effect<JobDefinition<Payload, Name, 1>, InvalidJobDefinition>
export function make<
  Payload extends Schema.Top,
  const Name extends string,
  const Version extends number = 1
>(options: {
  readonly name: Name
  readonly version?: Version | undefined
  readonly payload: Payload
}): Effect.Effect<JobDefinition<Payload, Name, Version | 1>, InvalidJobDefinition>
export function make<
  Payload extends Schema.Top,
  Name extends string,
  Version extends number
>(options: {
  readonly name: Name
  readonly version?: Version | undefined
  readonly payload: Payload
}): Effect.Effect<JobDefinition<Payload, Name, Version | 1>, InvalidJobDefinition> {
  return Effect.gen(function* () {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      return yield* new InvalidJobDefinition({
        expected: "name, version and payload Schema only"
      })
    }
    const name = options.name
    const configuredVersion = options.version
    const version = configuredVersion === undefined ? 1 : configuredVersion
    const payload = options.payload
    if (
      Object.keys(options).some(
        (key) => key !== "name" && key !== "version" && key !== "payload"
      ) ||
      !Schema.is(JobName)(name) ||
      !Schema.is(JobVersion)(version) ||
      !Schema.isSchema(payload)
    ) {
      return yield* new InvalidJobDefinition({
        expected: "name, version and payload Schema only"
      })
    }
    yield* prepareProjection(payload).pipe(
      Effect.mapError(
        () =>
          new InvalidJobDefinition({
            expected: "payload Schema supported by the standard artifact codec"
          })
      )
    )
    return Object.freeze({ name, version, payload })
  })
}
