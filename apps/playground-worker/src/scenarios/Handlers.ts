import { Cause, Effect, Layer, Match } from "effect"
import * as FailureCode from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"
import type { HandlerInput } from "effect-jobs/JobContract"
import * as Codec from "effect-jobs/JobPayloadCodec"
import { FakeProvider, type ProviderFailure } from "../providers/FakeProvider.js"
import * as Definitions from "./Definitions.js"

export const codes = FailureCode.define({
  rejected: "fake_provider_retry_rejected",
  terminal: "fake_provider_terminal_rejected",
  invariant: "fake_provider_invariant",
  lost: "fake_provider_response_lost",
  conflict: "fake_provider_payload_conflict",
  capacity: "fake_provider_ledger_full",
  codec: "scenario_codec_invalid"
})
export const toJobFailure = Match.type<ProviderFailure>().pipe(
  Match.when({ _tag: "RetryRejected" }, () =>
    JobFailures.Retry({ code: codes.rejected })
  ),
  Match.when({ _tag: "TerminalRejected" }, () =>
    JobFailures.Dead({ code: codes.terminal })
  ),
  Match.when({ _tag: "InvariantViolation" }, () =>
    JobFailures.Isolate({ code: codes.invariant })
  ),
  Match.when({ _tag: "ResponseLost" }, () =>
    JobFailures.OutcomeUnknown({ code: codes.lost })
  ),
  Match.when({ _tag: "PayloadConflict" }, () =>
    JobFailures.Isolate({ code: codes.conflict })
  ),
  Match.when({ _tag: "LedgerFull" }, () => JobFailures.Dead({ code: codes.capacity })),
  Match.exhaustive
)

export const execute = (workload: Exclude<Definitions.Workload, "private-data-export">) =>
  Effect.fn("Playground.execute")(function* ({
    payload,
    context
  }: HandlerInput<Definitions.Payload>) {
    const provider = yield* FakeProvider
    const encoded = yield* Codec.encodeJobPayload(Definitions.Payload, payload).pipe(
      Effect.catchCause((cause) =>
        Effect.failCause(
          Cause.map(cause, () => JobFailures.Isolate({ code: codes.codec }))
        )
      )
    )
    yield* provider
      .execute({
        sandbox: payload.sandbox,
        producer: context.producer,
        workload,
        behavior: payload.behavior,
        semanticProjection: encoded.semanticProjectionBytes
      })
      .pipe(
        Effect.catchCause((cause) => Effect.failCause(Cause.map(cause, toJobFailure)))
      )
  })

export const executeExport = Effect.fn("Playground.executeExport")(function* ({
  payload,
  context
}: HandlerInput<Definitions.ExportPayload>) {
  const provider = yield* FakeProvider
  if (
    payload.document.subject !== payload.actor ||
    payload.document.tenant !== payload.tenant
  ) {
    return yield* Effect.fail(JobFailures.Isolate({ code: codes.invariant }))
  }
  const encoded = yield* Codec.encodeJobPayload(Definitions.ExportPayload, payload).pipe(
    Effect.catchCause((cause) =>
      Effect.failCause(Cause.map(cause, () => JobFailures.Isolate({ code: codes.codec })))
    )
  )
  yield* provider
    .execute({
      sandbox: payload.sandbox,
      producer: context.producer,
      workload: "private-data-export",
      behavior: payload.behavior,
      semanticProjection: encoded.semanticProjectionBytes
    })
    .pipe(Effect.catchCause((cause) => Effect.failCause(Cause.map(cause, toJobFailure))))
})

// Proposal for HandlerRegistry.ts; importing this module installs nothing.
// Provide the same FakeProvider Layer and DocumentKeys Layer for all handlers.
export const layerNoDeps = Layer.mergeAll(
  Definitions.WelcomeEmail.handlerLayer(execute("welcome-email"), Codec.decodeJobPayload),
  Definitions.ImageProcessing.handlerLayer(
    execute("image-processing"),
    Codec.decodeJobPayload
  ),
  Definitions.WebhookDelivery.handlerLayer(
    execute("webhook-delivery"),
    Codec.decodeJobPayload
  ),
  Definitions.PrivateDataExport.handlerLayer(executeExport, Codec.decodeJobPayload),
  Definitions.CatalogSync.handlerLayer(execute("catalog-sync"), Codec.decodeJobPayload),
  Definitions.SimulatedPayment.handlerLayer(
    execute("simulated-payment"),
    Codec.decodeJobPayload
  )
)
