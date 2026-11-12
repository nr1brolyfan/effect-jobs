/** Shared installation runtime; public declarations stay inert and provider-free. */
/* oxlint-disable effecttsgo/any-unknown-in-error-context -- Existential handlers
 * are erased only inside acquisition; the public builder retains concrete R. */
import { Context, Effect, Layer, Scope } from "effect"
import type {
  Definitions,
  HandlersFrom,
  HandlerServices,
  DecodingServices,
  InstalledHandlers,
  BoundHandler
} from "../../JobGroup.js"
import { JobGroupConfigurationError } from "../../JobGroup.js"
import { decodeJobPayload } from "../../JobPayloadCodec.js"
import { observe } from "../../JobTelemetry.js"
import { prepareProjection } from "../codec/ProtectedProjection.js"

export const install = <I, D extends Definitions, H extends HandlersFrom<D>, E, R>(
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
