/** Complete typed handler installation for a declared catalog group. */
import { Effect, Layer } from "effect"
import type { Scope } from "effect"
import type { Groups, JobApi, HandlerServices } from "./JobApi.js"
import type { Definitions, DecodingServices, HandlersFrom } from "./JobGroup.js"
import { JobGroupConfigurationError } from "./JobGroup.js"
import type { HandlerInput } from "./JobContract.js"
import type { JobFailure } from "./JobFailure.js"
import { install } from "./internal/worker/InstallHandlers.js"

const BuilderTypeId: unique symbol = Symbol("effect-jobs/JobApiBuilder")

type IsUnion<A, Whole = A> = A extends Whole
  ? [Whole] extends [A]
    ? false
    : true
  : never

/** Immutable builder. A union alias cannot prove that every possible member ran. */
export interface Handlers<D extends Definitions, Remaining extends keyof D, R = never> {
  readonly [BuilderTypeId]: { readonly remaining: Remaining; readonly services: R }
  readonly handle: <const K extends Remaining & string, Requirements>(
    alias: K,
    handler: (
      input: HandlerInput<D[K]["payload"]["Type"]>
    ) => Effect.Effect<void, JobFailure, Requirements>
  ) => Handlers<
    D,
    IsUnion<K> extends false ? Exclude<Remaining, K> : Remaining,
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
): Handlers<D, Remaining, R> => {
  const handle: Handlers<D, Remaining, R>["handle"] = (alias, handler) =>
    builder(definitions, {
      owner: state.owner,
      invalid:
        state.invalid ||
        !Object.hasOwn(definitions, alias) ||
        Object.hasOwn(state.implementations, alias) ||
        typeof handler !== "function",
      implementations: Object.freeze({ ...state.implementations, [alias]: handler })
    })
  const result: Handlers<D, Remaining, R> = Object.freeze({
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
export const group = <
  Name extends string,
  G extends Groups,
  const K extends keyof G & string,
  B extends Complete,
  E = never,
  R = never
>(
  api: JobApi<Name, G>,
  name: K,
  build: (
    handlers: Handlers<G[K]["definitions"], keyof G[K]["definitions"]>
  ) => B | Effect.Effect<B, E, R>
): Layer.Layer<
  HandlerServices<Pick<G, K>>,
  E | JobGroupConfigurationError,
  Exclude<
    R | B[typeof BuilderTypeId]["services"] | DecodingServices<G[K]["definitions"]>,
    Scope.Scope
  >
> => {
  const declaration = api.groups[name]
  // Unknown names in JavaScript/type bypass fail in Layer E before acquisition.
  if (!Object.hasOwn(api.groups, name) || !declaration) {
    return Layer.effectContext(
      Effect.fail(new JobGroupConfigurationError({ reason: "invalid-handlers" }))
    )
  }
  const acquisition = Effect.gen(function* () {
    const initial = builder<G[K]["definitions"], keyof G[K]["definitions"], never>(
      declaration.definitions,
      {
        owner: declaration.handlers,
        implementations: Object.freeze({}),
        invalid: false
      }
    )
    const built = build(initial)
    const complete = Effect.isEffect(built) ? yield* built : built
    const state =
      typeof complete === "object" && complete !== null ? states.get(complete) : undefined
    if (!state || state.invalid || state.owner !== declaration.handlers) {
      return yield* new JobGroupConfigurationError({ reason: "invalid-handlers" })
    }
    return state.implementations as HandlersFrom<G[K]["definitions"]>
  })
  // The erased runtime record is backed by exact builder E/R and completeness.
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context, effecttsgo/unsafe-effect-type-assertion -- The existential record is validated at installation; B retains every concrete handler R, checked by positive and missing-service type fixtures.
  return install(declaration, acquisition) as Layer.Layer<
    HandlerServices<Pick<G, K>>,
    E | JobGroupConfigurationError,
    Exclude<
      R | B[typeof BuilderTypeId]["services"] | DecodingServices<G[K]["definitions"]>,
      Scope.Scope
    >
  >
}
