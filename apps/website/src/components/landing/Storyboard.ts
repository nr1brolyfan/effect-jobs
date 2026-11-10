export type JobState =
  | "Awaiting request"
  | "Pending"
  | "Active"
  | "RetryScheduled"
  | "Completed"
export const frames = [
  ["Pending", "Awaiting request", "Awaiting request", "Awaiting request"],
  ["Active:0", "Pending", "Awaiting request", "Awaiting request"],
  ["Active:0", "Active:1", "Awaiting request", "Awaiting request"],
  ["Active:0", "Active:1", "Pending", "Pending"],
  ["Completed", "RetryScheduled", "Pending", "Pending"],
  ["Completed", "RetryScheduled", "Active:0", "Active:1"],
  ["Completed", "RetryScheduled", "Active:0", "Active:1"],
  ["Completed", "RetryScheduled", "Completed", "Active:1"],
  ["Completed", "RetryScheduled", "Completed", "Completed"],
  ["Completed", "Active:0", "Completed", "Completed"],
  ["Completed", "Active:0", "Completed", "Completed"],
  ["Completed", "Completed", "Completed", "Completed"]
] as const
export const explanations = {
  "Awaiting request":
    "The next synthetic request has not arrived. No job has been enqueued.",
  Pending: "The job is persisted. A free worker slot can claim it when it is due.",
  Active:
    "A worker is executing the handler. The worker owns durable finalization; the handler does not acknowledge its own job.",
  RetryScheduled:
    "Report 02 has a confirmed retryable failure. Its first persisted policy allows another attempt after the stored delay. This is not an unknown outcome.",
  Completed:
    "The worker has confirmed completion. Retention bounds how long the producer identity can prevent duplicate production."
}

export const stateOf = (value: string): JobState => value.split(":")[0] as JobState
