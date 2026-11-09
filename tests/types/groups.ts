import * as JobApi from "../../src/JobApi.js"
import * as JobApiBuilder from "../../src/JobApiBuilder.js"
import { Context, Effect, Layer, Schema } from "effect"
import * as Group from "../../src/JobGroup.js"

class Mailer extends Context.Service<Mailer, {}>()("types/groups/Mailer") {}
class Keys extends Context.Service<Keys, {}>()("types/groups/Keys") {}
class Setup extends Context.Service<Setup, {}>()("types/groups/Setup") {}

declare const encrypted: Schema.Codec<{ readonly value: string }, string, Keys>
const definitions = {
  receipt: { kind: "billing.receipt", version: 1, payload: encrypted },
  pdf: { kind: "billing.pdf", version: 1, payload: Schema.Struct({ id: Schema.Finite }) }
} as const
const billing = Group.make("billing", definitions)
const handlers = JobApiBuilder.group(
  JobApi.make(billing.name).pipe(JobApi.addGroup(billing)),
  billing.name,
  (_handlers) =>
    _handlers
      .handle("receipt", (input) =>
        Effect.gen(function* () {
          yield* Mailer
          const value: string = input.payload.value
          void value
        })
      )
      .handle("pdf", (input) =>
        Effect.sync(() => {
          const id: number = input.payload.id
          void id
        })
      )
)
type ExpectFalse<T extends false> = T
export type MissingMailerRejected = ExpectFalse<
  typeof handlers extends Layer.Layer<unknown, unknown, Keys> ? true : false
>
export type MissingKeysRejected = ExpectFalse<
  typeof handlers extends Layer.Layer<unknown, unknown, Mailer> ? true : false
>
export const channels: Layer.Layer<
  Group.Handlers<"billing", typeof definitions>,
  Group.JobGroupConfigurationError,
  Mailer | Keys
> = handlers

export type IncompleteHandlersRejected = ExpectFalse<
  { readonly receipt: () => Effect.Effect<void> } extends Group.HandlersFrom<
    typeof definitions
  >
    ? true
    : false
>
/* oxlint-disable effecttsgo/any-unknown-in-error-context -- Intentionally incomplete implementation for a static rejection test. */
JobApiBuilder.group(
  JobApi.make(billing.name).pipe(JobApi.addGroup(billing)),
  billing.name,
  // @ts-expect-error The actual installer rejects an incomplete builder.
  (_handlers) => _handlers.handle("receipt", () => Effect.void)
)
/* oxlint-enable effecttsgo/any-unknown-in-error-context */
JobApiBuilder.group(
  JobApi.make(billing.name).pipe(JobApi.addGroup(billing)),
  billing.name,
  (_handlers) =>
    _handlers
      .handle("receipt", () => Effect.void)
      .handle("pdf", (input) =>
        Effect.sync(() => {
          // @ts-expect-error Each alias uses its own definition's payload.
          const wrong: string = input.payload.id
          void wrong
        })
      )
)
export type DomainFailuresRejected = ExpectFalse<
  (() => Effect.Effect<void, "domain-error">) extends Group.HandlersFrom<
    typeof definitions
  >["receipt"]
    ? true
    : false
>

const setup = JobApiBuilder.group(
  JobApi.make(billing.name).pipe(JobApi.addGroup(billing)),
  billing.name,
  (_handlers) =>
    Effect.gen(function* () {
      yield* Setup
      yield* Effect.acquireRelease(Effect.void, () => Effect.void)
      if (yield* Effect.succeed(false)) {
        return yield* Effect.fail("setup-error" as const)
      }
      return _handlers
        .handle("receipt", () => Effect.void)
        .handle("pdf", () => Effect.void)
    })
)
export const setupChannels: Layer.Layer<
  Group.Handlers<"billing", typeof definitions>,
  "setup-error" | Group.JobGroupConfigurationError,
  Setup | Keys
> = setup

const other = Group.make("other", definitions)
export type WrongGroupRejected = ExpectFalse<
  typeof other.handlers extends typeof billing.handlers ? true : false
>
