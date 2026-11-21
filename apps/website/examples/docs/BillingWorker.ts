import { Context, Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobApi from "effect-jobs/JobApi"
import type { JobFailure } from "effect-jobs/JobFailure"
import * as JobGroup from "effect-jobs/JobGroup"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobWorker from "effect-jobs/JobWorker"
import { ReceiptPayload, SendReceipt } from "./ReceiptJob.js"

export class ReceiptMailer extends Context.Service<
  ReceiptMailer,
  {
    readonly send: (
      payload: typeof ReceiptPayload.Type,
      deliveryKey: string
    ) => Effect.Effect<void, JobFailure>
  }
>()("billing/ReceiptMailer") {}

const GeneratePdf = Job.make({
  name: "invoice.pdf",
  payload: Schema.Struct({ invoiceId: Schema.String })
})

export const billingGroups = Effect.gen(function* () {
  const Emails = yield* JobGroup.make("billing-emails", { email: yield* SendReceipt })
  const Exports = yield* JobGroup.make("billing-exports", { pdf: yield* GeneratePdf })
  return { Emails, Exports }
})

export const EmailWorkerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const EmailQueue = yield* JobQueue.make("billing-email")
    const { Emails } = yield* billingGroups
    const emailApi = yield* JobApi.make("email-worker").pipe(JobApi.addGroup(Emails))
    const EmailHandlers = JobGroup.handlers(Emails, (handlers) =>
      handlers.handle(
        "email",
        Effect.fnUntraced(function* (input) {
          const mailer = yield* ReceiptMailer
          yield* mailer.send(input.payload, input.context.jobId)
        })
      )
    )

    return JobWorker.layer(emailApi, { queues: [{ queue: EmailQueue }] }).pipe(
      Layer.provide(EmailHandlers)
    )
  })
)
