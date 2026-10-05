import { Effect, Result } from "effect"
import { describe, expect, it } from "vitest"
import * as L from "../../../src/JobLifecycle.js"
import * as S from "../../../src/JobStore.js"
import * as R from "../../../src/internal/lifecycle/Reconciliation.js"
import {
  active,
  claimed,
  finalizationRequest,
  now,
  ownership,
  request,
  token
} from "./fixtures.js"

const value = Result.getOrThrow
/** Scripted protocol responses only: no persistence, atomicity or concurrency claim. */
const script = (
  options: {
    claim?: S.ClaimResult
    claimRead?: S.ClaimReconciliation
    write?: ReadonlyArray<S.FinalizationResult>
    finalRead?: S.FinalizationReconciliation
    release?: S.FinalizationResult
  } = {}
) => {
  const calls: Array<readonly [string, unknown]> = []
  let writes = 0
  const store: S.JobStoreService = {
    claim: (input) =>
      Effect.sync(() => {
        calls.push(["claim", input])
        return options.claim ?? S.ClaimResults.Unknown()
      }),
    reconcileClaim: (input) =>
      Effect.sync(() => {
        calls.push(["claim-read", input])
        return options.claimRead ?? S.ClaimReconciliations.Unknown()
      }),
    release: (input, phase) =>
      Effect.sync(() => {
        calls.push(["release", [input, phase]])
        return options.release ?? S.FinalizationResults.Applied()
      }),
    finalize: (input) =>
      Effect.sync(() => {
        calls.push(["finalize", input])
        return options.write?.[writes++] ?? S.FinalizationResults.Unknown()
      }),
    reconcileFinalization: (input) =>
      Effect.sync(() => {
        calls.push(["final-read", input])
        return options.finalRead ?? S.FinalizationReconciliations.Unknown()
      }),
    recoverExpired: () => Effect.die("Unexpected recovery")
  }
  return { store, calls }
}

