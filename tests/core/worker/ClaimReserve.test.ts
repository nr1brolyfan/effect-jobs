import { Duration, Effect, Schema } from "effect"
import { expect, it } from "vitest"
import * as Codec from "../../../src/JobPayloadCodec.js"
import * as Policy from "../../../src/JobPolicy.js"
import { verifyClaimReserve } from "../../contracts/ClaimReserve.js"
import { harness } from "./Harness.js"

it("conforms to the claim reserve boundary in the in-memory worker fixture", async () => {
  await verifyClaimReserve(async (reserveMillis) => {
    const policy = await Effect.runPromise(
      Policy.make({
        attemptTimeout: Duration.seconds(5),
        leaseDuration: Duration.millis(5_000 + reserveMillis)
      })
    )
    const catalog = { queue: "reserve", name: "claim", version: 1 }
    const encoded = await Effect.runPromise(Codec.encodeJobPayload(Schema.String, "test"))
    const fixture = harness([
      {
        policy,
        catalog,
        encoded,
        producer: { operation: "reserve", operationId: "claim", slot: "run" }
      }
    ])
    return {
      catalog,
      claim: (request) =>
        Effect.runPromise(fixture.store.claim(request).pipe(Effect.result)),
      read: async () => {
        const snapshot = fixture.rows[0]!.snapshot
        return { state: snapshot.state, leaseToken: snapshot.leaseToken, snapshot }
      },
      expectAccepted: (result) => expect(result._tag).toBe("Claimed")
    }
  })
})
