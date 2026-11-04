import type { JobQueue } from "../../JobQueue.js"

/** Validated internal invocation; concurrency is resolved from the worker. */
export interface QueueRun {
  readonly queue: JobQueue
  readonly localConcurrency: number
  readonly claimLimitPerRun: number
  readonly recoveryLimitPerRun: number
}
