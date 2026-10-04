import { Context, Effect, Layer, Schema } from "effect"
import { expect, it } from "vitest"

it("provides an Effect 4 service through a Layer", async () => {
  class Greeting extends Context.Service<
    Greeting,
    { readonly message: Effect.Effect<string> }
  >()("effect-jobs/tests/Greeting") {}

  const live = Layer.succeed(Greeting, { message: Effect.succeed("hello") })
  const program = Effect.gen(function* () {
    const greeting = yield* Greeting
    return yield* greeting.message
  })

  expect(await Effect.runPromise(program.pipe(Effect.provide(live)))).toBe("hello")
})

it("decodes untrusted payloads and reports Schema failures", async () => {
  const Payload = Schema.Struct({ message: Schema.String })
  const valid: unknown = { message: "hello" }
  const invalid: unknown = { message: 42 }
  const decode = Schema.decodeUnknownEffect(Payload, { onExcessProperty: "error" })

  expect(await Effect.runPromise(decode(valid))).toEqual({ message: "hello" })
  expect(await Effect.runPromise(decode(invalid).pipe(Effect.result))).toMatchObject({
    _tag: "Failure",
    failure: { _tag: "SchemaError" }
  })
})

it("releases a scoped resource after a typed failure", async () => {
  const events: Array<string> = []
  const resource = Effect.acquireRelease(
    Effect.sync(() => {
      events.push("acquire")
      return "resource"
    }),
    () => Effect.sync(() => events.push("release"))
  )
  const program = Effect.gen(function* () {
    yield* resource
    return yield* Effect.fail("expected_failure")
  })

  expect(
    await Effect.runPromise(program.pipe(Effect.scoped, Effect.result))
  ).toMatchObject({ _tag: "Failure", failure: "expected_failure" })
  expect(events).toEqual(["acquire", "release"])
})
