import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import { nextDelay, repairMillis } from "../src/Wake.js"
import { admitDevelopment, decodeRequest } from "../src/Domain.js"
const idle = { _tag: "Idle", claimed: 0, recovered: 0 } as const
const empty = {
  observedAt: 500000,
  nextAvailableAt: null,
  nextRecoveryAt: null,
  saturated: false
}
assert.equal(nextDelay(idle, empty), repairMillis)
assert.equal(nextDelay(idle, { ...empty, saturated: true }), 1000)
assert.equal(nextDelay(idle, { ...empty, nextAvailableAt: 499999 }), 1000)
assert.equal(nextDelay(idle, { ...empty, nextRecoveryAt: 505000 }), 5000)
assert.equal(nextDelay(idle, { ...empty, nextAvailableAt: 900000 }), repairMillis)
assert.equal(nextDelay({ _tag: "MoreWork", claimed: 4, recovered: 4 }, empty), 1000)
assert.equal(
  nextDelay({ _tag: "Backoff", phase: "claim", claimed: 0 }, empty),
  repairMillis
)
assert.equal(
  await Effect.runPromise(admitDevelopment("Bearer development-alice")),
  "tenant-a"
)
assert(
  Exit.isFailure(
    await Effect.runPromiseExit(
      decodeRequest({ tenantId: "tenant-b", invoiceId: "invoice-b", requestId: "one" })
    )
  )
)
console.log(
  "database-relative delay, saturation/null/Idle repair and tenant boundary PASS"
)
