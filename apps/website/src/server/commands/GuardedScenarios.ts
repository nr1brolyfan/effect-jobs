import { Effect, Layer, Schema } from "effect"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import type { SandboxAccess, SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import {
  ReceiptRequest,
  ResetCommand,
  ResetResult,
  ScenarioCommand,
  ScenarioResult
} from "@effect-jobs/playground-contracts/Scenarios"
import {
  PlaygroundError,
  SandboxAuthority,
  Scenarios
} from "@effect-jobs/playground-contracts/Services"
import { CommandPersistence } from "../../../../playground-worker/src/persistence/commands/Transactions.js"

const fail = (code: PlaygroundError["code"]) => new PlaygroundError({ code })
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: unknown,
  code: PlaygroundError["code"] = "invalid-request"
) =>
  Schema.decodeUnknownEffect(schema)(value, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => fail(code))
  )

export const make = Effect.gen(function* () {
  const authority = yield* SandboxAuthority
  const persistence = yield* CommandPersistence
  const authorize = Effect.fnUntraced(function* (
    access: SandboxAccess,
    expected: SandboxRef,
    operation: "runScenario" | "resetSandbox" | "receipt"
  ) {
    const view = yield* decode(
      SandboxView,
      yield* authority.describe(access),
      "unavailable"
    )
    if (
      view.ref.sandboxId !== access.sandbox.ref.sandboxId ||
      expected.sandboxId !== view.ref.sandboxId
    ) {
      return yield* fail("not-found")
    }
    if (
      operation === "receipt"
        ? expected.generation > view.ref.generation
        : expected.generation !== view.ref.generation
    ) {
      return yield* fail("stale-generation")
    }
    // Authority.describe owns persisted DB-time expiry. Booleans from the caller
    // are ignored; these hints come from the freshly authenticated authority.
    if (operation !== "receipt" && !view.capabilities[operation]) {
      return yield* fail("capability-unavailable")
    }
    return { sandbox: view }
  })
  return Scenarios.of({
    run: Effect.fn("Commands.run")(function* (access, input) {
      const command = yield* decode(ScenarioCommand, input)
      const admitted = yield* authorize(access, command.sandbox, "runScenario")
      const result = yield* decode(
        ScenarioResult,
        yield* persistence.run(admitted, command),
        "unavailable"
      )
      if (
        result.requestId !== command.requestId ||
        result.sandbox.sandboxId !== command.sandbox.sandboxId ||
        result.sandbox.generation !== command.sandbox.generation ||
        (result._tag === "Committed" && result.jobIds.length !== command.count)
      ) {
        return yield* fail("unavailable")
      }
      return result
    }),
    reset: Effect.fn("Commands.reset")(function* (access, input) {
      const command = yield* decode(ResetCommand, input)
      const admitted = yield* authorize(access, command.sandbox, "resetSandbox")
      const result = yield* decode(
        ResetResult,
        yield* persistence.reset(admitted, command),
        "unavailable"
      )
      if (
        result.requestId !== command.requestId ||
        result.previous.sandboxId !== command.sandbox.sandboxId ||
        result.previous.generation !== command.sandbox.generation
      ) {
        return yield* fail("unavailable")
      }
      return result
    }),
    scenarioReceipt: Effect.fn("Commands.scenarioReceipt")(function* (access, input) {
      const request = yield* decode(ReceiptRequest, input)
      const admitted = yield* authorize(access, request.sandbox, "receipt")
      const result = yield* decode(
        ScenarioResult,
        yield* persistence.scenarioReceipt(admitted, request),
        "unavailable"
      )
      if (
        result.requestId !== request.requestId ||
        result.sandbox.sandboxId !== request.sandbox.sandboxId ||
        result.sandbox.generation !== request.sandbox.generation
      ) {
        return yield* fail("unavailable")
      }
      return result
    }),
    resetReceipt: Effect.fn("Commands.resetReceipt")(function* (access, input) {
      const request = yield* decode(ReceiptRequest, input)
      const admitted = yield* authorize(access, request.sandbox, "receipt")
      const result = yield* decode(
        ResetResult,
        yield* persistence.resetReceipt(admitted, request),
        "unavailable"
      )
      if (
        result.requestId !== request.requestId ||
        result.previous.sandboxId !== request.sandbox.sandboxId ||
        result.previous.generation !== request.sandbox.generation
      ) {
        return yield* fail("unavailable")
      }
      return result
    })
  })
})
export const layerNoDeps = Layer.effect(Scenarios, make)

// Staged operator contracts exist; capabilities remain disabled until native
// library persistence is integrated and qualified.
export const operatorCapabilities = Object.freeze({
  retryJob: false,
  redriveJob: false,
  cancelJob: false
})
export const unsupportedOperatorAction = () => Effect.fail(fail("capability-unavailable"))