describe("bounded unknown reconciliation", () => {
  it.each(["Claimed", "Empty"] as const)("known %s skips reconciliation", (tag) => {
    const response =
      tag === "Claimed"
        ? S.ClaimResults.Claimed({ claim: claimed() })
        : S.ClaimResults.Empty()
    const { store, calls } = script({ claim: response })
    expect(Effect.runSync(R.resolveClaim(store, request))._tag).toBe(
      tag === "Claimed" ? "Ready" : "Skipped"
    )
    expect(calls.map(([name]) => name)).toEqual(["claim"])
  })
  it.each(["Owned", "NotOwned", "Unknown", "InsufficientLease"] as const)(
    "unknown claim reconciles %s exactly once",
    (tag) => {
      const response =
        tag === "Owned"
          ? S.ClaimReconciliations.Owned({ claim: claimed() })
          : tag === "InsufficientLease"
            ? S.ClaimReconciliations.InsufficientLease({ ownership: ownership() })
            : tag === "NotOwned"
              ? S.ClaimReconciliations.NotOwned()
              : S.ClaimReconciliations.Unknown()
      const { store, calls } = script({ claimRead: response })
      expect(Effect.runSync(R.resolveClaim(store, request))._tag).toBe(
        tag === "Owned" ? "Ready" : tag === "Unknown" ? "Deferred" : "Skipped"
      )
      expect(calls[1]).toEqual(["claim-read", token])
      expect(calls.map(([name]) => name)).toEqual(
        tag === "InsufficientLease"
          ? ["claim", "claim-read", "release"]
          : ["claim", "claim-read"]
      )
      if (tag === "InsufficientLease") {
        expect(calls[2]).toEqual(["release", [ownership(), "BeforeExecution"]])
      }
    }
  )
  it("unknown release defers without another read/write", () => {
    const { store, calls } = script({
      claimRead: S.ClaimReconciliations.InsufficientLease({ ownership: ownership() }),
      release: S.FinalizationResults.Unknown()
    })
    expect(Effect.runSync(R.resolveClaim(store, request))._tag).toBe("Deferred")
    expect(calls).toHaveLength(3)
  })
  it("known finalization is applied without a read", () => {
    const { store, calls } = script({ write: [S.FinalizationResults.Applied()] })
    expect(Effect.runSync(R.resolveFinalization(store, finalizationRequest()))).toBe(
      "Applied"
    )
    expect(calls).toHaveLength(1)
  })
  it.each(["Applied", "OwnershipLost", "Unknown", "StillOwned"] as const)(
    "unknown finalization read %s",
    (tag) => {
      const response = S.FinalizationReconciliations[tag]()
      const { store, calls } = script({ finalRead: response })
      const input = finalizationRequest()
      expect(Effect.runSync(R.resolveFinalization(store, input))).toBe(
        tag === "Applied"
          ? "Applied"
          : tag === "OwnershipLost"
            ? "OwnershipLost"
            : "Deferred"
      )
      expect(calls.map(([name]) => name)).toEqual(
        tag === "StillOwned"
          ? ["finalize", "final-read", "finalize"]
          : ["finalize", "final-read"]
      )
      for (const [, argument] of calls) {
        expect(argument).toBe(input)
      }
    }
  )
  it("one identical finalization retry can succeed", () => {
    const { store, calls } = script({
      finalRead: S.FinalizationReconciliations.StillOwned(),
      write: [S.FinalizationResults.Unknown(), S.FinalizationResults.Applied()]
    })
    expect(Effect.runSync(R.resolveFinalization(store, finalizationRequest()))).toBe(
      "Applied"
    )
    expect(calls).toHaveLength(3)
  })
  it("provider errors, ownership loss, defects and interruption are not safe retries", () => {
    const provider = script()
    const failed: S.JobStoreService<"unavailable"> = {
      ...provider.store,
      claim: () => Effect.fail("unavailable" as const)
    }
    expect(Effect.runSync(Effect.flip(R.resolveClaim(failed, request)))).toBe(
      "unavailable"
    )
    expect(provider.calls).toHaveLength(0)
    const lost = new S.JobOwnershipLost()
    const store = { ...provider.store, finalize: () => Effect.fail(lost) }
    expect(
      Effect.runSync(Effect.flip(R.resolveFinalization(store, finalizationRequest())))
    ).toBe(lost)
    for (const failure of [Effect.die("private"), Effect.interrupt]) {
      const exit = Effect.runSyncExit(
        R.resolveFinalization(
          { ...provider.store, finalize: () => failure },
          finalizationRequest()
        )
      )
      expect(exit._tag).toBe("Failure")
    }
    expect(provider.calls).toHaveLength(0)
  })
  it.each([-1, 0, 1])("claim read usable-time equality + %i", (offset) => {
    expect(value(R.inspectClaim(token, claimed(), now + 60 + offset, 10))._tag).toBe(
      offset <= 0 ? "Owned" : "InsufficientLease"
    )
  })
  it("claim read covers absent, wrong-token, expired and malformed rows", () => {
    expect(value(R.inspectClaim(token, null, now, 10))._tag).toBe("NotOwned")
    expect(value(R.inspectClaim("ffff", claimed(), now, 10))._tag).toBe("NotOwned")
    expect(value(R.inspectClaim(token, claimed(), now + 100, 10))._tag).toBe(
      "InsufficientLease"
    )
    expect(
      Result.isFailure(
        R.inspectClaim(
          token,
          { ...claimed(), ownership: { ...ownership(), lifecycleVersion: 2 } },
          now,
          10
        )
      )
    ).toBe(true)
    expect(
      Result.isFailure(
        R.inspectClaim(
          token,
          { ...claimed(), snapshot: active({ leaseToken: null }) },
          now,
          10
        )
      )
    ).toBe(true)
    expect(Result.isFailure(R.inspectClaim("invalid", null, now, 10))).toBe(true)
    expect(Result.isFailure(R.inspectClaim(token, null, 0, 10))).toBe(true)
    expect(Result.isFailure(R.inspectClaim(token, null, now, 0))).toBe(true)
  })
  it.each([
    L.JobFinalizations.Complete(),
    L.JobFinalizations.Retry({ code: "temporary" }),
    L.JobFinalizations.Retry({ code: "temporary", notAfter: now + 6 }),
    L.JobFinalizations.Dead({ code: "rejected" }),
    L.JobFinalizations.Isolate({ code: "malformed" })
  ])("exact reconciliation of $._tag", (command) => {
    const input = finalizationRequest(command)
    const applied = value(L.finalize(input.before, input.ownership, command, now + 1))
    expect(value(R.inspectFinalization(input, applied, now + 200))._tag).toBe("Applied")
    expect(value(R.inspectFinalization(input, input.before, now + 1))._tag).toBe(
      "StillOwned"
    )
    expect(value(R.inspectFinalization(input, input.before, now + 100))._tag).toBe(
      "OwnershipLost"
    )
    expect(value(R.inspectFinalization(input, null, now))._tag).toBe("OwnershipLost")
    for (const change of [
      { lifecycleVersion: 3 },
      { lastFailureCode: "different" },
      { availableAt: now + 99 },
      { attemptsMade: 2 },
      { stalledCount: 1 },
      { policy: { ...applied.policy, maxAttempts: 4 } }
    ]) {
      expect(
        value(R.inspectFinalization(input, { ...applied, ...change }, now + 200))._tag
      ).toBe("OwnershipLost")
    }
  })
  it("reconciliation validates the original ownership, snapshot and time", () => {
    const input = finalizationRequest()
    expect(
      Result.isFailure(
        R.inspectFinalization(
          { ...input, ownership: { ...input.ownership, leaseToken: "ffff" } },
          null,
          now
        )
      )
    ).toBe(true)
    expect(Result.isFailure(R.inspectFinalization(input, {}, now))).toBe(true)
    expect(Result.isFailure(R.inspectFinalization(input, null, 0))).toBe(true)
    const before = active({ lifecycleVersion: Number.MAX_SAFE_INTEGER })
    expect(
      value(
        R.inspectFinalization(
          { ...input, before, ownership: ownership(before) },
          before,
          now
        )
      )._tag
    ).toBe("StillOwned")
  })
  it.each([
    { ...request, supportedCatalog: [] },
    { ...request, queue: "invalid queue" },
    { ...request, leaseToken: "invalid" },
    { ...request, supportedCatalog: [{ queue: "other", kind: "invoice", version: 1 }] },
    { ...request, supportedCatalog: [{ queue: "billing", kind: "invoice", version: 0 }] },
    { ...request, secret: "private" }
  ])("invalid claim request %j", (input) => {
    expect(Result.isFailure(S.validateClaimRequest(input))).toBe(true)
  })
  it("accepts supported application catalog", () =>
    expect(value(S.validateClaimRequest(request))).toEqual(request))
})
