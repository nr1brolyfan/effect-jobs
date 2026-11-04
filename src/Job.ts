/** Queue-independent versioned domain contracts. Construction starts no work. */
import { Data, Effect, Exit, Schema } from "effect"
import { JobKind, JobVersion } from "./JobIdentity.js"
import { prepareProjection } from "./internal/codec/ProtectedProjection.js"

/** Invalid static declaration; never contains payload values. @category errors */
export class InvalidJobDefinition extends Data.TaggedError("InvalidJobDefinition")<{
  readonly expected: string
}> {}

/** Schema preserves decoded/encoded types and both service requirements.
 * Routing and policy belong to producer slots, not this contract.
 * @category models
 */
export interface JobDefinition<
  Payload extends Schema.Top = Schema.Top,
  Kind extends string = string,
  Version extends number = number
> {
  readonly kind: Kind
  readonly version: Version
  readonly payload: Payload
}

/**
 * Declares a frozen contract with version 1 when omitted. Unsupported Schema
 * structures fail before production; transformations and encryption use Schema.
 * Install complete handlers with JobGroup; produce through JobProducer slots.
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import * as Job from "effect-jobs/Job"
 *
 * const definition = Job.make({
 *   kind: "invoice.generate",
 *   payload: Schema.Struct({ invoiceId: Schema.String })
 * })
 * ```
 * @category constructors
 */
export function make<
  Payload extends Schema.Top,
  const Kind extends string,
  const Version extends number
>(options: {
  readonly kind: Kind
  readonly version: Version
  readonly payload: Payload
}): JobDefinition<Payload, Kind, Version>
export function make<Payload extends Schema.Top, const Kind extends string>(options: {
  readonly kind: Kind
  readonly version?: undefined
  readonly payload: Payload
}): JobDefinition<Payload, Kind, 1>
export function make<
  Payload extends Schema.Top,
  const Kind extends string,
  const Version extends number = 1
>(options: {
  readonly kind: Kind
  readonly version?: Version | undefined
  readonly payload: Payload
}): JobDefinition<Payload, Kind, Version | 1>
export function make<
  Payload extends Schema.Top,
  Kind extends string,
  Version extends number
>(options: {
  readonly kind: Kind
  readonly version?: Version | undefined
  readonly payload: Payload
}): JobDefinition<Payload, Kind, Version | 1> {
  const kind = options.kind
  const version = options.version === undefined ? 1 : options.version
  const payload = options.payload
  if (
    Object.keys(options).some(
      (key) => key !== "kind" && key !== "version" && key !== "payload"
    ) ||
    !Schema.is(JobKind)(kind) ||
    !Schema.is(JobVersion)(version) ||
    !Schema.isSchema(payload)
  ) {
    throw new InvalidJobDefinition({ expected: "kind, version and payload Schema only" })
  }
  if (Exit.isFailure(Effect.runSyncExit(prepareProjection(payload)))) {
    throw new InvalidJobDefinition({
      expected: "payload Schema supported by the standard artifact codec"
    })
  }
  return Object.freeze({ kind, version, payload })
}
