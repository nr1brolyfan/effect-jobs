import { expect } from "vitest"
import type { Result } from "effect"
import type { JobAddress } from "../../src/JobIdentity.js"
import type { ClaimRequest, ClaimResult } from "../../src/JobStore.js"

interface ReserveFixture {
  readonly catalog: JobAddress
  readonly claim: (request: ClaimRequest) => Promise<Result.Result<ClaimResult, unknown>>
  readonly read: () => Promise<{
    readonly state: string
    readonly leaseToken: string | null
    readonly snapshot: unknown
  }>
  // PostgreSQL verifies the remaining lease again after commit. When the
  // response consumed time, Unknown is compatible with a committed claim.
  readonly expectAccepted: (result: ClaimResult) => void
}

export const verifyClaimReserve = async (
  seed: (reserveMillis: 99 | 100) => Promise<ReserveFixture>
) => {
  for (const reserveMillis of [99, 100] as const) {
    const fixture = await seed(reserveMillis)
    const leaseToken = globalThis.crypto.randomUUID()
    const before = await fixture.read()
    expect(before).toMatchObject({ state: "Pending", leaseToken: null })
    const result = await fixture.claim({
      queue: fixture.catalog.queue,
      supportedCatalog: [fixture.catalog],
      leaseToken
    })
    if (reserveMillis === 99) {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "JobPolicyIncompatible", reserveMillis: 99, requiredMillis: 100 }
      })
      expect(await fixture.read()).toEqual(before)
    } else {
      if (result._tag !== "Success") {
        throw new Error("The claim at the exact reserve budget must succeed")
      }
      fixture.expectAccepted(result.success)
      expect(await fixture.read()).toMatchObject({ state: "Active", leaseToken })
    }
  }
}
