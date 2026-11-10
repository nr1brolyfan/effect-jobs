export type Variant = "overview" | "transaction" | "handoff"
export type Outcome = "commit" | "rollback"
export const maximum = (variant: Variant) => (variant === "transaction" ? 4 : 5)
export const presentation = (variant: Variant, step: number, mode: Outcome) => {
  const labels: Record<string, string> = {}
  const nodes: Record<string, boolean> = {}
  let result = "staged"
  let dim = false
  const text = (name: string, value: string) => {
    labels[name] = value
  }
  const active = (name: string, value: boolean) => {
    nodes[name] = value
  }
  const s = step
  let stages: string[]
  if (variant === "overview") {
    stages = [
      "Ready",
      "Order + job committed",
      "Order accepted",
      "Worker claims the job",
      "Confirmation sent",
      "Job completed"
    ]
    text("response", s >= 2 ? "201 Created" : s === 1 ? "Saved" : "Ready")
    text("order", s >= 1 ? "#041" : "—")
    text("orderState", s >= 1 ? "✓" : "")
    text("jobState", s >= 5 ? "Completed" : s >= 3 ? "Active" : s >= 1 ? "Pending" : "—")
    text(
      "workerState",
      s >= 5 ? "Done" : s === 4 ? "Finalizing" : s === 3 ? "Sending…" : "Waiting"
    )
    text("emailState", s >= 4 ? "Sent" : "—")
    active("api", s >= 1)
    active("job", s >= 1)
    active("worker", s >= 3)
    active("email", s >= 4)
  } else if (variant === "transaction") {
    const rolledBack = mode === "rollback" && s >= 3
    const committed = mode === "commit" && s >= 3
    stages = [
      "Ready",
      "Insert order",
      "Enqueue confirmation",
      rolledBack ? "Nothing persisted" : "Both records committed",
      rolledBack ? "Nothing to claim" : "Worker claims the job"
    ]
    text("decision", s >= 3 ? (rolledBack ? "ROLLBACK" : "COMMIT") : "Uncommitted")
    text("order", s >= 1 && !rolledBack ? "#041" : "—")
    text("job", s >= 2 && !rolledBack ? "Confirmation" : "—")
    text("orderState", committed ? "✓" : "")
    text("jobState", committed ? "✓" : "")
    text("workerState", rolledBack ? "No job" : s === 4 ? "Claimed" : "Waiting")
    result = s >= 3 ? mode : "staged"
    active("order", s >= 1 && !rolledBack)
    active("job", s >= 2 && !rolledBack)
    active("worker", committed && s === 4)
  } else {
    stages = [
      "Ready",
      "Two independent jobs",
      "Both handlers run",
      "Invoice saved + delivery enqueued",
      "Delivery runs independently",
      "Both emails sent"
    ]
    text(
      "confirmationState",
      s === 5 ? "Completed" : s >= 2 ? "Active" : s === 1 ? "Pending" : "—"
    )
    text(
      "invoiceState",
      s >= 3 ? "Completed" : s === 2 ? "Active" : s === 1 ? "Pending" : "—"
    )
    text(
      "deliveryState",
      s === 5 ? "Completed" : s === 4 ? "Active" : s === 3 ? "Pending" : "—"
    )
    active("origin", s >= 1)
    active("confirmation", s >= 2)
    active("invoice", s >= 2)
    active("delivery", s >= 4)
    dim = s < 3
  }
  text("progress", stages[s]!)
  return { labels, nodes, result, dim }
}
export const descriptions = {
  overview:
    "Illustration: the API commits an order and a confirmation job together, responds to the customer, and a worker sends the email afterward. Completed job evidence remains stored.",
  transaction:
    "Illustration: an order and a job are staged inside one transaction. Commit persists both; confirmed rollback persists neither. Only a committed, due job can be claimed by a worker. This does not depict an unknown commit outcome.",
  handoff:
    "Illustration: order placement produces independent confirmation and invoice jobs. Creating the invoice explicitly enqueues its delivery. Confirmation is not a prerequisite for invoice creation or delivery."
}
