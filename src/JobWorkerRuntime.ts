import { drainWithOptions } from "./internal/worker/Drain.js"
import type { JobConsumer } from "./JobConsumer.js"

export { DrainResults } from "./internal/worker/Results.js"
export type { DrainResult } from "./internal/worker/Results.js"

/** Finite drain, sharing per-runtime queue permits across concurrent invocations. */
export const drain = (consumer: JobConsumer) => drainWithOptions(consumer)
