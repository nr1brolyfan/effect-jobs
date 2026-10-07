import { Effect, Schema } from "effect"
import * as Codes from "../../src/FailureCode.js"
import { JobFailures } from "../../src/JobFailure.js"
import * as Job from "../../src/Job.js"
import * as Policy from "../../src/JobPolicy.js"
import * as Queue from "../../src/JobQueue.js"
import { JobEnqueue, type JobBackendError } from "../../src/JobEnqueue.js"
import type { JobEnqueueError } from "../../src/JobTransaction.js"
import type { EnqueueResult } from "../../src/JobContract.js"
import {
  Document,
  DocumentKeys,
  EncryptedDocument
} from "../core/codec/EncryptedFixture.js"
import { makeJobTables } from "../../src/PostgreSqlDrizzleSchema.js"
import { index, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const codes = Codes.define({ busy: "provider_busy", lost: "response_lost" })
export const literal: "provider_busy" = codes.busy
export const branded: Codes.FailureCode = codes.busy
// @ts-expect-error Outcome constructors reject raw strings.
JobFailures.Retry({ code: "provider_busy" })
// @ts-expect-error Dynamic identifiers must be parsed.
const rawCode: Codes.FailureCode = "valid"
void rawCode
const base = {
  kind: "receipt",
  queue: Queue.make("billing"),
  payload: Schema.String
} as const
const omitted = Job.make(base)
export const one: 1 = omitted.version
export const catalogOne: 1 = omitted.catalog.version
export const two: 2 = Job.make({ ...base, version: 2 }).version
const optional: typeof base & { readonly version?: 2 } = base
const explicitOptional: typeof base & { readonly version: 2 | undefined } = {
  ...base,
  version: undefined
}
export const optionalUnion: 1 | 2 = Job.make(explicitOptional).version
export const undefinedOne: 1 = Job.make({ ...base, version: undefined }).version
export const union: 1 | 2 = Job.make(optional).version
// @ts-expect-error Optional input cannot promise runtime version 2.
const unsound: 2 = Job.make(optional).version
void unsound
// @ts-expect-error Default policy cannot be mutated through public types.
Policy.defaultPolicy.retrySchedule.delayMillis = 9
const job = Job.make({ ...base, payload: EncryptedDocument })
const input = {
  producer: { operation: "billing.issue", operationId: "id", slot: "receipt" },
  policy: Policy.defaultPolicy,
  payload: { recipient: "private", total: 1n }
}
export const joined: Effect.Effect<
  EnqueueResult,
  JobEnqueueError | JobBackendError,
  JobEnqueue | DocumentKeys
> = job.enqueue(input)
export const standalone: typeof joined = job.enqueueStandalone(input)
type ExpectFalse<T extends false> = T
export type ServicesRemain = ExpectFalse<
  typeof joined extends Effect.Effect<EnqueueResult, unknown, JobEnqueue> ? true : false
>
export const invalidPayload = job.enqueue({
  ...input,
  // @ts-expect-error Domain input is not the persisted encrypted envelope.
  payload: { ciphertext: "sealed", fingerprint: "stable" }
})
const domain: typeof Document.Type = {} as typeof EncryptedDocument.Type
void domain
makeJobTables({
  extraIndexes: (jobs) => [
    index("by_state")
      .on(jobs.state.asc(), jobs.id.desc())
      .where(sql`${jobs.state} = 'Pending'`)
  ]
})
makeJobTables({
  extraIndexes: (jobs) => {
    // @ts-expect-error No application-owned columns are fabricated.
    return [index("unknown").on(jobs.createdAt)]
  }
})
// @ts-expect-error Only index builders, not arbitrary checks/constraints.
makeJobTables({ extraIndexes: () => [check("extra", sql`true`)] })
